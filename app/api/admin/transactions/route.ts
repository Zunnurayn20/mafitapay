import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { listRecentTransactions } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '40')
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, limitParam)) : 40

  return NextResponse.json({ data: await listRecentTransactions(limit), success: true })
}
