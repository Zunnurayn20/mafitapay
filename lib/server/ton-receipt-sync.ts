import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { getCryptoOrderById, listCryptoOrders, updateCryptoOrderExecution, updateCryptoOrderProviderState } from '@/lib/server/data'
import { getTonSwapStatus, queryTonSubmittedTransaction } from '@/lib/server/ton-executor'

const AUTO_SYNC_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000]
const WATCHDOG_INTERVAL_MS = 20_000

type TonReceiptSyncRegistry = Map<string, NodeJS.Timeout[]>
type TonReceiptWatchdogState = {
  interval: NodeJS.Timeout
  running: boolean
}

declare global {
  var __mafitapayTonReceiptAutoSyncRegistry: TonReceiptSyncRegistry | undefined
  var __mafitapayTonReceiptWatchdog: TonReceiptWatchdogState | undefined
}

function getTonReceiptAutoSyncRegistry() {
  if (!globalThis.__mafitapayTonReceiptAutoSyncRegistry) {
    globalThis.__mafitapayTonReceiptAutoSyncRegistry = new Map()
  }
  return globalThis.__mafitapayTonReceiptAutoSyncRegistry
}

function clearScheduledTonReceiptAutoSync(orderId: string) {
  const registry = getTonReceiptAutoSyncRegistry()
  const timers = registry.get(orderId)
  if (!timers) return
  for (const timer of timers) clearTimeout(timer)
  registry.delete(orderId)
}

function getTonReceiptWatchdogState() {
  return globalThis.__mafitapayTonReceiptWatchdog
}

export async function syncPendingTonOrdersOnce() {
  const watchdog = getTonReceiptWatchdogState()
  if (watchdog?.running) return
  if (watchdog) watchdog.running = true

  try {
    const orders = (await listCryptoOrders({ status: 'pending', limit: 100 }))
      .filter(item =>
        item.executionRail === 'ton_treasury'
        && item.executionStatus === 'broadcasted'
        && typeof item.providerPayload?.queryId === 'string'
      )

    for (const item of orders) {
      try {
        await syncTonReceiptForCryptoOrder(item.id, item.userId)
      } catch {
        // continue queue scan
      }
    }
  } finally {
    const current = getTonReceiptWatchdogState()
    if (current) current.running = false
  }
}

export async function kickTonReceiptAutoSync() {
  ensureTonReceiptAutoSyncWatchdog()
  await syncPendingTonOrdersOnce()
}

export function ensureTonReceiptAutoSyncWatchdog() {
  if (globalThis.__mafitapayTonReceiptWatchdog) return

  const interval = setInterval(() => {
    void syncPendingTonOrdersOnce()
  }, WATCHDOG_INTERVAL_MS)

  globalThis.__mafitapayTonReceiptWatchdog = {
    interval,
    running: false,
  }
}

export function scheduleTonReceiptAutoSync(orderId: string, actorUserId: string) {
  clearScheduledTonReceiptAutoSync(orderId)
  const registry = getTonReceiptAutoSyncRegistry()
  const timers = AUTO_SYNC_DELAYS_MS.map(delay => setTimeout(() => {
    void syncTonReceiptForCryptoOrder(orderId, actorUserId).catch(() => null)
  }, delay))
  registry.set(orderId, timers)
}

export async function syncTonReceiptForCryptoOrder(orderId: string, actorUserId: string) {
  const order = await getCryptoOrderById(orderId)
  if (!order) throw new Error('Crypto order not found.')
  if (order.executionRail !== 'ton_treasury') throw new Error('Only TON treasury orders are eligible for receipt sync.')
  if (order.status !== 'pending') throw new Error(`Crypto order is already ${order.status}.`)

  const providerPayload = { ...(order.providerPayload ?? {}) }
  const ownerAddress = typeof providerPayload.ownerAddress === 'string' ? providerPayload.ownerAddress : ''
  const routerAddress = typeof providerPayload.routerAddress === 'string' ? providerPayload.routerAddress : ''
  const queryId = typeof providerPayload.queryId === 'string' ? providerPayload.queryId : ''
  if (!ownerAddress || !routerAddress || !queryId) {
    throw new Error('TON swap metadata is incomplete for receipt sync.')
  }

  let status
  try {
    status = await getTonSwapStatus({ ownerAddress, routerAddress, queryId })
  } catch (error) {
    throw new Error(`[ton_status] ${error instanceof Error ? error.message : 'Unable to read STON swap status.'}`)
  }

  providerPayload.swapStatus = status

  if (status['@type'] === 'NotFound') {
    const queryTx = await queryTonSubmittedTransaction({
      ownerAddress,
      queryId: Number(queryId),
    }).catch(() => null)

    if (queryTx?.txId?.hash) {
      providerPayload.externalMessageHash = queryTx.txId.hash
      providerPayload.externalMessageLt = queryTx.txId.lt
    }

    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: 'SWAP_PENDING',
      providerPayload,
    })

    return {
      settled: false,
      status,
      order: (await getCryptoOrderById(order.id)) ?? order,
    }
  }

  providerPayload.swapTxHash = status.txHash
  providerPayload.balanceDeltas = status.balanceDeltas
  providerPayload.logicalTime = status.logicalTime

  if (status.exitCode !== '0') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: `SWAP_FAILED:${status.exitCode}`,
      providerPayload,
    })

    const failed = await settleCryptoOrderTerminalState({
      order,
      outcome: 'failed',
      actorUserId,
      source: 'chain_receipt',
      metadata: {
        txHash: status.txHash,
        queryId,
        routerAddress,
        exitCode: status.exitCode,
      },
    })

    clearScheduledTonReceiptAutoSync(orderId)
    return {
      settled: true,
      status,
      ...failed,
    }
  }

  await updateCryptoOrderExecution({
    id: order.id,
    destinationTxHash: status.txHash,
  })
  await updateCryptoOrderProviderState({
    id: order.id,
    providerStatus: 'SWAP_COMPLETED',
    providerPayload,
  })

  const fulfilled = await settleCryptoOrderTerminalState({
    order,
    outcome: 'fulfilled',
    actorUserId,
    source: 'chain_receipt',
    metadata: {
      txHash: status.txHash,
      queryId,
      routerAddress,
      logicalTime: status.logicalTime,
    },
  })

  clearScheduledTonReceiptAutoSync(orderId)
  return {
    settled: true,
    status,
    ...fulfilled,
  }
}
