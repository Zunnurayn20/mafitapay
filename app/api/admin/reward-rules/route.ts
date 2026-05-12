import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getRewardRules, upsertRewardRules } from '@/lib/server/data'
import type { RewardRule } from '@/types'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: await getRewardRules(), success: true })
}

export async function PATCH(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const rules = Array.isArray(body.rules) ? body.rules as RewardRule[] : null

  if (!rules) {
    return NextResponse.json({ error: 'rules array is required.', success: false }, { status: 400 })
  }

  return NextResponse.json({ data: await upsertRewardRules(rules), success: true })
}
