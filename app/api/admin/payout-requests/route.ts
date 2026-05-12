import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { listPayoutRequests } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const provider = url.searchParams.get('provider') ?? ''
  const reference = url.searchParams.get('reference') ?? ''
  const limitParam = Number(url.searchParams.get('limit') ?? '50')
  const limit = Number.isFinite(limitParam) ? limitParam : 50

  return NextResponse.json({
    data: await listPayoutRequests({
      status: status === 'pending' || status === 'success' || status === 'failed' ? status : undefined,
      provider,
      reference,
      limit,
    }),
    success: true,
  })
}
