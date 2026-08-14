import { NextResponse } from 'next/server'
import { syncAllCryptoDepositAddressesToAlchemy } from '@/lib/server/alchemy-address-webhooks'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const expected = process.env.MAFITAPAY_JOB_SECRET?.trim()
  if (!expected || request.headers.get('x-mafitapay-job-secret') !== expected) {
    return NextResponse.json({ success: false, error: 'Unauthorized job request.' }, { status: 401 })
  }

  try {
    const result = await syncAllCryptoDepositAddressesToAlchemy()
    console.log('[alchemy-webhook] address subscription sync completed', result)
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('[alchemy-webhook] address subscription sync failed', error)
    return NextResponse.json({ success: false, error: 'Unable to synchronize Alchemy webhook addresses.' }, { status: 502 })
  }
}
