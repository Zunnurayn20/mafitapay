import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireAdminUser, unauthorized } from '@/lib/server/auth'
import { updateUserAccountStatus } from '@/lib/server/data'

export async function PATCH(req: Request, ctx: RouteContext<'/api/admin/users/[id]/status'>) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { id } = await ctx.params
  const body = await req.json()
  const status = body.status === 'active' ? 'active' : body.status === 'deactivated' ? 'deactivated' : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (!status) {
    return NextResponse.json({ error: 'A valid account status is required.', success: false }, { status: 400 })
  }

  const updated = await updateUserAccountStatus({
    userId: id,
    status,
    actorUserId: admin.id,
    reason: reason || `Admin ${admin.email} set account status to ${status}.`,
  })

  if (!updated) {
    return NextResponse.json({ error: 'User not found.', success: false }, { status: 404 })
  }

  await appendNotification(updated.id, createNotification({
    userId: updated.id,
    title: status === 'active' ? 'Account reactivated' : 'Account deactivated',
    message: status === 'active'
      ? 'Your account has been reactivated by an administrator.'
      : 'Your account has been deactivated by an administrator.',
    type: status === 'active' ? 'success' : 'info',
  }))

  return NextResponse.json({ data: updated, success: true })
}
