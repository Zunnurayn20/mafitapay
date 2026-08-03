import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { listRecentNotifications } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '80')
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, limitParam)) : 80
  const read = (url.searchParams.get('read') ?? 'ALL').trim().toUpperCase()

  let notifications = await listRecentNotifications(limit)
  if (read === 'READ') notifications = notifications.filter(item => item.read)
  if (read === 'UNREAD') notifications = notifications.filter(item => !item.read)

  return NextResponse.json({ data: notifications, success: true })
}
