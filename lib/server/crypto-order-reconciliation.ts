import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  getCryptoOrderById,
  insertAuditLog,
  resolvePendingTransaction,
  updateCryptoOrderExecution,
  updateCryptoOrderProviderState,
  updateCryptoOrderStatus,
} from '@/lib/server/data'
import type { CryptoOrder } from '@/types'

export async function settleCryptoOrderTerminalState(input: {
  order: CryptoOrder
  outcome: 'fulfilled' | 'failed'
  actorUserId: string
  source: 'admin' | 'chain_receipt' | 'auto_execution'
  metadata?: Record<string, unknown>
}) {
  const { order, outcome, actorUserId, source, metadata } = input

  if (order.status !== 'pending') {
    throw new Error(`Crypto order is already ${order.status}.`)
  }

  const transactionOutcome = outcome === 'fulfilled' ? 'success' : 'failed'
  const resolved = await resolvePendingTransaction(order.userId, order.transactionId, transactionOutcome)
  if (!resolved) {
    throw new Error('Linked transaction not found.')
  }

  await updateCryptoOrderStatus(order.id, outcome)
  if (order.executionRail === 'base_legacy' || order.executionRail === 'base_treasury' || order.executionRail === 'bsc_treasury' || order.executionRail === 'routed_treasury' || order.executionRail === 'sui_treasury' || order.executionRail === 'ton_treasury' || order.executionRail === 'near_intents') {
    await updateCryptoOrderExecution({
      id: order.id,
      executionStatus: outcome === 'fulfilled' ? 'settled' : 'failed',
    })
  }
  if (order.provider === '0x') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: outcome === 'fulfilled' ? 'ONCHAIN_SUCCESS' : 'ONCHAIN_REVERTED',
    })
  }
  if (order.provider === 'lifi') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: outcome === 'fulfilled' ? 'DONE:COMPLETED' : 'FAILED',
    })
  }
  if (order.provider === 'ston') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: outcome === 'fulfilled' ? 'SWAP_COMPLETED' : 'SWAP_FAILED',
    })
  }
  if (order.provider === 'near_intents') {
    await updateCryptoOrderProviderState({
      id: order.id,
      providerStatus: outcome === 'fulfilled' ? 'SUCCESS' : 'FAILED',
    })
  }

  await insertAuditLog({
    userId: order.userId,
    actorUserId,
    action: `crypto_order.${outcome}.${source}`,
    entityType: 'crypto_order',
    entityId: order.id,
    metadata: {
      transactionId: order.transactionId,
      pairId: order.pairId,
      side: order.side,
      ...metadata,
    },
  })

  await appendNotification(order.userId, createNotification({
    userId: order.userId,
    title: outcome === 'fulfilled' ? 'Crypto order fulfilled' : 'Crypto order failed',
    message:
      outcome === 'fulfilled'
        ? `Your ${order.side} order for ${order.pairId} has been fulfilled onchain.`
        : `Your ${order.side} order for ${order.pairId} failed onchain and your pending balance was released.`,
    type: outcome === 'fulfilled' ? 'success' : 'error',
  }))

  const refreshed = await getCryptoOrderById(order.id)
  return {
    order: refreshed,
    transaction: resolved.transaction,
    wallet: resolved.wallet,
  }
}
