import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { listBeneficiaries } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const includeArchived = url.searchParams.get('includeArchived') === 'true'

  return NextResponse.json({
    data: await listBeneficiaries(user.id, kind === 'bank' || kind === 'internal' ? kind : undefined, includeArchived),
    success: true,
  })
}
