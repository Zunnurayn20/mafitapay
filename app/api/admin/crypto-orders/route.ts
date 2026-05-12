import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { listCryptoOrders } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status')
  const pairId = url.searchParams.get('pairId') ?? undefined
  const sideParam = url.searchParams.get('side')
  const limitParam = Number(url.searchParams.get('limit') ?? '30')
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, limitParam)) : 30

  return NextResponse.json({
    data: await listCryptoOrders({
      status: statusParam === 'pending' || statusParam === 'fulfilled' || statusParam === 'failed' || statusParam === 'expired' ? statusParam : undefined,
      pairId,
      side: sideParam === 'buy' || sideParam === 'sell' ? sideParam : undefined,
      limit,
    }),
    success: true,
  })
}
