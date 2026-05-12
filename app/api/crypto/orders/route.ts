import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { listCryptoOrdersByUser } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status')
  const pairId = url.searchParams.get('pairId') ?? undefined
  const sideParam = url.searchParams.get('side')
  const limitParam = Number(url.searchParams.get('limit') ?? '50')
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, limitParam)) : 50

  return NextResponse.json({
    data: await listCryptoOrdersByUser(user.id, {
      status: statusParam === 'pending' || statusParam === 'fulfilled' || statusParam === 'failed' || statusParam === 'expired' ? statusParam : undefined,
      pairId,
      side: sideParam === 'buy' || sideParam === 'sell' ? sideParam : undefined,
      limit,
    }),
    success: true,
  })
}
