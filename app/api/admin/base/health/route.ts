import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getBaseExecutorHealth } from '@/lib/server/base-executor'

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  return NextResponse.json({ data: getBaseExecutorHealth(), success: true })
}
