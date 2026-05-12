import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getBaseTreasuryBalances } from '@/lib/server/base-executor'

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  try {
    const balances = await getBaseTreasuryBalances()
    return NextResponse.json({ data: balances, success: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to load Base treasury balances.',
      success: false,
    }, { status: 400 })
  }
}
