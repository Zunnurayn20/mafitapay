import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { insertAuditLog, upsertProfitMargin } from '@/lib/server/data'
import { MARGIN_DEFINITIONS, listResolvedMargins, type MarginKey } from '@/lib/server/profit-margins'
import { clearAmigoCatalogCache } from '@/lib/server/amigo-bills'
import { clearAsbdataCatalogCache } from '@/lib/server/asbdata-bills'

const VALID_KEYS = new Set<string>(MARGIN_DEFINITIONS.map(entry => entry.key))

// Margins above this are almost certainly a typo (a stray zero) rather than intent. Pricing
// mistakes here are charged to real customers, so reject rather than accept silently.
const MAX_MARGIN_NGN = 100_000

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  return NextResponse.json({ data: await listResolvedMargins(), success: true })
}

export async function PATCH(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.', success: false }, { status: 400 })
  }

  const key = typeof body.key === 'string' ? body.key.trim() : ''
  if (!VALID_KEYS.has(key)) {
    return NextResponse.json({ error: 'Unknown margin key.', success: false }, { status: 400 })
  }

  const value = Number(body.valueNgn)
  if (!Number.isFinite(value)) {
    return NextResponse.json({ error: 'Margin must be a number.', success: false }, { status: 400 })
  }
  if (value < 0) {
    return NextResponse.json({ error: 'Margin cannot be negative.', success: false }, { status: 400 })
  }
  if (value > MAX_MARGIN_NGN) {
    return NextResponse.json({
      error: `Margin looks wrong — ₦${value.toLocaleString('en-NG')} exceeds the ₦${MAX_MARGIN_NGN.toLocaleString('en-NG')} ceiling.`,
      success: false,
    }, { status: 400 })
  }

  const saved = await upsertProfitMargin({
    key,
    valueNgn: value,
    updatedBy: admin.email,
  })

  // Bundle prices bake the margin in when the catalog is built and are cached, so the new margin
  // would not reach the app for up to five minutes without this.
  if (key === 'bills_amigo') clearAmigoCatalogCache()
  if (key === 'bills_asbdata') clearAsbdataCatalogCache()

  await insertAuditLog({
    actorUserId: admin.id,
    action: 'profit_margin.updated',
    entityType: 'profit_margin',
    entityId: key,
    metadata: { key: key as MarginKey, valueNgn: saved.valueNgn },
  })

  return NextResponse.json({ data: await listResolvedMargins(), success: true })
}
