import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getZeroExHealth } from '@/lib/server/zerox'

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  return NextResponse.json({ data: getZeroExHealth(), success: true })
}
