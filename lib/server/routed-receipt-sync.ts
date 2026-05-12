import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { getCryptoOrderById, listCryptoOrders, updateCryptoOrderExecution, updateCryptoOrderProviderState } from '@/lib/server/data'
import { getLifiTransferStatus } from '@/lib/server/lifi'

const AUTO_SYNC_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000]
const WATCHDOG_INTERVAL_MS = 20_000

type RoutedReceiptSyncRegistry = Map<string, NodeJS.Timeout[]>
type RoutedReceiptWatchdogState = {
  interval: NodeJS.Timeout
  running: boolean
}

declare global {
  var __mafitapayRoutedReceiptAutoSyncRegistry: RoutedReceiptSyncRegistry | undefined
  var __mafitapayRoutedReceiptWatchdog: RoutedReceiptWatchdogState | undefined
}

function getRoutedReceiptAutoSyncRegistry() {
  if (!globalThis.__mafitapayRoutedReceiptAutoSyncRegistry) {
    globalThis.__mafitapayRoutedReceiptAutoSyncRegistry = new Map()
  }
  return globalThis.__mafitapayRoutedReceiptAutoSyncRegistry
}

function clearScheduledRoutedReceiptAutoSync(orderId: string) {
  const registry = getRoutedReceiptAutoSyncRegistry()
  const timers = registry.get(orderId)
  if (!timers) return

  for (const timer of timers) clearTimeout(timer)
  registry.delete(orderId)
}

function getRoutedReceiptWatchdogState() {
  return globalThis.__mafitapayRoutedReceiptWatchdog
}

export async function syncPendingRoutedOrdersOnce() {
  const watchdog = getRoutedReceiptWatchdogState()
  if (watchdog?.running) return
  if (watchdog) watchdog.running = true

  try {
    const orders = (await listCryptoOrders({ status: 'pending', limit: 100 }))
      .filter(item =>
        item.executionRail === 'routed_treasury'
        && item.executionStatus === 'broadcasted'
        && typeof item.providerPayload?.sendingTxHash === 'string'
      )

    for (const item of orders) {
      try {
        await syncRoutedReceiptForCryptoOrder(item.id, item.userId)
      } catch {
        // continue queue scan
      }
    }
  } finally {
    const current = getRoutedReceiptWatchdogState()
    if (current) current.running = false
  }
}

export async function kickRoutedReceiptAutoSync() {
  ensureRoutedReceiptAutoSyncWatchdog()
  await syncPendingRoutedOrdersOnce()
}

export function ensureRoutedReceiptAutoSyncWatchdog() {
  if (globalThis.__mafitapayRoutedReceiptWatchdog) return

  const interval = setInterval(() => {
    void syncPendingRoutedOrdersOnce()
  }, WATCHDOG_INTERVAL_MS)

  globalThis.__mafitapayRoutedReceiptWatchdog = {
    interval,
    running: false,
  }
}

export function scheduleRoutedReceiptAutoSync(orderId: string, actorUserId: string) {
  clearScheduledRoutedReceiptAutoSync(orderId)

  const registry = getRoutedReceiptAutoSyncRegistry()
  const timers = AUTO_SYNC_DELAYS_MS.map(delay => setTimeout(() => {
    void syncRoutedReceiptForCryptoOrder(orderId, actorUserId).catch(() => null)
  }, delay))
  registry.set(orderId, timers)
}

export async function syncRoutedReceiptForCryptoOrder(orderId: string, actorUserId: string) {
  const order = await getCryptoOrderById(orderId)
  if (!order) throw new Error('Crypto order not found.')
  if (order.executionRail !== 'routed_treasury') throw new Error('Only routed treasury orders are eligible for receipt sync.')
  if (order.status !== 'pending') throw new Error(`Crypto order is already ${order.status}.`)

  const sendingTxHash = typeof order.providerPayload?.sendingTxHash === 'string'
    ? order.providerPayload.sendingTxHash
    : null
  if (!sendingTxHash) {
    throw new Error('This order has no routed source transaction hash yet.')
  }

  const providerPayload = { ...(order.providerPayload ?? {}) }

  let status
  try {
    status = await getLifiTransferStatus({
      sourceTxHash: sendingTxHash,
      toChain: typeof providerPayload.toChain === 'number' ? providerPayload.toChain : undefined,
      bridge: typeof providerPayload.bridge === 'string' ? providerPayload.bridge : undefined,
    })
  } catch (error) {
    throw new Error(`[route_status] ${error instanceof Error ? error.message : 'Unable to read LI.FI status.'}`)
  }

  providerPayload.status = status

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
      providerStatus: 'PARTIAL_COMPLETION_REVIEW',
      providerPayload,
    })
    return {
      settled: false,
      status,
      order: (await getCryptoOrderById(order.id)) ?? order,
    }
  }

  if (status.status === 'DONE' && status.substatus === 'COMPLETED') {
    const destinationTxHash = status.receiving?.txHash ?? null
    try {
      await updateCryptoOrderExecution({
        id: order.id,
        destinationTxHash,
      })
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'DONE:COMPLETED',
        providerPayload,
      })
    } catch (error) {
      throw new Error(`[route_state] ${error instanceof Error ? error.message : 'Unable to persist LI.FI completion state.'}`)
    }

    const fulfilled = await settleCryptoOrderTerminalState({
      order,
      outcome: 'fulfilled',
      actorUserId,
      source: 'chain_receipt',
      metadata: {
        txHash: sendingTxHash,
        destinationTxHash,
        bridge: status.tool,
        receivingAmount: status.receiving?.amount,
        receivingToken: status.receiving?.token?.symbol,
        lifiExplorerLink: status.lifiExplorerLink,
      },
    })

    clearScheduledRoutedReceiptAutoSync(orderId)
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

    clearScheduledRoutedReceiptAutoSync(orderId)
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
