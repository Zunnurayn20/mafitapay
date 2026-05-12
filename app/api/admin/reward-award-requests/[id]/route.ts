import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { reviewRewardAwardRequest } from '@/lib/server/data'

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { id } = await context.params
  const body = await req.json()
  const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined

  if (!id?.trim() || !action) {
    return NextResponse.json({ error: 'request id and valid action are required.', success: false }, { status: 400 })
  }

  try {
    const data = await reviewRewardAwardRequest({
      requestId: id.trim(),
      action,
      adminUserId: admin.id,
      reason,
    })
    return NextResponse.json({ data, success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reward request update failed.'
    const status = /not found/i.test(message) ? 404 : /already approved/i.test(message) ? 409 : 400
    return NextResponse.json({ error: message, success: false }, { status })
  }
}
