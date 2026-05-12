import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { getCryptoOrderById, listCryptoOrders, updateCryptoOrderExecution, updateCryptoOrderProviderState } from '@/lib/server/data'
import { getLifiTransferStatus } from '@/lib/server/lifi'
import { swapAndPayoutSuiForOrder } from '@/lib/server/sui-treasury'
import type { CryptoOrder } from '@/types'

const AUTO_SYNC_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000]
const WATCHDOG_INTERVAL_MS = 20_000

type SuiReceiptSyncRegistry = Map<string, NodeJS.Timeout[]>
type SuiReceiptWatchdogState = {
  interval: NodeJS.Timeout
  running: boolean
}

declare global {
  var __mafitapaySuiReceiptAutoSyncRegistry: SuiReceiptSyncRegistry | undefined
  var __mafitapaySuiReceiptWatchdog: SuiReceiptWatchdogState | undefined
}

function logSui(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[sui] ${event}${payload}`)
}

function getSuiReceiptAutoSyncRegistry() {
  if (!globalThis.__mafitapaySuiReceiptAutoSyncRegistry) {
    globalThis.__mafitapaySuiReceiptAutoSyncRegistry = new Map()
  }
  return globalThis.__mafitapaySuiReceiptAutoSyncRegistry
}

function clearScheduledSuiReceiptAutoSync(orderId: string) {
  const registry = getSuiReceiptAutoSyncRegistry()
  const timers = registry.get(orderId)
  if (!timers) return
  for (const timer of timers) clearTimeout(timer)
  registry.delete(orderId)
}

function getSuiReceiptWatchdogState() {
  return globalThis.__mafitapaySuiReceiptWatchdog
}

function isSuiAutoSyncEligible(order: CryptoOrder) {
  return order.executionRail === 'sui_treasury'
    && order.executionStatus === 'broadcasted'
    && typeof order.providerPayload?.sendingTxHash === 'string'
    && order.providerStatus !== 'DONE:AWAITING_SUI_PAYOUT'
}

export async function syncPendingSuiOrdersOnce() {
  const watchdog = getSuiReceiptWatchdogState()
  if (watchdog?.running) return
  if (watchdog) watchdog.running = true

  try {
    const orders = (await listCryptoOrders({ status: 'pending', limit: 100 }))
      .filter(item => isSuiAutoSyncEligible(item))

    logSui('sync.scan', {
      pendingCount: orders.length,
    })

    for (const item of orders) {
      try {
        await syncSuiReceiptForCryptoOrder(item.id, item.userId)
      } catch (error) {
        logSui('sync.scan-error', {
          orderId: item.id,
          message: error instanceof Error ? error.message : 'Unknown SUI sync error.',
        })
      }
    }
  } finally {
    const current = getSuiReceiptWatchdogState()
    if (current) current.running = false
  }
}

export async function kickSuiReceiptAutoSync() {
  ensureSuiReceiptAutoSyncWatchdog()
  await syncPendingSuiOrdersOnce()
}

export function ensureSuiReceiptAutoSyncWatchdog() {
  if (globalThis.__mafitapaySuiReceiptWatchdog) return

  const interval = setInterval(() => {
    void syncPendingSuiOrdersOnce()
  }, WATCHDOG_INTERVAL_MS)

  globalThis.__mafitapaySuiReceiptWatchdog = {
    interval,
    running: false,
  }
}

export function scheduleSuiReceiptAutoSync(orderId: string, actorUserId: string) {
  clearScheduledSuiReceiptAutoSync(orderId)
  const registry = getSuiReceiptAutoSyncRegistry()
  const timers = AUTO_SYNC_DELAYS_MS.map(delay => setTimeout(() => {
    void syncSuiReceiptForCryptoOrder(orderId, actorUserId).catch(error => {
      logSui('sync.scheduled-error', {
        orderId,
        delay,
        message: error instanceof Error ? error.message : 'Unknown SUI sync error.',
      })
      return null
    })
  }, delay))
  registry.set(orderId, timers)
}

export async function syncSuiReceiptForCryptoOrder(
  orderId: string,
  actorUserId: string,
  options?: { forcePayoutRetry?: boolean },
) {
  const order = await getCryptoOrderById(orderId)
  if (!order) throw new Error('Crypto order not found.')
  if (order.executionRail !== 'sui_treasury') throw new Error('Only SUI treasury orders are eligible for receipt sync.')
  if (order.status !== 'pending') throw new Error(`Crypto order is already ${order.status}.`)
  if (order.providerStatus === 'DONE:AWAITING_SUI_PAYOUT' && !options?.forcePayoutRetry) {
    return {
      settled: false,
      status: order.providerPayload?.status ?? null,
      order,
    }
  }

  const providerPayload = { ...(order.providerPayload ?? {}) }
  const sendingTxHash = typeof providerPayload.sendingTxHash === 'string' ? providerPayload.sendingTxHash : ''
  if (!sendingTxHash) {
    throw new Error('This order has no SUI bridge transaction hash yet.')
  }

  let status
  try {
    status = await getLifiTransferStatus({
      sourceTxHash: sendingTxHash,
      toChain:
        typeof providerPayload.bridgeChainId === 'string' || typeof providerPayload.bridgeChainId === 'number'
          ? providerPayload.bridgeChainId
          : undefined,
      bridge: typeof providerPayload.bridge === 'string' ? providerPayload.bridge : undefined,
    })
  } catch (error) {
    throw new Error(`[sui_route_status] ${error instanceof Error ? error.message : 'Unable to read SUI bridge status.'}`)
  }

  providerPayload.status = status
  logSui('sync.status', {
    orderId,
    sendingTxHash,
    status: status.status ?? null,
    substatus: status.substatus ?? null,
    receivingTxHash: status.receiving?.txHash ?? null,
    receivingAmount: status.receiving?.amount ?? null,
  })

  if (status.status === 'NOT_FOUND' || status.status === 'PENDING') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: status.substatus ? `${status.status}:${status.substatus}` : status.status ?? 'PENDING',
      providerPayload,
    })
    return {
      settled: false,
      status,
      order: (await getCryptoOrderById(order.id)) ?? order,
    }
  }

  if (status.status === 'DONE' && status.substatus === 'PARTIAL') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: 'DONE:PARTIAL',
      providerPayload,
    })
    return {
      settled: false,
      status,
      order: (await getCryptoOrderById(order.id)) ?? order,
    }
  }

  if (status.status === 'DONE' && status.substatus === 'COMPLETED') {
    const bridgedUsdcUnits =
      typeof status.receiving?.amount === 'string' && /^\d+$/.test(status.receiving.amount)
        ? status.receiving.amount
        : typeof providerPayload.bridgedUsdcUnitsMin === 'string'
          ? providerPayload.bridgedUsdcUnitsMin
          : ''
    const finalRecipient =
      typeof providerPayload.finalRecipient === 'string' && providerPayload.finalRecipient
        ? providerPayload.finalRecipient
        : order.walletAddress || ''

    if (!bridgedUsdcUnits) {
      throw new Error('SUI settlement is complete but bridged treasury amount is missing.')
    }
    if (!finalRecipient) {
      throw new Error('SUI settlement is complete but final recipient is missing.')
    }

    try {
      const nextProviderPayload = {
        ...(await swapAndPayoutSuiForOrder({
          order,
          bridgedUsdcUnits,
          finalRecipient,
        })),
        status,
      }
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUI_PAYOUT_COMPLETED',
        providerPayload: nextProviderPayload,
      })
      Object.assign(providerPayload, nextProviderPayload)
    } catch (error) {
      logSui('payout.error', {
        orderId,
        message: error instanceof Error ? error.message : 'SUI payout failed.',
      })
      providerPayload.nativePayoutError = error instanceof Error ? error.message : 'SUI payout failed.'
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'DONE:AWAITING_SUI_PAYOUT',
        providerPayload,
      })
      clearScheduledSuiReceiptAutoSync(orderId)
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
    logSui('sync.fulfilled', {
      orderId,
      destinationTxHash,
      receivingTxHash: status.receiving?.txHash ?? null,
    })

    const fulfilled = await settleCryptoOrderTerminalState({
      order,
      outcome: 'fulfilled',
      actorUserId,
      source: 'chain_receipt',
      metadata: {
        txHash: sendingTxHash,
        bridge: status.tool,
        bridgeReceivingTxHash: status.receiving?.txHash,
        bridgeReceivingAmount: status.receiving?.amount,
        lifiExplorerLink: status.lifiExplorerLink,
        destinationTxHash,
      },
    })

    clearScheduledSuiReceiptAutoSync(orderId)
    return {
      settled: true,
      status,
      ...fulfilled,
    }
  }

  if ((status.status === 'DONE' && status.substatus === 'REFUNDED') || status.status === 'FAILED') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: status.substatus ? `${status.status}:${status.substatus}` : status.status ?? 'FAILED',
      providerPayload,
    })
    logSui('sync.failed', {
      orderId,
      status: status.status ?? null,
      substatus: status.substatus ?? null,
    })

    const failed = await settleCryptoOrderTerminalState({
      order,
      outcome: 'failed',
      actorUserId,
      source: 'chain_receipt',
      metadata: {
        txHash: sendingTxHash,
        bridge: status.tool,
        lifiExplorerLink: status.lifiExplorerLink,
        status: status.status,
        substatus: status.substatus,
      },
    })

    clearScheduledSuiReceiptAutoSync(orderId)
    return {
      settled: true,
      status,
      ...failed,
    }
  }

  await updateCryptoOrderProviderState({
    id: order.id,
    providerStatus: status.substatus ? `${status.status}:${status.substatus}` : status.status ?? 'PENDING',
    providerPayload,
  })
  return {
    settled: false,
    status,
    order: (await getCryptoOrderById(order.id)) ?? order,
  }
}
