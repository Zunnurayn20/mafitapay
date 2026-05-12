import {
  broadcastBaseEthTransfer,
  broadcastBaseUsdcTransfer,
  getBaseNativeDeliveryEvidence,
  getBaseTransactionReceiptState,
  getBaseUsdcDeliveryEvidence,
} from '@/lib/server/base-executor'
import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { getCryptoOrderById, listCryptoOrders, updateCryptoOrderExecution, updateCryptoOrderProviderState } from '@/lib/server/data'

const AUTO_SYNC_DELAYS_MS = [5_000, 15_000, 30_000, 60_000]
const WATCHDOG_INTERVAL_MS = 15_000

type BaseReceiptSyncRegistry = Map<string, NodeJS.Timeout[]>
type BaseReceiptWatchdogState = {
  interval: NodeJS.Timeout
  running: boolean
}

declare global {
  var __mafitapayBaseReceiptAutoSyncRegistry: BaseReceiptSyncRegistry | undefined
  var __mafitapayBaseReceiptWatchdog: BaseReceiptWatchdogState | undefined
}

function getBaseReceiptAutoSyncRegistry() {
  if (!globalThis.__mafitapayBaseReceiptAutoSyncRegistry) {
    globalThis.__mafitapayBaseReceiptAutoSyncRegistry = new Map()
  }
  return globalThis.__mafitapayBaseReceiptAutoSyncRegistry
}

function clearScheduledBaseReceiptAutoSync(orderId: string) {
  const registry = getBaseReceiptAutoSyncRegistry()
  const timers = registry.get(orderId)
  if (!timers) return

  for (const timer of timers) clearTimeout(timer)
  registry.delete(orderId)
}

function getBaseReceiptWatchdogState() {
  return globalThis.__mafitapayBaseReceiptWatchdog
}

export async function syncPendingBaseOrdersOnce() {
  const watchdog = getBaseReceiptWatchdogState()
  if (watchdog?.running) return
  if (watchdog) watchdog.running = true

  try {
    const orders = (await listCryptoOrders({ status: 'pending', limit: 100 }))
      .filter(item =>
        (item.executionRail === 'base_legacy' || item.executionRail === 'base_treasury')
        && item.executionStatus === 'broadcasted'
        && (
          item.destinationTxHash
          || (item.provider === '0x' && typeof item.providerPayload?.swapTxHash === 'string')
        )
      )

    for (const item of orders) {
      try {
        await syncBaseReceiptForCryptoOrder(item.id, item.userId)
      } catch {
        // Continue scanning the queue even if one order fails.
      }
    }
  } finally {
    const current = getBaseReceiptWatchdogState()
    if (current) current.running = false
  }
}

export async function kickBaseReceiptAutoSync() {
  ensureBaseReceiptAutoSyncWatchdog()
  await syncPendingBaseOrdersOnce()
}

export function ensureBaseReceiptAutoSyncWatchdog() {
  if (globalThis.__mafitapayBaseReceiptWatchdog) return

  const interval = setInterval(() => {
    void syncPendingBaseOrdersOnce()
  }, WATCHDOG_INTERVAL_MS)

  globalThis.__mafitapayBaseReceiptWatchdog = {
    interval,
    running: false,
  }
}

