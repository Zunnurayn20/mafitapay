import { randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { createCexDepositAccount, deleteCexDepositAccount, getCexDepositAccountByUser, refreshExpiredCexDepositChallenge } from '@/lib/server/data'
import type { CexExchange } from '@/types'

const EXCHANGE: CexExchange = 'bybit'

function isBybitDepositConfigured() {
  return Boolean(
    process.env.MAFITAPAY_CEX_DEPOSITS_ENABLED === '1'
      && process.env.MAFITAPAY_BYBIT_API_KEY?.trim()
      && process.env.MAFITAPAY_BYBIT_API_SECRET?.trim()
      && process.env.MAFITAPAY_BYBIT_DEPOSIT_UID?.trim(),
  )
}

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const enabled = isBybitDepositConfigured()
  const account = enabled ? await getCexDepositAccountByUser(user.id, EXCHANGE) : null
  return NextResponse.json({
    data: {
      exchange: EXCHANGE,
      enabled,
      receivingUid: enabled ? process.env.MAFITAPAY_BYBIT_DEPOSIT_UID!.trim() : null,
      account,
    },
    success: true,
  })
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()
  if (!isBybitDepositConfigured()) {
    return NextResponse.json({ error: 'Exchange deposits are not configured yet.', success: false }, { status: 503 })
  }

  let body: { exchange?: unknown; senderUid?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.', success: false }, { status: 400 })
  }

  const exchange = body.exchange === 'bybit' ? body.exchange : null
  const externalUid = typeof body.senderUid === 'string' ? body.senderUid.trim() : ''
  if (exchange !== EXCHANGE || !/^\d{4,24}$/.test(externalUid)) {
    return NextResponse.json({ error: 'Enter a valid Bybit UID.', success: false }, { status: 400 })
  }

  const existing = await getCexDepositAccountByUser(user.id, EXCHANGE)
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
    return NextResponse.json({ error: 'A Bybit UID is already linked to this account.', success: false }, { status: 409 })
  }

  const challengeAmount = Number((101 + randomInt(0, 99)) / 100)
  const challengeExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  try {
    const account = await createCexDepositAccount({
      userId: user.id,
      exchange,
      externalUid,
      challengeAmount,
      challengeExpiresAt,
    })
    return NextResponse.json({ data: { account }, success: true })
  } catch {
    return NextResponse.json({ error: 'That Bybit UID is already linked to a MafitaPay account, or could not be linked.', success: false }, { status: 409 })
  }
}

export async function DELETE() {
  const user = await requireUser()
  if (!user) return unauthorized()
  await deleteCexDepositAccount(user.id, EXCHANGE)
  return NextResponse.json({ success: true })
}
