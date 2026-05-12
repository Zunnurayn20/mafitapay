import { NextResponse } from 'next/server'
import { appendNotification, createNotification, getSessionToken, requireUser, unauthorized } from '@/lib/server/auth'
import { revokeOtherUserSessions } from '@/lib/server/data'

export async function DELETE() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const currentSessionToken = await getSessionToken()
  if (!currentSessionToken) {
    return NextResponse.json({ error: 'Current session not found.', success: false }, { status: 400 })
  }

  const revokedCount = await revokeOtherUserSessions(user.id, currentSessionToken)

  if (revokedCount > 0) {
    await appendNotification(user.id, createNotification({
      userId: user.id,
      title: 'Other sessions revoked',
      message: 'All other signed-in sessions were revoked successfully.',
      type: 'info',
    }))
  }

  return NextResponse.json({ data: { revokedCount }, success: true })
}
