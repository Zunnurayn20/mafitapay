import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getStocksMarket } from '@/lib/server/ngx-market'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const market = await getStocksMarket()

  return NextResponse.json({
    data: market,
    success: true,
  })
}