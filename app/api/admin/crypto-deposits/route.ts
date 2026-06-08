import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import {
  forceScanDepositAddress,
  kickCryptoDepositScanner,
  syncCryptoDepositEventsOnce,
} from '@/lib/server/crypto-deposit-scanner'
import { getRecentSweepGasStats } from '@/lib/server/crypto-deposit-sweeper'
import { listCryptoDepositEvents, getCryptoDepositEventByExternalId } from '@/lib/server/data'
import { sweepCryptoDepositEvent } from '@/lib/server/crypto-deposit-sweeper'

export async function GET(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') || 50)
  const userId = searchParams.get('userId') || undefined
  const pairId = searchParams.get('pairId') || undefined
  const status = searchParams.get('status') as any || undefined
  const sweepStatus = searchParams.get('sweepStatus') || undefined

  const events = await listCryptoDepositEvents({ limit, userId, pairId, status, sweepStatus })
  const recentGasStats = getRecentSweepGasStats()
  return NextResponse.json({ data: events, recentGasStats, success: true })
}

export async function POST(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const intent = body.intent || body.action || 'list'

  if (intent === 'force-scan' || intent === 'forceScan') {
    const address = typeof body.address === 'string' ? body.address.trim() : ''
    const pairId = typeof body.pairId === 'string' ? body.pairId.trim() : undefined
    if (!address) {
      return NextResponse.json({ error: 'address is required', success: false }, { status: 400 })
    }
    try {
      const result = await forceScanDepositAddress({ address, pairId })
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Force scan failed', success: false }, { status: 400 })
    }
  }

  if (intent === 'resweep' || intent === 'sweep') {
    const externalEventId = typeof body.externalEventId === 'string' ? body.externalEventId.trim() : ''
    if (!externalEventId) {
      return NextResponse.json({ error: 'externalEventId is required', success: false }, { status: 400 })
    }
    const event = await getCryptoDepositEventByExternalId(externalEventId)
    if (!event) {
      return NextResponse.json({ error: 'Event not found', success: false }, { status: 404 })
    }
    try {
      const sweepRes = await sweepCryptoDepositEvent(event)
      return NextResponse.json({ data: { swept: sweepRes.swept, reason: sweepRes.reason, txHash: sweepRes.txHash }, success: true })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Resweep failed', success: false }, { status: 400 })
    }
  }

  if (intent === 'sync' || intent === 'full-scan') {
    const res = await kickCryptoDepositScanner()
    return NextResponse.json({ data: res, success: true })
  }

  // default: trigger a background sync
  void syncCryptoDepositEventsOnce().catch(() => {})
  return NextResponse.json({ data: { triggered: true }, success: true })
}
