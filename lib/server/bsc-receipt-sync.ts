import {
  broadcastBscDeliveryForOrder,
  getBscNativeDeliveryEvidence,
  getBscTransactionReceiptState,
  getBscUsdtDeliveryEvidence,
} from '@/lib/server/bsc-executor'
import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { getCryptoOrderById, listCryptoOrders, updateCryptoOrderProviderState } from '@/lib/server/data'

const AUTO_SYNC_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]
const WATCHDOG_INTERVAL_MS = 15_000

type BscReceiptSyncRegistry = Map<string, NodeJS.Timeout[]>
type BscReceiptWatchdogState = {
  interval: NodeJS.Timeout
  running: boolean
}

declare global {
  var __mafitapayBscReceiptAutoSyncRegistry: BscReceiptSyncRegistry | undefined
  var __mafitapayBscReceiptWatchdog: BscReceiptWatchdogState | undefined
}

function getBscReceiptAutoSyncRegistry() {
  if (!globalThis.__mafitapayBscReceiptAutoSyncRegistry) {
    globalThis.__mafitapayBscReceiptAutoSyncRegistry = new Map()
  }
  return globalThis.__mafitapayBscReceiptAutoSyncRegistry
}

function clearScheduledBscReceiptAutoSync(orderId: string) {
  const registry = getBscReceiptAutoSyncRegistry()
  const timers = registry.get(orderId)
  if (!timers) return
  for (const timer of timers) clearTimeout(timer)
  registry.delete(orderId)
}

function getBscReceiptWatchdogState() {
  return globalThis.__mafitapayBscReceiptWatchdog
}

export async function syncPendingBscOrdersOnce() {
  const watchdog = getBscReceiptWatchdogState()
  if (watchdog?.running) return
  if (watchdog) watchdog.running = true

  try {
    const orders = (await listCryptoOrders({ status: 'pending', limit: 100 }))
      .filter(item => item.executionRail === 'bsc_treasury' && item.executionStatus === 'broadcasted' && item.destinationTxHash)

    for (const item of orders) {
      try {
        await syncBscReceiptForCryptoOrder(item.id, item.userId)
      } catch {
        // Continue scanning the queue even if one order fails.
      }
    }
  } finally {
    const current = getBscReceiptWatchdogState()
    if (current) current.running = false
  }
}

export async function kickBscReceiptAutoSync() {
  ensureBscReceiptAutoSyncWatchdog()
  await syncPendingBscOrdersOnce()
}

export function ensureBscReceiptAutoSyncWatchdog() {
  if (globalThis.__mafitapayBscReceiptWatchdog) return

  const interval = setInterval(() => {
    void syncPendingBscOrdersOnce()
  }, WATCHDOG_INTERVAL_MS)

  globalThis.__mafitapayBscReceiptWatchdog = {
    interval,
    running: false,
  }
}

export async function syncBscReceiptForCryptoOrder(orderId: string, actorUserId: string) {
  const order = await getCryptoOrderById(orderId)
  if (!order) throw new Error('Crypto order not found.')
  if (order.executionRail !== 'bsc_treasury') throw new Error('Only BSC treasury orders are eligible for receipt sync.')
  if (!order.destinationTxHash) throw new Error('This order has no broadcast transaction hash yet.')
  if (order.status !== 'pending') throw new Error(`Crypto order is already ${order.status}.`)

  const receipt = await getBscTransactionReceiptState(order.destinationTxHash)
  if (!receipt.found || receipt.status === 'pending') {
    return {
      receipt,
      settled: false,
      order,
    }
  }

  const outcome = receipt.status === 'success' ? 'fulfilled' : 'failed'
  const nextProviderPayload: Record<string, unknown> = {
    ...(order.providerPayload ?? {}),
  }

  if (outcome === 'fulfilled') {
    let deliveryEvidence: Record<string, unknown> | null = null
    if (order.pairId === 'USDT_BSC') {
      const evidence = await getBscUsdtDeliveryEvidence(order.destinationTxHash, order.walletAddress)
      deliveryEvidence = {
        status: evidence.status,
        blockNumber: evidence.blockNumber,
        transactionHash: evidence.transactionHash,
        to: evidence.to,
        amountUnits: evidence.amountUnits,
      }
    } else if (order.pairId === 'BNB_BSC') {
      const evidence = await getBscNativeDeliveryEvidence(order.destinationTxHash)
      deliveryEvidence = {
        status: evidence.status,
        blockNumber: evidence.blockNumber,
        transactionHash: evidence.transactionHash,
        to: evidence.to,
        amountWei: evidence.amountWei,
      }
    }

    nextProviderPayload.deliveryEvidence = deliveryEvidence
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: 'DELIVERED_TO_WALLET',
      providerPayload: nextProviderPayload,
    })
  }

  const settled = await settleCryptoOrderTerminalState({
    order,
    outcome,
    actorUserId,
    source: 'chain_receipt',
    metadata: {
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    },
  })

  clearScheduledBscReceiptAutoSync(orderId)

  return {
    receipt,
    settled: true,
    ...settled,
  }
}

export function scheduleBscReceiptAutoSync(orderId: string, actorUserId: string) {
  ensureBscReceiptAutoSyncWatchdog()
  clearScheduledBscReceiptAutoSync(orderId)

  const registry = getBscReceiptAutoSyncRegistry()
  const timers = AUTO_SYNC_DELAYS_MS.map(delayMs =>
    setTimeout(async () => {
      try {
        const result = await syncBscReceiptForCryptoOrder(orderId, actorUserId)
        if (result.settled) {
          clearScheduledBscReceiptAutoSync(orderId)
        } else {
          scheduleBscReceiptAutoSync(orderId, actorUserId)
        }
      } catch {
        // Manual sync remains the fallback for persistent failures.
      }
    }, delayMs)
  )

  registry.set(orderId, timers)
  void kickBscReceiptAutoSync()
}

export async function rebroadcastBscDeliveryForCryptoOrder(orderId: string, actorUserId: string) {
  const order = await getCryptoOrderById(orderId)
  if (!order) throw new Error('Crypto order not found.')
  if (order.executionRail !== 'bsc_treasury') throw new Error('Only BSC treasury orders can be rebroadcast through this flow.')
  if (order.status !== 'pending') throw new Error(`Crypto order is already ${order.status}.`)

  const execution = await broadcastBscDeliveryForOrder(order)
  return {
    order,
    execution,
    actorUserId,
  }
}
