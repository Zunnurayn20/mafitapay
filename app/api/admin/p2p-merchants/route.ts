import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getP2PMerchants, upsertP2PMerchants } from '@/lib/server/data'
import type { P2PMerchant } from '@/types'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: await getP2PMerchants(), success: true })
}

export async function PATCH(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const merchants = Array.isArray(body.merchants) ? body.merchants as P2PMerchant[] : null

  if (!merchants) {
    return NextResponse.json({ error: 'merchants array is required.', success: false }, { status: 400 })
  }

  return NextResponse.json({ data: await upsertP2PMerchants(merchants), success: true })
}
