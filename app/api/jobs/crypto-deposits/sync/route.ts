import { NextResponse } from 'next/server'
import { syncCryptoDepositEventsOnce } from '@/lib/server/crypto-deposit-scanner'

export const runtime = 'nodejs'

function isAuthorized(request: Request) {
  const expected = process.env.MAFITAPAY_JOB_SECRET
  if (!expected) return false

  const provided = request.headers.get('x-mafitapay-job-secret')
  return provided === expected
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized job request.', success: false }, { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') === 'true'

  if (dryRun) {
    return NextResponse.json({
      data: {
        ok: true,
        job: 'crypto_deposit_sync',
      },
      success: true,
    })
  }

  return NextResponse.json({
    data: await syncCryptoDepositEventsOnce(),
    success: true,
  })
}

