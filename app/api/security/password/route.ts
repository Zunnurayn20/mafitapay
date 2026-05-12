import { NextResponse } from 'next/server'
import { appendNotification, createNotification, getSessionToken, requireUser, unauthorized } from '@/lib/server/auth'
import { revokeOtherUserSessions, updateUserPassword, verifyPassword } from '@/lib/server/data'

export async function PATCH(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const { currentPassword, newPassword } = await req.json()

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Current and new password are required.', success: false }, { status: 400 })
  }

  if (String(newPassword).length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.', success: false }, { status: 400 })
  }

  if (!verifyPassword(user, String(currentPassword))) {
    return NextResponse.json({ error: 'Current password is incorrect.', success: false }, { status: 400 })
  }

  await updateUserPassword(user.id, String(newPassword))
  const currentSessionToken = await getSessionToken()
  if (currentSessionToken) {
    await revokeOtherUserSessions(user.id, currentSessionToken)
  }
  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: 'Password updated',
    message: 'Your account password was changed successfully. Other sessions were signed out.',
    type: 'success',
  }))

  return NextResponse.json({ success: true })
}
