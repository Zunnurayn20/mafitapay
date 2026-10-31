import { randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { createCexDepositAccount, deleteCexDepositAccount, getCexDepositAccountByUser, listCexDepositAccountActiveIdentifiers, refreshExpiredCexDepositChallenge } from '@/lib/server/data'
import type { CexExchange } from '@/types'

const EXCHANGES: CexExchange[] = ['bybit', 'bitget', 'okx', 'mexc', 'gateio']

function exchangeName(exchange: CexExchange) {
  return exchange === 'bybit' ? 'Bybit' : exchange === 'bitget' ? 'Bitget' : exchange === 'okx' ? 'OKX' : exchange === 'mexc' ? 'MEXC' : 'Gate.io'
}

function isExchangeConfigured(exchange: CexExchange) {
  if (process.env.MAFITAPAY_CEX_DEPOSITS_ENABLED !== '1') return false
  if (exchange === 'bybit') {
    return Boolean(
      process.env.MAFITAPAY_BYBIT_API_KEY?.trim()
      && process.env.MAFITAPAY_BYBIT_API_SECRET?.trim()
      && process.env.MAFITAPAY_BYBIT_DEPOSIT_UID?.trim(),
    )
  }
  if (exchange === 'bitget') return Boolean(
    process.env.MAFITAPAY_BITGET_API_KEY?.trim()
    && process.env.MAFITAPAY_BITGET_API_SECRET?.trim()
    && process.env.MAFITAPAY_BITGET_API_PASSPHRASE?.trim()
    && process.env.MAFITAPAY_BITGET_DEPOSIT_UID?.trim(),
  )
  if (exchange === 'okx') return Boolean(
    process.env.MAFITAPAY_OKX_API_KEY?.trim()
    && process.env.MAFITAPAY_OKX_API_SECRET?.trim()
    && process.env.MAFITAPAY_OKX_API_PASSPHRASE?.trim()
    && process.env.MAFITAPAY_OKX_DEPOSIT_UID?.trim(),
  )
  if (exchange === 'mexc') return Boolean(
    process.env.MAFITAPAY_MEXC_API_KEY?.trim()
    && process.env.MAFITAPAY_MEXC_API_SECRET?.trim()
    && process.env.MAFITAPAY_MEXC_DEPOSIT_UID?.trim(),
  )
  return Boolean(
    process.env.MAFITAPAY_GATEIO_API_KEY?.trim()
    && process.env.MAFITAPAY_GATEIO_API_SECRET?.trim()
    && process.env.MAFITAPAY_GATEIO_DEPOSIT_UID?.trim(),
  )
}

function receivingUid(exchange: CexExchange) {
  if (exchange === 'bybit') return process.env.MAFITAPAY_BYBIT_DEPOSIT_UID?.trim() ?? null
  if (exchange === 'bitget') return process.env.MAFITAPAY_BITGET_DEPOSIT_UID?.trim() ?? null
  if (exchange === 'okx') return process.env.MAFITAPAY_OKX_DEPOSIT_UID?.trim() ?? null
  if (exchange === 'mexc') return process.env.MAFITAPAY_MEXC_DEPOSIT_UID?.trim() ?? null
  return process.env.MAFITAPAY_GATEIO_DEPOSIT_UID?.trim() ?? null
}

function normalizeSenderIdentifier(exchange: CexExchange, value: string) {
  const identifier = value.trim()
  if (/^\d{4,24}$/.test(identifier)) return identifier
  if (exchange === 'okx') {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return identifier.toLowerCase()
    const phone = identifier.replace(/[ ()-]/g, '')
    return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : ''
  }
  if (exchange !== 'bitget' && exchange !== 'mexc') return ''
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return identifier.toLowerCase()
  if (/^\+?[0-9][0-9 ()-]{5,23}$/.test(identifier)) return identifier.replace(/[ ()-]/g, '')
  return ''
}

function parseExchange(value: unknown): CexExchange | null {
  return value === 'bybit' || value === 'bitget' || value === 'okx' || value === 'mexc' || value === 'gateio' ? value : null
}

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const exchanges = Object.fromEntries(await Promise.all(EXCHANGES.map(async exchange => {
    const enabled = isExchangeConfigured(exchange)
    const storedAccount = enabled ? await getCexDepositAccountByUser(user.id, exchange) : null
    const externalIdentifiers = storedAccount ? await listCexDepositAccountActiveIdentifiers(user.id, exchange) : []
    const account = storedAccount ? { ...storedAccount, externalIdentifiers } : null
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

  let body: { exchange?: unknown; senderUid?: unknown; senderEmail?: unknown; senderPhone?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.', success: false }, { status: 400 })
  }

  const exchange = parseExchange(body.exchange)
  if (!exchange) return NextResponse.json({ error: 'Choose a supported exchange.', success: false }, { status: 400 })
  if (!isExchangeConfigured(exchange)) {
    return NextResponse.json({ error: `${exchangeName(exchange)} deposits are not configured yet.`, success: false }, { status: 503 })
  }
  let externalIdentifiers: string[]
  if (exchange === 'okx') {
    const senderEmail = typeof body.senderEmail === 'string' ? normalizeSenderIdentifier(exchange, body.senderEmail) : ''
    const senderPhone = typeof body.senderPhone === 'string' ? normalizeSenderIdentifier(exchange, body.senderPhone) : ''
    if (!senderEmail.includes('@') || !senderPhone.startsWith('+')) {
      return NextResponse.json({ error: 'Enter the email and phone number associated with your OKX account. Use international phone format, such as +2348012345678.', success: false }, { status: 400 })
    }
    externalIdentifiers = [senderEmail, senderPhone]
  } else {
    const senderIdentifier = typeof body.senderUid === 'string' ? normalizeSenderIdentifier(exchange, body.senderUid) : ''
    if (!senderIdentifier) {
      const expected = exchange === 'bybit' || exchange === 'gateio' ? 'UID' : 'UID, email, or phone number'
      return NextResponse.json({ error: `Enter a valid ${exchangeName(exchange)} ${expected}.`, success: false }, { status: 400 })
    }
    externalIdentifiers = [senderIdentifier]
  }
  const externalUid = externalIdentifiers[0]

  const existing = await getCexDepositAccountByUser(user.id, exchange)
  if (existing) {
    const existingIdentifiers = await listCexDepositAccountActiveIdentifiers(user.id, exchange)
    const sameIdentifiers = existing.externalUid === externalUid
      && existingIdentifiers.length === externalIdentifiers.length
      && existingIdentifiers.every(identifier => externalIdentifiers.includes(identifier))
    if (sameIdentifiers && existing.status === 'pending_verification') {
      if (new Date(existing.challengeExpiresAt).getTime() > Date.now()) {
        return NextResponse.json({ data: { account: { ...existing, externalIdentifiers: existingIdentifiers } }, success: true })
      }
      const refreshed = await refreshExpiredCexDepositChallenge({
        userId: user.id,
        exchange,
        externalUid,
        challengeAmount: Number((101 + randomInt(0, 99)) / 100),
        challengeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      if (refreshed) return NextResponse.json({ data: { account: { ...refreshed, externalIdentifiers: existingIdentifiers } }, success: true })
    }
    if (sameIdentifiers) return NextResponse.json({ data: { account: { ...existing, externalIdentifiers: existingIdentifiers } }, success: true })
    if (exchange === 'okx') return NextResponse.json({ error: 'This OKX account is already linked. Unlink it first, then link again with both the email and phone number.', success: false }, { status: 409 })
    return NextResponse.json({ error: `A ${exchangeName(exchange)} account is already linked to this account.`, success: false }, { status: 409 })
  }

  try {
    const account = await createCexDepositAccount({
      userId: user.id,
      exchange,
      externalUid,
      externalIdentifiers,
      challengeAmount: Number((101 + randomInt(0, 99)) / 100),
      challengeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    return NextResponse.json({ data: { account: { ...account, externalIdentifiers } }, success: true })
  } catch {
    return NextResponse.json({ error: `That ${exchangeName(exchange)} account is already linked to a MafitaPay account, or could not be linked.`, success: false }, { status: 409 })
  }
}

export async function DELETE(request: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()
  const exchange = parseExchange(new URL(request.url).searchParams.get('exchange')) ?? 'bybit'
  await deleteCexDepositAccount(user.id, exchange)
  return NextResponse.json({ success: true })
}
