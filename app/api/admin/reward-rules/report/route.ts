import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getRewardRuleReport } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '20')
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(100, Math.trunc(limitParam)) : 20

  return NextResponse.json({ data: await getRewardRuleReport(limit), success: true })
}
