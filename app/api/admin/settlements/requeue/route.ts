import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import {
  getDepositIntentByReference,
  getPayoutRequestByReference,
  insertAuditLog,
  requeueDepositIntent,
  requeuePayoutRequest,
} from '@/lib/server/data'

export async function PATCH(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const body = await req.json()
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''

  if (!reference) {
    return NextResponse.json({ error: 'reference is required.', success: false }, { status: 400 })
  }

  const [depositIntent, payoutRequest] = await Promise.all([
    getDepositIntentByReference(reference),
    getPayoutRequestByReference(reference),
  ])

  if (depositIntent) {
    let updated
    try {
      updated = await requeueDepositIntent(reference)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Settlement record cannot be requeued.', success: false }, { status: 409 })
    }
    await insertAuditLog({
      userId: depositIntent.userId,
      actorUserId: admin.id,
      action: 'deposit_intent.requeued',
      entityType: 'deposit_intent',
      entityId: depositIntent.id,
      metadata: { reference },
    })
    return NextResponse.json({ data: updated, success: true })
  }

  if (payoutRequest) {
    let updated
    try {
      updated = await requeuePayoutRequest(reference)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Settlement record cannot be requeued.', success: false }, { status: 409 })
    }
    await insertAuditLog({
      userId: payoutRequest.userId,
      actorUserId: admin.id,
      action: 'payout_request.requeued',
      entityType: 'payout_request',
      entityId: payoutRequest.id,
      metadata: { reference },
    })
    return NextResponse.json({ data: updated, success: true })
  }

  return NextResponse.json({ error: 'Settlement record not found.', success: false }, { status: 404 })
}
