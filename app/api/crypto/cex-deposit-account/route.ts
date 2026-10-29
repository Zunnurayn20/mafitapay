import { randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { createCexDepositAccount, deleteCexDepositAccount, getCexDepositAccountByUser, refreshExpiredCexDepositChallenge } from '@/lib/server/data'
import type { CexExchange } from '@/types'

const EXCHANGES: CexExchange[] = ['bybit', 'bitget']

function isExchangeConfigured(exchange: CexExchange) {
  if (process.env.MAFITAPAY_CEX_DEPOSITS_ENABLED !== '1') return false
  if (exchange === 'bybit') {
    return Boolean(
      process.env.MAFITAPAY_BYBIT_API_KEY?.trim()
      && process.env.MAFITAPAY_BYBIT_API_SECRET?.trim()
      && process.env.MAFITAPAY_BYBIT_DEPOSIT_UID?.trim(),
    )
  }
  return Boolean(
    process.env.MAFITAPAY_BITGET_API_KEY?.trim()
    && process.env.MAFITAPAY_BITGET_API_SECRET?.trim()
    && process.env.MAFITAPAY_BITGET_API_PASSPHRASE?.trim()
    && process.env.MAFITAPAY_BITGET_DEPOSIT_UID?.trim(),
  )
}

function receivingUid(exchange: CexExchange) {
  return exchange === 'bybit'
    ? process.env.MAFITAPAY_BYBIT_DEPOSIT_UID?.trim() ?? null
    : process.env.MAFITAPAY_BITGET_DEPOSIT_UID?.trim() ?? null
}

function normalizeSenderIdentifier(exchange: CexExchange, value: string) {
  const identifier = value.trim()
  if (/^\d{4,24}$/.test(identifier)) return identifier
  if (exchange !== 'bitget') return ''
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return identifier.toLowerCase()
  if (/^\+?[0-9][0-9 ()-]{5,23}$/.test(identifier)) return identifier.replace(/[ ()-]/g, '')
  return ''
}

function parseExchange(value: unknown): CexExchange | null {
  return value === 'bybit' || value === 'bitget' ? value : null
}

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const exchanges = Object.fromEntries(await Promise.all(EXCHANGES.map(async exchange => {
    const enabled = isExchangeConfigured(exchange)
    const account = enabled ? await getCexDepositAccountByUser(user.id, exchange) : null
    return [exchange, { exchange, enabled, receivingUid: enabled ? receivingUid(exchange) : null, account }]
  }))) as Record<CexExchange, { exchange: CexExchange; enabled: boolean; receivingUid: string | null; account: Awaited<ReturnType<typeof getCexDepositAccountByUser>> }>
  return NextResponse.json({
    data: { enabled: Object.values(exchanges).some(item => item.enabled), exchanges },
    success: true,
  })
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  let body: { exchange?: unknown; senderUid?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.', success: false }, { status: 400 })
  }

  const exchange = parseExchange(body.exchange)
  if (!exchange) return NextResponse.json({ error: 'Choose a supported exchange.', success: false }, { status: 400 })
  if (!isExchangeConfigured(exchange)) {
    return NextResponse.json({ error: `${exchange === 'bybit' ? 'Bybit' : 'Bitget'} deposits are not configured yet.`, success: false }, { status: 503 })
  }
  const senderIdentifier = typeof body.senderUid === 'string' ? normalizeSenderIdentifier(exchange, body.senderUid) : ''
  if (!senderIdentifier) {
    const expected = exchange === 'bybit' ? 'UID' : 'UID, email, or phone number'
    return NextResponse.json({ error: `Enter a valid ${exchange === 'bybit' ? 'Bybit' : 'Bitget'} ${expected}.`, success: false }, { status: 400 })
  }
  const externalUid = senderIdentifier

  const existing = await getCexDepositAccountByUser(user.id, exchange)
  if (existing) {
    if (existing.externalUid === externalUid && existing.status === 'pending_verification') {
      if (new Date(existing.challengeExpiresAt).getTime() > Date.now()) {
        return NextResponse.json({ data: { account: existing }, success: true })
      }
      const refreshed = await refreshExpiredCexDepositChallenge({
        userId: user.id,
        exchange,
        externalUid,
        challengeAmount: Number((101 + randomInt(0, 99)) / 100),
        challengeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      if (refreshed) return NextResponse.json({ data: { account: refreshed }, success: true })
    }
    return NextResponse.json({ error: `A ${exchange === 'bybit' ? 'Bybit' : 'Bitget'} UID is already linked to this account.`, success: false }, { status: 409 })
  }

  try {
    const account = await createCexDepositAccount({
      userId: user.id,
      exchange,
      externalUid,
      challengeAmount: Number((101 + randomInt(0, 99)) / 100),
      challengeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    return NextResponse.json({ data: { account }, success: true })
  } catch {
    return NextResponse.json({ error: `That ${exchange === 'bybit' ? 'Bybit' : 'Bitget'} UID is already linked to a MafitaPay account, or could not be linked.`, success: false }, { status: 409 })
  }
}

export async function DELETE(request: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()
  const exchange = parseExchange(new URL(request.url).searchParams.get('exchange')) ?? 'bybit'
  await deleteCexDepositAccount(user.id, exchange)
  return NextResponse.json({ success: true })
}
