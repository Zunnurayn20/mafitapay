import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getProviderDiagnosticsReport } from '@/lib/server/data'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  return NextResponse.json({
    data: await getProviderDiagnosticsReport(),
    success: true,
  })
}
