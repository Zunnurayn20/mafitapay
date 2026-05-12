import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getNotificationsForUser, markNotificationsReadByUserId } from '@/lib/server/data'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const notifications = await getNotificationsForUser(user.id)
  return NextResponse.json({ data: notifications, success: true })
}

export async function PATCH() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const notifications = await markNotificationsReadByUserId(user.id)
  return NextResponse.json({ data: notifications, success: true })
}
