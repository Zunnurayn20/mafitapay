import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { ensureFlutterwavePayoutSyncScheduler, syncPendingFlutterwavePayouts } from '@/lib/server/payout-sync-batch'
import { sanitizeErrorForLogs } from '@/lib/utils'

export const runtime = 'nodejs'

export async function POST() {
  const user = await requireUser()
  if (!user) return unauthorized()

  ensureFlutterwavePayoutSyncScheduler()

  try {
    const data = await syncPendingFlutterwavePayouts(user.id, { userId: user.id, onlyDue: true })
    return NextResponse.json({ data, success: true })
  } catch (error) {
    console.error('[wallet/payouts/sync] failed', sanitizeErrorForLogs(error))
    return NextResponse.json({ error: 'Transfer status could not be refreshed. Please try again shortly.', success: false }, { status: 500 })
  }
}
