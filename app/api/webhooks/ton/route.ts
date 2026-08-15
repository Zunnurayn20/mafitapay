import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCryptoDepositAddressByAddress } from '@/lib/server/data'
import { forceScanDepositAddress } from '@/lib/server/crypto-deposit-scanner'
import { getTonWebhookToken, toStoredTonAddress } from '@/lib/server/ton-address-webhooks'

export const runtime = 'nodejs'

type TonWebhookPayload = {
  account_id?: unknown
  tx_hash?: unknown
  lt?: unknown
}

function tokenMatches(provided: string | null, expected: string) {
  if (!provided || !expected) return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  try {
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const expected = getTonWebhookToken()
  const provided = new URL(request.url).searchParams.get('token')
  if (!tokenMatches(provided, expected)) {
    console.warn('[ton-webhook] rejected request with invalid token')
    return NextResponse.json({ success: false, error: 'Invalid webhook token.' }, { status: 401 })
  }

  const rawBody = await request.text()
  let payload: TonWebhookPayload
  try {
    payload = JSON.parse(rawBody) as TonWebhookPayload
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const accountId = typeof payload.account_id === 'string' ? payload.account_id.trim() : ''
  if (!accountId) {
    return NextResponse.json({ success: true, ignored: true })
  }

  let storedAddress: string
  try {
    storedAddress = toStoredTonAddress(accountId)
  } catch {
    console.warn('[ton-webhook] ignored unparseable account_id')
    return NextResponse.json({ success: true, ignored: true })
  }

  const record = await getCryptoDepositAddressByAddress(storedAddress)
  if (!record || record.addressFamily !== 'ton') {
    return NextResponse.json({ success: true, ignored: true })
  }

  try {
    // TonAPI only tells us that something happened. Re-scan the address so amounts and
    // settlement come from chain data, same as the Alchemy path.
    await forceScanDepositAddress({ address: record.address, chain: 'ton', backgroundReconcile: false })
  } catch (error) {
    console.error('[ton-webhook] deposit scan failed', {
      address: record.address,
      txHash: typeof payload.tx_hash === 'string' ? payload.tx_hash : null,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ success: false, error: 'Deposit processing failed; please retry.' }, { status: 500 })
  }

  console.log(`[ton-webhook] scanned address=${record.address} tx=${typeof payload.tx_hash === 'string' ? payload.tx_hash : 'n/a'}`)
  return NextResponse.json({ success: true, scanned: 1 })
}
