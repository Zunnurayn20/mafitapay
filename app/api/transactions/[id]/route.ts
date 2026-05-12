import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import {
  getCryptoOrderByTransactionId,
  getDepositIntentByTransactionId,
  getLedgerEntriesForTransaction,
  getPayoutRequestByTransactionId,
  getProviderEventsByReference,
  getTransactionById,
} from '@/lib/server/data'

export async function GET(_req: Request, ctx: RouteContext<'/api/transactions/[id]'>) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const { id } = await ctx.params
  const transaction = await getTransactionById(user.id, id)
  if (!transaction) {
    return NextResponse.json({ error: 'Transaction not found.', success: false }, { status: 404 })
  }

  const [cryptoOrder, ledgerEntries, providerEvents, depositIntent, payoutRequest] = await Promise.all([
    getCryptoOrderByTransactionId(id),
    getLedgerEntriesForTransaction(user.id, id),
    getProviderEventsByReference(transaction.reference),
    getDepositIntentByTransactionId(id),
    getPayoutRequestByTransactionId(id),
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
      ledgerEntries,
      providerEvents,
      depositIntent,
      payoutRequest,
      timeline,
    },
    success: true,
  })
}
