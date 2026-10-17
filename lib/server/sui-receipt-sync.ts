import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { claimCryptoOrderSuiInventoryPayout, getCryptoOrderById, listCryptoOrders, updateCryptoOrderExecution, updateCryptoOrderProviderState } from '@/lib/server/data'
import { getLifiTransferStatus } from '@/lib/server/lifi'
import { getSuiTreasuryUsdcBalance, SuiPayoutSubmissionUncertainError, swapAndPayoutSuiForOrder } from '@/lib/server/sui-treasury'
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
  if (order.executionRail !== 'sui_treasury' || typeof order.providerPayload?.sendingTxHash !== 'string') return false
  if (order.status === 'pending') {
    return order.executionStatus === 'broadcasted' && order.providerStatus !== 'DONE:AWAITING_SUI_PAYOUT'
  }
  return order.status === 'fulfilled'
    && order.providerPayload?.suiInventoryPayout === true
    && order.providerPayload?.suiInventoryBridgeSettled !== true
    && order.providerPayload?.suiInventoryBridgeFailed !== true
}

export async function syncPendingSuiOrdersOnce() {
  const watchdog = getSuiReceiptWatchdogState()
  if (watchdog?.running) return
  if (watchdog) watchdog.running = true

  try {
    const [pendingOrders, fulfilledOrders] = await Promise.all([
      listCryptoOrders({ status: 'pending', pairId: 'SUI_SUI', limit: 100 }),
      listCryptoOrders({ status: 'fulfilled', pairId: 'SUI_SUI', limit: 100 }),
    ])
    const orders = [...pendingOrders, ...fulfilledOrders].filter(item => isSuiAutoSyncEligible(item))

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
  const inventoryPayoutAlreadySent = order.providerPayload?.suiInventoryPayout === true
    && typeof order.providerPayload?.nativePayoutTxHash === 'string'
  const bridgeFollowUp = order.status === 'fulfilled' && inventoryPayoutAlreadySent
    && order.providerPayload?.suiInventoryBridgeSettled !== true
    && order.providerPayload?.suiInventoryBridgeFailed !== true
  if (order.status !== 'pending' && !bridgeFollowUp) throw new Error(`Crypto order is already ${order.status}.`)
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

  // A payout may have been broadcast successfully just before a function timed out.
  // Persisted payout evidence is enough to fulfill the customer without sending again.
  if (order.status === 'pending' && inventoryPayoutAlreadySent) {
    await updateCryptoOrderExecution({
      id: order.id,
      destinationTxHash: String(order.providerPayload?.nativePayoutTxHash),
    })
    const fulfilled = await settleCryptoOrderTerminalState({
      order,
      outcome: 'fulfilled',
      actorUserId,
      source: 'chain_receipt',
      providerStatus: 'SUI_INVENTORY_BRIDGE_PENDING',
      metadata: {
        txHash: sendingTxHash,
        destinationTxHash: order.providerPayload?.nativePayoutTxHash,
        settlementMode: 'sui_inventory_payout',
      },
    })
    return { settled: true, status: order.providerPayload?.status ?? null, ...fulfilled }
  }

  if (order.status === 'pending' && order.providerStatus === 'SUI_INVENTORY_PAYOUT_SUBMITTING') {
    return { settled: false, status: order.providerPayload?.status ?? null, order }
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
    if (bridgeFollowUp) {
      providerPayload.status = status
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUI_INVENTORY_BRIDGE_PENDING',
        providerPayload,
      })
      return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
    }

    if (order.providerStatus === 'SUI_INVENTORY_PAYOUT_REVIEW') {
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUI_INVENTORY_PAYOUT_REVIEW',
        providerPayload,
      })
      return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
    }

    if (status.status === 'PENDING' && status.substatus === 'WAIT_DESTINATION_TRANSACTION') {
      const inventoryUsdcUnits = typeof providerPayload.bridgedUsdcUnitsMin === 'string'
        && /^\d+$/.test(providerPayload.bridgedUsdcUnitsMin)
        ? providerPayload.bridgedUsdcUnitsMin
        : ''
      const finalRecipient = typeof providerPayload.finalRecipient === 'string' && providerPayload.finalRecipient
        ? providerPayload.finalRecipient
        : order.walletAddress || ''

      if (inventoryUsdcUnits && finalRecipient) {
        const availableUsdcUnits = await getSuiTreasuryUsdcBalance()
        if (availableUsdcUnits < BigInt(inventoryUsdcUnits)) {
          logSui('inventory-payout.unavailable', {
            orderId,
            requiredUsdcUnits: inventoryUsdcUnits,
            availableUsdcUnits: availableUsdcUnits.toString(),
          })
          await updateCryptoOrderProviderState({
            id: order.id,
            providerStatus: status.substatus ? `${status.status}:${status.substatus}` : status.status,
            providerPayload,
          })
          return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
        }

        const claimed = await claimCryptoOrderSuiInventoryPayout({
          id: order.id,
          expectedProviderStatus: order.providerStatus ?? null,
        })
        if (!claimed) {
          return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
        }

        try {
          const payoutPayload = await swapAndPayoutSuiForOrder({
            order,
            bridgedUsdcUnits: inventoryUsdcUnits,
            finalRecipient,
          })
          Object.assign(providerPayload, payoutPayload, {
            status,
            suiInventoryPayout: true,
            suiInventoryPayoutUsdcUnits: inventoryUsdcUnits,
            suiInventoryBridgeSettled: false,
          })
          await updateCryptoOrderProviderState({
            id: order.id,
            providerStatus: 'SUI_INVENTORY_PAYOUT_SENT',
            providerPayload,
          })
          await updateCryptoOrderExecution({
            id: order.id,
            destinationTxHash: typeof providerPayload.nativePayoutTxHash === 'string'
              ? providerPayload.nativePayoutTxHash
              : null,
          })

          const fulfilled = await settleCryptoOrderTerminalState({
            order,
            outcome: 'fulfilled',
            actorUserId,
            source: 'chain_receipt',
            providerStatus: 'SUI_INVENTORY_BRIDGE_PENDING',
            metadata: {
              txHash: sendingTxHash,
              destinationTxHash: providerPayload.nativePayoutTxHash,
              bridge: status.tool,
              settlementMode: 'sui_inventory_payout',
              inventoryUsdcUnits,
            },
          })
          logSui('inventory-payout.fulfilled', {
            orderId,
            destinationTxHash: providerPayload.nativePayoutTxHash ?? null,
            bridgeStatus: status.status,
            bridgeSubstatus: status.substatus,
          })
          return { settled: true, status, ...fulfilled }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'SUI inventory payout failed.'
          const payoutMayHaveBeenBroadcast = typeof providerPayload.nativePayoutTxHash === 'string'
            || error instanceof SuiPayoutSubmissionUncertainError
          providerPayload.suiInventoryPayoutError = errorMessage
          providerPayload.status = status
          await updateCryptoOrderProviderState({
            id: order.id,
            providerStatus: payoutMayHaveBeenBroadcast
              ? 'SUI_INVENTORY_PAYOUT_REVIEW'
              : status.substatus ? `${status.status}:${status.substatus}` : status.status,
            providerPayload,
          })
          logSui(payoutMayHaveBeenBroadcast ? 'inventory-payout.review-required' : 'inventory-payout.retryable-error', {
            orderId,
            message: errorMessage,
          })
          return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
        }
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

  if (status.status === 'DONE' && status.substatus === 'PARTIAL') {
    if (bridgeFollowUp) {
      providerPayload.suiInventoryBridgePartial = true
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUI_INVENTORY_BRIDGE_PARTIAL',
        providerPayload,
      })
      return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
    }
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
    if (bridgeFollowUp) {
      providerPayload.suiInventoryBridgeSettled = true
      providerPayload.suiInventoryBridgeReceivingTxHash = status.receiving?.txHash ?? null
      providerPayload.suiInventoryBridgeReceivingAmount = status.receiving?.amount ?? null
      providerPayload.status = status
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUI_INVENTORY_BRIDGE_REPLENISHED',
        providerPayload,
      })
      logSui('inventory-payout.bridge-replenished', {
        orderId,
        receivingTxHash: status.receiving?.txHash ?? null,
        receivingAmount: status.receiving?.amount ?? null,
      })
      return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
    }

    if (order.providerStatus === 'SUI_INVENTORY_PAYOUT_REVIEW') {
      providerPayload.status = status
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUI_INVENTORY_PAYOUT_REVIEW_BRIDGE_SETTLED',
        providerPayload,
      })
      logSui('inventory-payout.review-required', {
        orderId,
        message: 'Bridge completed while inventory payout outcome is uncertain; not sending a second payout.',
        receivingTxHash: status.receiving?.txHash ?? null,
      })
      return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
    }

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
    if (bridgeFollowUp) {
      providerPayload.suiInventoryBridgeFailed = true
      providerPayload.status = status
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUI_INVENTORY_BRIDGE_FAILED',
        providerPayload,
      })
      logSui('inventory-payout.bridge-failed-after-delivery', {
        orderId,
        status: status.status ?? null,
        substatus: status.substatus ?? null,
      })
      return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
    }
    if (order.providerStatus === 'SUI_INVENTORY_PAYOUT_REVIEW') {
      providerPayload.status = status
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'SUI_INVENTORY_PAYOUT_REVIEW_BRIDGE_FAILED',
        providerPayload,
      })
      logSui('inventory-payout.review-required', {
        orderId,
        message: 'Bridge failed while inventory payout outcome is uncertain; customer order was not failed to avoid a double settlement.',
        status: status.status,
        substatus: status.substatus,
      })
      return { settled: false, status, order: (await getCryptoOrderById(order.id)) ?? order }
    }
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
