import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { syncPendingFlutterwaveBills } from '@/lib/server/flutterwave-bill-sync-batch'
import { syncPendingBardetechBills } from '@/lib/server/bardetech-bill-sync'
import { syncPendingAsbdataBills } from '@/lib/server/asbdata-bill-sync'
import { sanitizeErrorForLogs } from '@/lib/utils'

export const runtime = 'nodejs'

export async function POST() {
  const user = await requireUser()
  if (!user) return unauthorized()

  try {
    const [flutterwave, bardetech, asbdata] = await Promise.all([
      syncPendingFlutterwaveBills(user.id, { userId: user.id, onlyDue: true }),
      syncPendingBardetechBills(user.id, { userId: user.id }),
      syncPendingAsbdataBills(user.id, { userId: user.id }),
    ])
    return NextResponse.json({ data: { flutterwave, bardetech, asbdata }, success: true })
  } catch (error) {
    console.error('[wallet/bills/sync] failed', sanitizeErrorForLogs(error))
    return NextResponse.json({ error: 'Bill status could not be refreshed.', success: false }, { status: 500 })
  }
}
