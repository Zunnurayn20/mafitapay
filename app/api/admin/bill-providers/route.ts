import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getBillProviders, upsertBillProviders } from '@/lib/server/data'
import type { BillProvider } from '@/types'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: await getBillProviders(), success: true })
}

export async function PATCH(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const providers = Array.isArray(body.providers) ? body.providers as BillProvider[] : null

  if (!providers) {
    return NextResponse.json({ error: 'providers array is required.', success: false }, { status: 400 })
  }

  return NextResponse.json({ data: await upsertBillProviders(providers), success: true })
}
