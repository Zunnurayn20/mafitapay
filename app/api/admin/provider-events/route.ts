import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { listProviderEvents } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? undefined
  const provider = url.searchParams.get('provider') ?? undefined
  const reference = url.searchParams.get('reference') ?? undefined
  const limitParam = Number(url.searchParams.get('limit') ?? '50')
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, limitParam)) : 50

  return NextResponse.json({
    data: await listProviderEvents({ status, provider, reference, limit }),
    success: true,
  })
}
