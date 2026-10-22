import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getCryptoTradingSettings, updateCryptoTradingSettings } from '@/lib/server/data'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()
  return NextResponse.json({ data: await getCryptoTradingSettings(), success: true })
}

export async function PATCH(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', success: false }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A settings object is required.', success: false }, { status: 400 })
  }
  const input = body as Record<string, unknown>
  const hasBuys = Object.prototype.hasOwnProperty.call(input, 'buysEnabled')
  const hasSells = Object.prototype.hasOwnProperty.call(input, 'sellsEnabled')
  const hasMinimumSweepUsd = Object.prototype.hasOwnProperty.call(input, 'minimumSweepUsd')
  if ((!hasBuys && !hasSells && !hasMinimumSweepUsd)
    || (hasBuys && typeof input.buysEnabled !== 'boolean')
    || (hasSells && typeof input.sellsEnabled !== 'boolean')
    || (hasMinimumSweepUsd && (typeof input.minimumSweepUsd !== 'number' || !Number.isFinite(input.minimumSweepUsd) || input.minimumSweepUsd < 0 || input.minimumSweepUsd > 100_000 || Math.abs(Math.round(input.minimumSweepUsd * 100) - input.minimumSweepUsd * 100) > 1e-8))) {
    return NextResponse.json({ error: 'Provide valid buy/sell switches and/or a minimumSweepUsd value from $0 to $100,000 with at most two decimal places.', success: false }, { status: 400 })
  }

  const data = await updateCryptoTradingSettings({
    buysEnabled: hasBuys ? input.buysEnabled as boolean : undefined,
    sellsEnabled: hasSells ? input.sellsEnabled as boolean : undefined,
    minimumSweepUsd: hasMinimumSweepUsd ? input.minimumSweepUsd as number : undefined,
    updatedBy: user.id,
  })
  return NextResponse.json({ data, success: true })
}
