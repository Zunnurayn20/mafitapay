import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import {
  getAnyTransactionById,
  getCryptoOrderByTransactionId,
  getDepositIntentByReference,
  getLedgerEntriesForTransaction,
  getPayoutRequestByReference,
  getProviderEventsByReference,
  getTransactionByReference,
  listAuditLogs,
} from '@/lib/server/data'

export async function GET(_req: Request, ctx: RouteContext<'/api/admin/references/[reference]'>) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const { reference: rawReference } = await ctx.params
  const reference = rawReference.trim()

  if (!reference) {
    return NextResponse.json({ error: 'Reference is required.', success: false }, { status: 400 })
  }

  const [depositIntent, payoutRequest, directTransaction, providerEvents] = await Promise.all([
    getDepositIntentByReference(reference),
    getPayoutRequestByReference(reference),
    getTransactionByReference(reference),
    getProviderEventsByReference(reference),
  ])

  const transaction = directTransaction
    ?? (depositIntent ? await getAnyTransactionById(depositIntent.transactionId) : null)
    ?? (payoutRequest ? await getAnyTransactionById(payoutRequest.transactionId) : null)

  if (!depositIntent && !payoutRequest && !transaction && providerEvents.length === 0) {
    return NextResponse.json({ error: 'Reference not found.', success: false }, { status: 404 })
  }

  const cryptoOrder = transaction
    ? await getCryptoOrderByTransactionId(transaction.transaction.id)
    : null

  const ledgerEntries = transaction
    ? await getLedgerEntriesForTransaction(transaction.userId, transaction.transaction.id)
    : []

  const auditSearchKeys = [
    reference,
    transaction?.transaction.id,
    depositIntent?.id,
    payoutRequest?.id,
  ].filter((value): value is string => Boolean(value))

  const auditLogGroups = await Promise.all(
    Array.from(new Set(auditSearchKeys)).map(key => listAuditLogs({ limit: 40, reference: key }))
  )

  const auditLogs = Array.from(
    new Map(auditLogGroups.flat().map(item => [item.id, item])).values()
  ).sort((left, right) => right.createdAt.localeCompare(left.createdAt))

  return NextResponse.json({
    data: {
      reference,
      transaction,
      cryptoOrder,
      depositIntent,
      payoutRequest,
      providerEvents,
      ledgerEntries,
      auditLogs,
    },
    success: true,
  })
}
