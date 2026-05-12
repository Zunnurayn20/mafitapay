import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireAdminUser, unauthorized } from '@/lib/server/auth'
import {
  getDepositIntentByReference,
  getPayoutRequestByReference,
  getTransactionById,
  insertAuditLog,
  resolvePendingTransaction,
  updateDepositIntentStatus,
  updatePayoutRequestStatus,
} from '@/lib/server/data'

export async function PATCH(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const body = await req.json()
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  const status = body.status === 'success' ? 'success' : body.status === 'failed' ? 'failed' : null
  const providerReference = typeof body.providerReference === 'string' ? body.providerReference.trim() : undefined

  if (!reference || !status) {
    return NextResponse.json({ error: 'reference and valid status are required.', success: false }, { status: 400 })
  }

  const [depositIntent, payoutRequest] = await Promise.all([
    getDepositIntentByReference(reference),
    getPayoutRequestByReference(reference),
  ])

  if (!depositIntent && !payoutRequest) {
    return NextResponse.json({ error: 'Settlement record not found.', success: false }, { status: 404 })
  }

  let result: { userId: string; transaction: { description: string } } | null = null

  if (depositIntent) {
    if (depositIntent.status !== 'pending') {
      return NextResponse.json({ error: `Deposit intent is already ${depositIntent.status}.`, success: false }, { status: 409 })
    }
    const linkedTransaction = await getTransactionById(depositIntent.userId, depositIntent.transactionId)
    if (!linkedTransaction) {
      return NextResponse.json({ error: 'Linked transaction not found.', success: false }, { status: 404 })
    }
    if (linkedTransaction.status !== 'pending') {
      return NextResponse.json({ error: `Linked transaction is already ${linkedTransaction.status}.`, success: false }, { status: 409 })
    }

    await updateDepositIntentStatus(reference, status, providerReference)
    const settled = await resolvePendingTransaction(depositIntent.userId, depositIntent.transactionId, status)
    result = settled ? { userId: depositIntent.userId, transaction: settled.transaction } : null
    await insertAuditLog({
      userId: depositIntent.userId,
      actorUserId: admin.id,
      action: `deposit_intent.${status}_manual`,
      entityType: 'deposit_intent',
      entityId: depositIntent.id,
      metadata: { reference, providerReference: providerReference ?? null },
    })
  } else if (payoutRequest) {
    if (payoutRequest.status !== 'pending') {
      return NextResponse.json({ error: `Payout request is already ${payoutRequest.status}.`, success: false }, { status: 409 })
    }
    const linkedTransaction = await getTransactionById(payoutRequest.userId, payoutRequest.transactionId)
    if (!linkedTransaction) {
      return NextResponse.json({ error: 'Linked transaction not found.', success: false }, { status: 404 })
    }
    if (linkedTransaction.status !== 'pending') {
      return NextResponse.json({ error: `Linked transaction is already ${linkedTransaction.status}.`, success: false }, { status: 409 })
    }

    await updatePayoutRequestStatus(reference, status, providerReference)
    const settled = await resolvePendingTransaction(payoutRequest.userId, payoutRequest.transactionId, status)
    result = settled ? { userId: payoutRequest.userId, transaction: settled.transaction } : null
    await insertAuditLog({
      userId: payoutRequest.userId,
      actorUserId: admin.id,
      action: `payout_request.${status}_manual`,
      entityType: 'payout_request',
      entityId: payoutRequest.id,
      metadata: { reference, providerReference: providerReference ?? null },
    })
  }

  if (!result) {
    return NextResponse.json({ error: 'Pending transaction not found.', success: false }, { status: 404 })
  }

  await appendNotification(result.userId, createNotification({
    userId: result.userId,
    title: status === 'success' ? 'Settlement manually resolved' : 'Settlement manually failed',
    message:
      status === 'success'
        ? `${result.transaction.description} was marked successful by an administrator.`
        : `${result.transaction.description} was marked failed by an administrator.`,
    type: status === 'success' ? 'success' : 'error',
  }))

  return NextResponse.json({ data: { reference, status }, success: true })
}
