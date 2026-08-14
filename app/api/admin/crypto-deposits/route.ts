import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import {
  forceScanDepositAddress,
  kickCryptoDepositScanner,
  syncCryptoDepositEventsOnce,
} from '@/lib/server/crypto-deposit-scanner'
import { getRecentSweepGasStats, runEvmTreasuryBatchConversion, sweepCryptoDepositEvent } from '@/lib/server/crypto-deposit-sweeper'
import {
  listCryptoDepositEvents,
  getCryptoDepositEventByExternalId,
  createCexDepositIntent,
  recordBinanceInternalDeposit,
  getCexDepositIntentByReference,
  syncBinanceCexDeposits,
  listCexDepositIntents,
} from '@/lib/server/data'

export async function GET(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') || 50)
  const userId = searchParams.get('userId') || undefined
  const pairId = searchParams.get('pairId') || undefined
  const status = searchParams.get('status') as any || undefined
  const sweepStatus = searchParams.get('sweepStatus') || undefined
  const source = searchParams.get('source') as any || undefined

  const events = await listCryptoDepositEvents({ limit, userId, pairId, status, sweepStatus, source } as any)
  const recentGasStats = getRecentSweepGasStats()

  // Include pending CEX intents for visibility into outstanding user deposit instructions (memos)
  // This helps admins see what references have been issued via SellModal but not yet matched by the poller.
  const pendingCexIntents = await listCexDepositIntents({ status: 'pending', limit: 100 })

  return NextResponse.json({ data: events, recentGasStats, pendingCexIntents, success: true })
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

  if (intent === 'treasury-batch-preview') {
    const chain = body.chain === 'bsc' || body.chain === 'polygon' ? body.chain : undefined
    const result = await runEvmTreasuryBatchConversion({ chain, dryRun: true, allowBelowThreshold: true })
    return NextResponse.json({ data: result, success: true })
  }

  if (intent === 'treasury-batch-convert') {
    if (body.confirm !== 'CONVERT') {
      return NextResponse.json({ error: 'Explicit conversion confirmation is required.', success: false }, { status: 400 })
    }
    const chain = body.chain === 'bsc' || body.chain === 'polygon' ? body.chain : undefined
    const result = await runEvmTreasuryBatchConversion({ chain, allowBelowThreshold: true })
    return NextResponse.json({ data: result, success: true })
  }

  // Record a Binance internal transfer (CEX deposit). No on-chain tx. Triggers NGN credit.
  // Body: { intent: 'record-binance', userId, pairId, amountCrypto, amountUnits, cexTxId, memo?, cexUid? }
  if (intent === 'record-binance' || intent === 'recordBinanceDeposit') {
    const { userId, pairId, amountCrypto, amountUnits, cexTxId, memo, cexUid } = body
    if (!userId || !pairId || !amountCrypto || !amountUnits || !cexTxId) {
      return NextResponse.json({ error: 'userId, pairId, amountCrypto, amountUnits, cexTxId are required', success: false }, { status: 400 })
    }
    try {
      const event = await recordBinanceInternalDeposit({
        userId,
        pairId,
        amountCrypto: Number(amountCrypto),
        amountUnits: String(amountUnits),
        cexTxId: String(cexTxId),
        memo: memo ? String(memo) : undefined,
        cexUid: cexUid ? String(cexUid) : undefined,
      })
      return NextResponse.json({ data: event, success: true })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to record Binance deposit', success: false }, { status: 400 })
    }
  }

  // Create a Binance deposit intent (so user gets a reference to put in Binance memo)
  if (intent === 'create-binance-intent' || intent === 'createBinanceIntent') {
    const { userId, pairId, expectedAmountCrypto, cexUid, note } = body
    if (!userId || !pairId || !expectedAmountCrypto) {
      return NextResponse.json({ error: 'userId, pairId, expectedAmountCrypto are required', success: false }, { status: 400 })
    }
    try {
      const reference = `BIN-${userId.slice(-6)}-${Date.now().toString(36)}`
      const intentRec = await createCexDepositIntent({
        userId,
        reference,
        exchange: 'binance',
        pairId,
        expectedAmountCrypto: Number(expectedAmountCrypto),
        cexUid: cexUid || process.env.MAFITAPAY_BINANCE_DEPOSIT_UID || 'SET_BINANCE_UID',
        memo: reference,
        note: note ? String(note) : undefined,
      })
      return NextResponse.json({ data: intentRec, success: true })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create intent', success: false }, { status: 400 })
    }
  }

  if (intent === 'sync-binance-cex' || intent === 'syncBinanceCex') {
    const res = await syncBinanceCexDeposits()
    return NextResponse.json({ data: res, success: true })
  }

  // default: trigger a background sync
  void syncCryptoDepositEventsOnce().catch(() => {})
  return NextResponse.json({ data: { triggered: true }, success: true })
}
