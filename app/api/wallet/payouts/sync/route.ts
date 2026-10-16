import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { ensureFlutterwavePayoutSyncScheduler, syncPendingFlutterwavePayouts } from '@/lib/server/payout-sync-batch'

export const runtime = 'nodejs'

export async function POST() {
  const user = await requireUser()
  if (!user) return unauthorized()

  ensureFlutterwavePayoutSyncScheduler()

  try {
    const data = await syncPendingFlutterwavePayouts(user.id, { userId: user.id, onlyDue: true })
    return NextResponse.json({ data, success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payout sync failed.'
    return NextResponse.json({ error: message, success: false }, { status: 500 })
  }
}
