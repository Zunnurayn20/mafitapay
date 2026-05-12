import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { syncPendingFlutterwavePayouts } from '@/lib/server/payout-sync-batch'

export async function POST() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  return NextResponse.json({ data: await syncPendingFlutterwavePayouts(admin.id), success: true })
}
