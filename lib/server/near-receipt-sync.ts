import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { getCryptoOrderById, listCryptoOrders, updateCryptoOrderExecution, updateCryptoOrderProviderState } from '@/lib/server/data'
import { getNearIntentsSwapStatus, unwrapAndPayoutNearForOrder } from '@/lib/server/near-intents'
import type { CryptoOrder } from '@/types'

const AUTO_SYNC_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000]
const WATCHDOG_INTERVAL_MS = 20_000

type NearReceiptSyncRegistry = Map<string, NodeJS.Timeout[]>
type NearReceiptWatchdogState = {
  interval: NodeJS.Timeout
  running: boolean
}

declare global {
  var __mafitapayNearReceiptAutoSyncRegistry: NearReceiptSyncRegistry | undefined
  var __mafitapayNearReceiptWatchdog: NearReceiptWatchdogState | undefined
}

function logNear(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[near] ${event}${payload}`)
}

function getNearReceiptAutoSyncRegistry() {
  if (!globalThis.__mafitapayNearReceiptAutoSyncRegistry) {
    globalThis.__mafitapayNearReceiptAutoSyncRegistry = new Map()
  }
  return globalThis.__mafitapayNearReceiptAutoSyncRegistry
}

function clearScheduledNearReceiptAutoSync(orderId: string) {
  const registry = getNearReceiptAutoSyncRegistry()
  const timers = registry.get(orderId)
  if (!timers) return
  for (const timer of timers) clearTimeout(timer)
  registry.delete(orderId)
}

function getNearReceiptWatchdogState() {
  return globalThis.__mafitapayNearReceiptWatchdog
}

function isNearAutoSyncEligible(order: CryptoOrder) {
  return order.executionRail === 'near_intents'
    && order.executionStatus === 'broadcasted'
    && typeof order.providerPayload?.depositAddress === 'string'
    && order.providerStatus !== 'SUCCESS:AWAITING_NATIVE_PAYOUT'
}

export async function syncPendingNearOrdersOnce() {
  const watchdog = getNearReceiptWatchdogState()
  if (watchdog?.running) return
  if (watchdog) watchdog.running = true

  try {
    const orders = (await listCryptoOrders({ status: 'pending', limit: 100 }))
      .filter(item => isNearAutoSyncEligible(item))

    logNear('sync.scan', {
      pendingCount: orders.length,
    })

    for (const item of orders) {
      try {
        await syncNearReceiptForCryptoOrder(item.id, item.userId)
      } catch (error) {
        logNear('sync.scan-error', {
          orderId: item.id,
          message: error instanceof Error ? error.message : 'Unknown NEAR sync error.',
        })
      }
    }
  } finally {
    const current = getNearReceiptWatchdogState()
    if (current) current.running = false
  }
}

export async function kickNearReceiptAutoSync() {
  ensureNearReceiptAutoSyncWatchdog()
  await syncPendingNearOrdersOnce()
}

export function ensureNearReceiptAutoSyncWatchdog() {
  if (globalThis.__mafitapayNearReceiptWatchdog) return

  const interval = setInterval(() => {
    void syncPendingNearOrdersOnce()
  }, WATCHDOG_INTERVAL_MS)

  globalThis.__mafitapayNearReceiptWatchdog = {
    interval,
    running: false,
  }
}

export function scheduleNearReceiptAutoSync(orderId: string, actorUserId: string) {
  clearScheduledNearReceiptAutoSync(orderId)
  const registry = getNearReceiptAutoSyncRegistry()
  const timers = AUTO_SYNC_DELAYS_MS.map(delay => setTimeout(() => {
    void syncNearReceiptForCryptoOrder(orderId, actorUserId).catch(error => {
      logNear('sync.scheduled-error', {
        orderId,
        delay,
        message: error instanceof Error ? error.message : 'Unknown NEAR sync error.',
      })
      return null
    })
  }, delay))
  registry.set(orderId, timers)
}

export async function syncNearReceiptForCryptoOrder(
  orderId: string,
  actorUserId: string,
  options?: { forcePayoutRetry?: boolean },
) {
  const order = await getCryptoOrderById(orderId)
  if (!order) throw new Error('Crypto order not found.')
  if (order.executionRail !== 'near_intents') throw new Error('Only NEAR Intents orders are eligible for receipt sync.')
  if (order.status !== 'pending') throw new Error(`Crypto order is already ${order.status}.`)
  if (order.providerStatus === 'SUCCESS:AWAITING_NATIVE_PAYOUT' && !options?.forcePayoutRetry) {
    return {
      settled: false,
      status: order.providerPayload?.status ?? null,
      order,
    }
  }

  const providerPayload = { ...(order.providerPayload ?? {}) }
  const depositAddress = typeof providerPayload.depositAddress === 'string' ? providerPayload.depositAddress : ''
  const depositMemo = typeof providerPayload.depositMemo === 'string' ? providerPayload.depositMemo : ''
  const storedQuote = providerPayload.quote && typeof providerPayload.quote === 'object'
    ? providerPayload.quote as { amountOut?: string }
    : null
  if (!depositAddress) {
    throw new Error('This order has no NEAR deposit address yet.')
  }

  const status = await getNearIntentsSwapStatus({
    depositAddress,
    depositMemo: depositMemo || undefined,
  })
  providerPayload.status = status
  logNear('sync.status', {
    orderId,
    depositAddress,
    depositMemo: depositMemo || null,
    status: status.status ?? null,
    nearTxHashes: status.swapDetails?.nearTxHashes,
  })

  const statusValue = status.status ?? 'PROCESSING'
  if (statusValue === 'PENDING_DEPOSIT' || statusValue === 'KNOWN_DEPOSIT_TX' || statusValue === 'INCOMPLETE_DEPOSIT' || statusValue === 'PROCESSING') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: statusValue,
      providerPayload,
    })
    return {
      settled: false,
      status,
      order: (await getCryptoOrderById(order.id)) ?? order,
    }
  }

  if (statusValue === 'SUCCESS') {
    const payoutAmountYocto =
      typeof providerPayload.nativePayoutAmountYocto === 'string'
        ? providerPayload.nativePayoutAmountYocto
        : typeof status.swapDetails?.amountOut === 'string'
          ? status.swapDetails.amountOut
          : typeof status.quoteResponse?.quote?.amountOut === 'string'
            ? status.quoteResponse.quote.amountOut
            : typeof storedQuote?.amountOut === 'string'
              ? storedQuote.amountOut
              : ''

    if (!payoutAmountYocto) {
      throw new Error('NEAR settlement is complete but payout amount is missing.')
    }

    try {
      const nextProviderPayload = await unwrapAndPayoutNearForOrder({
        order,
        amountYocto: payoutAmountYocto,
      })
      nextProviderPayload.status = status
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'NATIVE_PAYOUT_COMPLETED',
        providerPayload: nextProviderPayload,
      })
      Object.assign(providerPayload, nextProviderPayload)
    } catch (error) {
      logNear('payout.error', {
        orderId,
        message: error instanceof Error ? error.message : 'Native payout failed.',
      })
      providerPayload.nativePayoutError = error instanceof Error ? error.message : 'Native payout failed.'
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUCCESS:AWAITING_NATIVE_PAYOUT',
        providerPayload,
      })
      clearScheduledNearReceiptAutoSync(orderId)
      return {
        settled: false,
        status,
        order: (await getCryptoOrderById(order.id)) ?? order,
      }
    }

    const destinationTxHash = typeof providerPayload.nativePayoutTxHash === 'string'
      ? providerPayload.nativePayoutTxHash
      : null

    await updateCryptoOrderExecution({
      id: order.id,
      destinationTxHash,
    })
    logNear('sync.fulfilled', {
      orderId,
      destinationTxHash,
      unwrapTxHash: providerPayload.unwrapTxHash,
    })

    const fulfilled = await settleCryptoOrderTerminalState({
      order,
      outcome: 'fulfilled',
      actorUserId,
      source: 'chain_receipt',
      metadata: {
        depositAddress,
        depositMemo: depositMemo || undefined,
        txHash: destinationTxHash,
        nearTxHashes: status.swapDetails?.nearTxHashes,
        unwrapTxHash: providerPayload.unwrapTxHash,
      },
    })

    clearScheduledNearReceiptAutoSync(orderId)
    return {
      settled: true,
      status,
      ...fulfilled,
    }
  }

  if (statusValue === 'REFUNDED' || statusValue === 'FAILED') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: statusValue,
      providerPayload,
    })
    logNear('sync.failed', {
      orderId,
      status: statusValue,
      refundReason: status.swapDetails?.refundReason ?? null,
    })

    const failed = await settleCryptoOrderTerminalState({
      order,
      outcome: 'failed',
      actorUserId,
      source: 'chain_receipt',
      metadata: {
        depositAddress,
        depositMemo: depositMemo || undefined,
        status: statusValue,
        refundReason: status.swapDetails?.refundReason,
      },
    })

    clearScheduledNearReceiptAutoSync(orderId)
    return {
      settled: true,
      status,
      ...failed,
    }
  }

  await updateCryptoOrderProviderState({
    id: order.id,
    providerStatus: statusValue,
    providerPayload,
  })
  return {
    settled: false,
    status,
    order: (await getCryptoOrderById(order.id)) ?? order,
  }
}
