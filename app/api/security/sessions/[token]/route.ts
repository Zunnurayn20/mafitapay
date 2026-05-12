import { NextResponse } from 'next/server'
import { appendNotification, createNotification, getSessionToken, requireUser, unauthorized } from '@/lib/server/auth'
import { revokeUserSession } from '@/lib/server/data'

interface RouteContext {
  params: Promise<{ token: string }>
}

export async function DELETE(_req: Request, context: RouteContext) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const { token } = await context.params
  const currentSessionToken = await getSessionToken()

  if (!token) {
    return NextResponse.json({ error: 'Session token is required.', success: false }, { status: 400 })
  }

  if (token === currentSessionToken) {
    return NextResponse.json({ error: 'Current session cannot be revoked here.', success: false }, { status: 400 })
  }

  const revoked = await revokeUserSession(user.id, token)
  if (!revoked) {
    return NextResponse.json({ error: 'Session not found.', success: false }, { status: 404 })
  }

  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: 'Session revoked',
    message: 'One of your signed-in sessions has been revoked.',
    type: 'info',
  }))

  return NextResponse.json({ success: true })
}
