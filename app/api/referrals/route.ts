import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getReferralOverviewByUserId } from '@/lib/server/data'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const overview = await getReferralOverviewByUserId(user.id)
  if (!overview) {
    return NextResponse.json({ error: 'Referral data not found.', success: false }, { status: 404 })
  }

  return NextResponse.json({ data: overview, success: true })
}
