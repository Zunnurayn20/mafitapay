import { NextResponse } from 'next/server'
import { syncCryptoDepositEventsOnce } from '@/lib/server/crypto-deposit-scanner'
import { syncCexInternalDepositsOnce } from '@/lib/server/cex-deposits'

export const runtime = 'nodejs'
// A scanner pass is capped at 45 seconds. Leave a small response margin above that limit.
export const maxDuration = 60

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
    console.log('[crypto-deposit-scanner] job dryRun requested')
    return NextResponse.json({
      data: {
        ok: true,
        job: 'crypto_deposit_sync',
      },
      success: true,
    })
  }

  console.log('[crypto-deposit-scanner] job sync triggered (via /api/jobs/crypto-deposits/sync)')
  const [onchainResult, cexResult] = await Promise.allSettled([
    syncCryptoDepositEventsOnce(),
    syncCexInternalDepositsOnce(),
  ])
  if (onchainResult.status === 'rejected') {
    console.error('[crypto-deposit-scanner] on-chain sync failed:', onchainResult.reason instanceof Error ? onchainResult.reason.message : 'unknown error')
  }
  if (cexResult.status === 'rejected') {
    console.error('[crypto-cex-deposits] sync failed:', cexResult.reason instanceof Error ? cexResult.reason.message : 'unknown error')
  }
  const result = {
    onchain: onchainResult.status === 'fulfilled' ? onchainResult.value : { error: 'on-chain sync failed' },
    cex: cexResult.status === 'fulfilled' ? cexResult.value : { error: 'CEX sync failed' },
  }
  console.log('[crypto-deposit-sync] job result:', result)
  return NextResponse.json({
    data: result,
    success: true,
  })
}

