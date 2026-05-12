import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getCryptoMarketHealth } from '@/lib/server/crypto-market'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  return NextResponse.json({
    data: await getCryptoMarketHealth(),
    success: true,
  })
}
