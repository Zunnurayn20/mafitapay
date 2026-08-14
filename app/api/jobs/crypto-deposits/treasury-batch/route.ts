import { NextResponse } from 'next/server'
import { runEvmTreasuryBatchConversion } from '@/lib/server/crypto-deposit-sweeper'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const expected = process.env.MAFITAPAY_JOB_SECRET?.trim()
  if (!expected || request.headers.get('x-mafitapay-job-secret') !== expected) {
    return NextResponse.json({ success: false, error: 'Unauthorized job request.' }, { status: 401 })
  }

  const chain = new URL(request.url).searchParams.get('chain')
  if (chain && chain !== 'bsc' && chain !== 'polygon') {
    return NextResponse.json({ success: false, error: 'chain must be bsc or polygon.' }, { status: 400 })
  }

  const result = await runEvmTreasuryBatchConversion({ chain: chain as 'bsc' | 'polygon' | null ?? undefined })
  return NextResponse.json({ success: true, data: result })
}
