import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import {
  getCryptoOrderByTransactionId,
  listCryptoDepositEventsByTransactionIds,
  getDepositIntentByTransactionId,
  getLedgerEntriesForTransaction,
  getPayoutRequestByTransactionId,
  getProviderEventsByReference,
  getTransactionById,
} from '@/lib/server/data'
import { syncFlutterwavePayout } from '@/lib/server/payout-sync'
import { syncFlutterwaveBill } from '@/lib/server/flutterwave-bill-sync'

export async function GET(_req: Request, ctx: RouteContext<'/api/transactions/[id]'>) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const { id } = await ctx.params
  let transaction = await getTransactionById(user.id, id)
  if (!transaction) {
    return NextResponse.json({ error: 'Transaction not found.', success: false }, { status: 404 })
  }

  let payoutRequest = await getPayoutRequestByTransactionId(id)
  if (payoutRequest?.status === 'pending' && payoutRequest.providerReference && payoutRequest.userId === user.id) {
    try {
      await syncFlutterwavePayout(payoutRequest.reference, user.id)
      const [freshTransaction, freshPayout] = await Promise.all([
        getTransactionById(user.id, id),
        getPayoutRequestByTransactionId(id),
      ])
      if (freshTransaction) transaction = freshTransaction
      payoutRequest = freshPayout
    } catch (error) {
      console.warn('[transactions] payout sync failed', error instanceof Error ? error.message : error)
    }
  }

  if (
    transaction.status === 'pending'
    && transaction.metadata?.settlementKind === 'provider_bill'
    && transaction.metadata?.providerName === 'flutterwave'
  ) {
    try {
      await syncFlutterwaveBill(transaction.reference, user.id)
      const freshTransaction = await getTransactionById(user.id, id)
      if (freshTransaction) transaction = freshTransaction
    } catch (error) {
      console.warn('[transactions] bill sync failed', error instanceof Error ? error.message : 'Sync failed.')
    }
  }

  const [cryptoOrder, cryptoDepositEvents, ledgerEntries, providerEvents, depositIntent] = await Promise.all([
    getCryptoOrderByTransactionId(id),
    listCryptoDepositEventsByTransactionIds([id]),
    getLedgerEntriesForTransaction(user.id, id),
    getProviderEventsByReference(transaction.reference),
    getDepositIntentByTransactionId(id),
  ])

  const timeline = [
    { label: 'Transaction created', at: transaction.createdAt, tone: 'info' },
    ...providerEvents.map(item => ({
      label: `Provider event: ${item.status}`,
      at: item.createdAt,
      tone: item.status === 'success' ? 'success' : item.status === 'failed' ? 'error' : 'info',
    })),
    ...(transaction.status !== 'pending'
      ? [{ label: `Transaction ${transaction.status}`, at: providerEvents[0]?.processedAt ?? transaction.createdAt, tone: transaction.status === 'success' ? 'success' : 'error' }]
      : []),
  ]

  return NextResponse.json({
    data: {
      transaction,
      cryptoOrder,
      cryptoDepositEvents,
      ledgerEntries,
      providerEvents,
      depositIntent,
      payoutRequest,
      timeline,
    },
    success: true,
  })
}