export async function syncBaseReceiptForCryptoOrder(orderId: string, actorUserId: string) {
  const order = await getCryptoOrderById(orderId)
  if (!order) {
    throw new Error('Crypto order not found.')
  }
  if (order.executionRail !== 'base_legacy' && order.executionRail !== 'base_treasury') {
    throw new Error('Only Base treasury orders are eligible for receipt sync.')
  }
  const swapTxHash = order.provider === '0x' && order.providerPayload && typeof order.providerPayload.swapTxHash === 'string'
    ? order.providerPayload.swapTxHash
    : order.destinationTxHash
  if (!swapTxHash) {
    throw new Error('This order has no broadcast transaction hash yet.')
  }
  if (order.status !== 'pending') {
    throw new Error(`Crypto order is already ${order.status}.`)
  }

  let receipt
  try {
    receipt = await getBaseTransactionReceiptState(swapTxHash)
  } catch (error) {
    throw new Error(`[swap_receipt] ${error instanceof Error ? error.message : 'Unable to read swap receipt.'}`)
  }
  if (!receipt.found || receipt.status === 'pending') {
    if (order.provider === '0x') {
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'PENDING_ONCHAIN_CONFIRMATION',
      })
    }

    return {
      receipt,
      settled: false,
      order,
    }
  }

  const outcome = receipt.status === 'success' ? 'fulfilled' : 'failed'
  let deliveryTxHash: string | null =
    typeof order.providerPayload?.deliveryTxHash === 'string'
      ? order.providerPayload.deliveryTxHash
      : order.destinationTxHash ?? null
  const nextProviderPayload: Record<string, unknown> = {
    ...(order.providerPayload ?? {}),
  }

  if (order.provider === '0x') {
    nextProviderPayload.swapReceipt = receipt
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: outcome === 'fulfilled' ? 'ONCHAIN_SUCCESS' : 'ONCHAIN_REVERTED',
      providerPayload: nextProviderPayload,
    })
  }

  if (outcome === 'fulfilled' && order.provider === '0x' && (order.pairId === 'USDC_BASE' || order.pairId === 'ETH_BASE')) {
    if (!order.walletAddress) {
      throw new Error(`Destination wallet address is missing for ${order.pairId} delivery.`)
    }

    if (!deliveryTxHash) {
      const quotedBuyAmount = order.providerPayload && typeof order.providerPayload.buyAmount === 'string'
        ? order.providerPayload.buyAmount
        : null
      if (!quotedBuyAmount) {
        throw new Error(`0x provider payload is missing buyAmount for ${order.pairId} delivery.`)
      }

      const delivery = order.pairId === 'USDC_BASE'
        ? await broadcastBaseUsdcTransfer({
            to: order.walletAddress,
            amountUnits: quotedBuyAmount,
          })
        : await broadcastBaseEthTransfer({
            to: order.walletAddress,
            amountWei: quotedBuyAmount,
          })

      deliveryTxHash = delivery.hash
      nextProviderPayload.deliveryTxHash = delivery.hash
      if (order.pairId === 'USDC_BASE' && 'amountUnits' in delivery) {
        nextProviderPayload.deliveryAmountUnits = delivery.amountUnits
      }
      if (order.pairId === 'ETH_BASE') {
        nextProviderPayload.deliveryAmountWei = quotedBuyAmount
        if ('unwrap' in delivery && delivery.unwrap?.unwrapped) {
          nextProviderPayload.unwrapTxHash = delivery.unwrap.txHash
          nextProviderPayload.unwrappedAmountWei = delivery.unwrap.amountWei
        }
      }

      try {
        await updateCryptoOrderExecution({
          id: order.id,
          destinationTxHash: delivery.hash,
        })
        await updateCryptoOrderProviderState({
          id: order.id,
          providerStatus: 'DELIVERY_BROADCASTED',
          providerPayload: nextProviderPayload,
        })
      } catch (error) {
        throw new Error(`[delivery_state] ${error instanceof Error ? error.message : 'Unable to persist delivery state.'}`)
      }

      return {
        receipt,
        settled: false,
        order: (await getCryptoOrderById(order.id)) ?? order,
      }
    }
  }

  if (deliveryTxHash) {
    let deliveryReceipt
    try {
      deliveryReceipt = await getBaseTransactionReceiptState(deliveryTxHash)
    } catch (error) {
      throw new Error(`[delivery_receipt] ${error instanceof Error ? error.message : 'Unable to read delivery receipt.'}`)
    }
    if (!deliveryReceipt.found || deliveryReceipt.status === 'pending') {
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'DELIVERY_PENDING_CONFIRMATION',
        providerPayload: nextProviderPayload,
      })

      return {
        receipt,
        settled: false,
        order: (await getCryptoOrderById(order.id)) ?? order,
      }
    }

    if (deliveryReceipt.status !== 'success') {
      await updateCryptoOrderProviderState({
        id: order.id,
        providerStatus: 'DELIVERY_REVERTED',
        providerPayload: {
          ...nextProviderPayload,
          deliveryReceipt,
        },
      })
      const failed = await settleCryptoOrderTerminalState({
        order,
        outcome: 'failed',
        actorUserId,
        source: 'chain_receipt',
        metadata: {
          txHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          deliveryTxHash,
          deliveryStatus: deliveryReceipt.status,
        },
      })

      clearScheduledBaseReceiptAutoSync(orderId)
      return {
        receipt,
        settled: true,
        ...failed,
      }
    }

    let deliveryEvidence: Record<string, unknown> | null = null
    if (order.pairId === 'USDC_BASE') {
      let evidence
      try {
        evidence = await getBaseUsdcDeliveryEvidence(deliveryTxHash, order.walletAddress)
      } catch (error) {
        throw new Error(`[usdc_delivery_evidence] ${error instanceof Error ? error.message : 'Unable to read USDC delivery evidence.'}`)
      }
      deliveryEvidence = {
        status: evidence.status,
        blockNumber: evidence.blockNumber,
        transactionHash: evidence.transactionHash,
        to: evidence.to,
        amountUnits: evidence.amountUnits,
      }
    } else if (order.pairId === 'ETH_BASE') {
      let evidence
      try {
        evidence = await getBaseNativeDeliveryEvidence(deliveryTxHash)
      } catch (error) {
        throw new Error(`[eth_delivery_evidence] ${error instanceof Error ? error.message : 'Unable to read ETH delivery evidence.'}`)
      }
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
      deliveryTxHash,
    },
  })

  clearScheduledBaseReceiptAutoSync(orderId)

  return {
    receipt,
    settled: true,
    ...settled,
  }
}

export function scheduleBaseReceiptAutoSync(orderId: string, actorUserId: string) {
  ensureBaseReceiptAutoSyncWatchdog()
  clearScheduledBaseReceiptAutoSync(orderId)

  const registry = getBaseReceiptAutoSyncRegistry()
  const timers = AUTO_SYNC_DELAYS_MS.map(delayMs =>
    setTimeout(async () => {
      try {
        const result = await syncBaseReceiptForCryptoOrder(orderId, actorUserId)
        if (result.settled) {
          clearScheduledBaseReceiptAutoSync(orderId)
        } else {
          scheduleBaseReceiptAutoSync(orderId, actorUserId)
        }
      } catch {
        // Admin sync remains the fallback for persistent failures.
      }
    }, delayMs)
  )

  registry.set(orderId, timers)
  void kickBaseReceiptAutoSync()
}
