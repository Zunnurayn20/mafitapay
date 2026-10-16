import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { syncPendingFlutterwaveBills } from '@/lib/server/flutterwave-bill-sync-batch'

export const runtime = 'nodejs'

export async function POST() {
  const user = await requireUser()
  if (!user) return unauthorized()

  try {
    const data = await syncPendingFlutterwaveBills(user.id, { userId: user.id, onlyDue: true })
    return NextResponse.json({ data, success: true })
  } catch (error) {
    console.error('[wallet/bills/sync] failed', error instanceof Error ? error.message : 'Bill sync failed.')
    return NextResponse.json({ error: 'Bill status could not be refreshed.', success: false }, { status: 500 })
  }
}
