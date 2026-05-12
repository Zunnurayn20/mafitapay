import { NextResponse } from 'next/server'
import { destroySession, requireUser, unauthorized } from '@/lib/server/auth'
import { updateUserAccountStatus } from '@/lib/server/data'

export async function PATCH(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const status = body.status === 'deactivated' ? 'deactivated' : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (!status) {
    return NextResponse.json({ error: 'Only account deactivation is allowed from this route.', success: false }, { status: 400 })
  }

  const updated = await updateUserAccountStatus({
    userId: user.id,
    status,
    actorUserId: user.id,
    reason: reason || 'User requested account deactivation.',
  })

  if (!updated) {
    return NextResponse.json({ error: 'Account not found.', success: false }, { status: 404 })
  }

  await destroySession()

  return NextResponse.json({ data: { accountStatus: updated.accountStatus }, success: true })
}
