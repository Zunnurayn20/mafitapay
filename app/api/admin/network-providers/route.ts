import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getNetworkProviders, upsertNetworkProviders } from '@/lib/server/data'
import type { NetworkProvider } from '@/types'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: await getNetworkProviders(), success: true })
}

export async function PATCH(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const providers = Array.isArray(body.providers) ? body.providers as NetworkProvider[] : null

  if (!providers) {
    return NextResponse.json({ error: 'providers array is required.', success: false }, { status: 400 })
  }

  return NextResponse.json({ data: await upsertNetworkProviders(providers), success: true })
}
