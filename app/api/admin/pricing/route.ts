import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import {
  createPricingRule,
  findPricingRuleByTarget,
  getPricingRuleById,
  getNetworkProviders,
  insertAuditLog,
  setPricingRuleActive,
  updatePricingRule,
} from '@/lib/server/data'
import {
  describeMargin,
  describeScope,
  loadPricingRulesForAdmin,
  validatePricingRuleInput,
  pricePlanNgn,
  PRICING_VENDORS,
  type PricingVendor,
} from '@/lib/server/data-pricing'
import { getPricedAmigoPlans } from '@/lib/server/amigo-bills'
import { getPricedAsbdataPlans, listAsbdataPlanTypes } from '@/lib/server/asbdata-bills'
import { getPricedBardetechPlans, listBardetechPlanTypes } from '@/lib/server/bardetech-bills'
import { isFlutterwaveBillsEnabled, listFlutterwaveDataBundleNetworkProviders } from '@/lib/server/flutterwave-bills'

/** Drop fields that do not apply to the chosen scope so unique targets stay consistent. */
function normalizeTargetFields<T extends {
  scope: string
  vendor: string | null
  network: string | null
  planType: string | null
  variationCode: string | null
}>(input: T): T {
  if (input.scope === 'GLOBAL') {
    return { ...input, network: null, planType: null, variationCode: null }
  }
  if (input.scope === 'NETWORK') {
    return { ...input, planType: null, variationCode: null }
  }
  if (input.scope === 'PLAN_TYPE') {
    return { ...input, variationCode: null }
  }
  return input
}

function parseMarginBody(body: Record<string, unknown>) {
  const scope = typeof body.scope === 'string' ? body.scope.trim().toUpperCase() : ''
  const vendorRaw = typeof body.vendor === 'string' ? body.vendor.trim().toLowerCase() : ''
  // Validate against the shared list so a new vendor cannot be silently dropped to null here.
  const vendor = (PRICING_VENDORS as readonly string[]).includes(vendorRaw)
    ? vendorRaw as PricingVendor
    : null
  const network = typeof body.network === 'string' && body.network.trim() ? body.network.trim() : null
  const planType = typeof body.planType === 'string' && body.planType.trim() ? body.planType.trim() : null
  const variationCode = typeof body.variationCode === 'string' && body.variationCode.trim()
    ? body.variationCode.trim()
    : null

  // Admin form sends percent / naira; store bps / kobo.
  const marginPercent = Number(body.marginPercent ?? (Number(body.marginBps) / 100))
  const marginFlatNgn = Number(body.marginFlatNgn ?? (Number(body.marginKobo) / 100))
  const minMarginNgn = Number(body.minMarginNgn ?? (Number(body.minMarginKobo) / 100))
  const maxRaw = body.maxMarginNgn ?? (body.maxMarginKobo != null ? Number(body.maxMarginKobo) / 100 : null)
  const maxMarginNgn = maxRaw === null || maxRaw === '' || maxRaw === undefined
    ? null
    : Number(maxRaw)
  const roundToNgn = Number(body.roundToNgn ?? (Number(body.roundToKobo) / 100))
  const note = typeof body.note === 'string' ? body.note.trim() : ''

  const marginBps = Math.round((Number.isFinite(marginPercent) ? marginPercent : 0) * 100)
  const marginKobo = Math.round((Number.isFinite(marginFlatNgn) ? marginFlatNgn : 0) * 100)
  const minMarginKobo = Math.round((Number.isFinite(minMarginNgn) ? minMarginNgn : 0) * 100)
  const maxMarginKobo = maxMarginNgn == null || !Number.isFinite(maxMarginNgn)
    ? null
    : Math.round(maxMarginNgn * 100)
  const roundToKobo = Math.round((Number.isFinite(roundToNgn) ? roundToNgn : 0) * 100)
  const hasRetailPrice = Object.prototype.hasOwnProperty.call(body, 'retailPriceNgn')
  const retailRaw = body.retailPriceNgn
  const retailPriceNgn = !hasRetailPrice
    ? undefined
    : retailRaw === null || retailRaw === ''
      ? null
      : Number(retailRaw)
  const retailPriceKobo = retailPriceNgn === undefined || retailPriceNgn === null
    ? retailPriceNgn
    : Number.isFinite(retailPriceNgn)
      ? Math.round(retailPriceNgn * 100)
      : Number.NaN

  return {
    scope,
    vendor,
    network,
    planType,
    variationCode,
    marginBps,
    marginKobo,
    minMarginKobo,
    maxMarginKobo,
    roundToKobo,
    retailPriceKobo,
    note: note || null,
  }
}

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const [rules, amigoPlans, asbdataPlans, asbdataPlanTypes, bardetechPlans, bardetechPlanTypes, baseNetworkProviders] = await Promise.all([
    loadPricingRulesForAdmin(),
    getPricedAmigoPlans().catch(() => []),
    getPricedAsbdataPlans().catch(() => []),
    listAsbdataPlanTypes(),
    getPricedBardetechPlans().catch(() => []),
    listBardetechPlanTypes(),
    getNetworkProviders(),
  ])

  const flutterwaveNetworkProviders = isFlutterwaveBillsEnabled()
    ? await listFlutterwaveDataBundleNetworkProviders(baseNetworkProviders).catch(() => baseNetworkProviders)
    : []
  const flutterwavePlans = flutterwaveNetworkProviders.flatMap(network => (network.dataBundles ?? []).map(bundle => {
    const priced = pricePlanNgn(rules, {
      vendor: 'flutterwave',
      network: network.name,
      planType: 'STANDARD',
      variationCode: bundle.itemCode,
    }, bundle.amount)
    return {
      name: `${network.name} ${bundle.label}`,
      variationCode: bundle.itemCode,
      costNgn: priced.costNgn,
      marginNgn: priced.marginNgn,
      retailNgn: priced.retailNgn,
      manualRetailNgn: priced.manualRetailNgn,
    }
  }))

  const preview = [
    ...amigoPlans.slice(0, 4).map(plan => ({
      vendor: 'amigo' as const,
      name: `${plan.network} ${plan.label}`,
      variationCode: String(plan.planId),
      costNgn: plan.costNgn,
      marginNgn: plan.marginNgn,
      retailNgn: plan.retailNgn,
      manualRetailNgn: plan.manualRetailNgn,
    })),
    ...asbdataPlans.slice(0, 4).map(plan => ({
      vendor: 'asbdata' as const,
      name: `${plan.network} ${plan.size}`,
      variationCode: String(plan.planId),
      costNgn: plan.costNgn,
      marginNgn: plan.marginNgn,
      retailNgn: plan.retailNgn,
      manualRetailNgn: plan.manualRetailNgn,
    })),
    ...bardetechPlans.slice(0, 4).map(plan => ({
      vendor: 'bardetech' as const,
      name: `${plan.network} ${plan.size}`,
      variationCode: String(plan.planId),
      costNgn: plan.costNgn,
      marginNgn: plan.marginNgn,
      retailNgn: plan.retailNgn,
      manualRetailNgn: plan.manualRetailNgn,
    })),
    ...flutterwavePlans.slice(0, 4).map(plan => ({ vendor: 'flutterwave' as const, ...plan })),
  ]

  const planTypes = Array.from(new Set([
    'STANDARD',
    'SME',
    'SME2',
    'GIFTING',
    'CORPORATE GIFTING',
    'AWOOF DATA',
    ...asbdataPlanTypes,
    ...bardetechPlanTypes,
    ...amigoPlans.map(plan => plan.planType),
  ])).sort()

  return NextResponse.json({
    success: true,
    data: {
      rules,
      preview,
      planTypes,
      networks: ['MTN', 'Airtel', 'Glo', '9mobile'],
    },
  })
}

export async function POST(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.', success: false }, { status: 400 })
  }

  const parsed = normalizeTargetFields(parseMarginBody(body))
  const validationError = validatePricingRuleInput(parsed)
  if (validationError) {
    return NextResponse.json({ error: validationError, success: false }, { status: 400 })
  }

  const existing = await findPricingRuleByTarget(parsed)
  if (existing) {
    return NextResponse.json({
      error: 'A rule for this target already exists. Edit or disable it instead.',
      success: false,
    }, { status: 409 })
  }

  const rule = await createPricingRule({
    ...parsed,
    retailPriceKobo: parsed.retailPriceKobo ?? null,
    createdBy: admin.email,
  })

  await insertAuditLog({
    actorUserId: admin.id,
    action: 'pricing_rule.created',
    entityType: 'pricing_rule',
    entityId: rule.id,
    metadata: {
      target: describeScope(rule),
      margin: describeMargin(rule),
    },
  })

  return NextResponse.json({ success: true, data: rule })
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

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return NextResponse.json({ error: 'Rule id is required.', success: false }, { status: 400 })
  }

  const existing = await getPricingRuleById(id)
  if (!existing) {
    return NextResponse.json({ error: 'Rule not found.', success: false }, { status: 404 })
  }

  // Toggle active without requiring margin fields.
  if (typeof body.active === 'boolean') {
    const updated = await setPricingRuleActive(id, body.active, admin.email)
    await insertAuditLog({
      actorUserId: admin.id,
      action: body.active ? 'pricing_rule.enabled' : 'pricing_rule.disabled',
      entityType: 'pricing_rule',
      entityId: id,
      metadata: { target: describeScope(existing), active: body.active },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  if (Object.prototype.hasOwnProperty.call(body, 'retailPriceNgn')) {
    if (existing.scope !== 'PLAN' || !existing.vendor || !existing.planType) {
      return NextResponse.json({ error: 'Manual customer prices require a specific provider plan and plan type.', success: false }, { status: 400 })
    }
    const parsedRetail = body.retailPriceNgn === null || body.retailPriceNgn === ''
      ? null
      : Number(body.retailPriceNgn)
    if (parsedRetail !== null && (!Number.isFinite(parsedRetail) || parsedRetail <= 0 || parsedRetail > 1_000_000)) {
      return NextResponse.json({ error: 'Enter a customer price greater than ₦0 and no more than ₦1,000,000.', success: false }, { status: 400 })
    }
    const updated = await updatePricingRule(id, {
      marginBps: existing.marginBps,
      marginKobo: existing.marginKobo,
      minMarginKobo: existing.minMarginKobo,
      maxMarginKobo: existing.maxMarginKobo,
      roundToKobo: existing.roundToKobo,
      retailPriceKobo: parsedRetail == null ? null : Math.round(parsedRetail * 100),
      note: existing.note,
      updatedBy: admin.email,
    })
    if (parsedRetail !== null && existing.active === false) {
      await setPricingRuleActive(id, true, admin.email)
    }
    await insertAuditLog({
      actorUserId: admin.id,
      action: parsedRetail === null ? 'pricing_rule.manual_price_cleared' : 'pricing_rule.manual_price_set',
      entityType: 'pricing_rule',
      entityId: id,
      metadata: {
        target: describeScope(existing),
        beforeRetailPriceNgn: existing.retailPriceKobo == null ? null : existing.retailPriceKobo / 100,
        afterRetailPriceNgn: parsedRetail,
      },
    })
    return NextResponse.json({ success: true, data: await getPricingRuleById(id) ?? updated })
  }

  const parsed = parseMarginBody({
    ...body,
    scope: existing.scope,
    vendor: existing.vendor,
    network: existing.network,
    planType: existing.planType,
    variationCode: existing.variationCode,
  })

  // Scope is fixed on update; only validate margin numbers.
  if (parsed.marginBps < 0 || parsed.marginKobo < 0 || parsed.minMarginKobo < 0) {
    return NextResponse.json({ error: 'Margins cannot be negative.', success: false }, { status: 400 })
  }

  const updated = await updatePricingRule(id, {
    marginBps: parsed.marginBps,
    marginKobo: parsed.marginKobo,
    minMarginKobo: parsed.minMarginKobo,
    maxMarginKobo: parsed.maxMarginKobo,
    roundToKobo: parsed.roundToKobo,
    note: parsed.note,
    updatedBy: admin.email,
  })

  await insertAuditLog({
    actorUserId: admin.id,
    action: 'pricing_rule.updated',
    entityType: 'pricing_rule',
    entityId: id,
    metadata: {
      target: describeScope(existing),
      before: {
        marginBps: existing.marginBps,
        marginKobo: existing.marginKobo,
        minMarginKobo: existing.minMarginKobo,
        maxMarginKobo: existing.maxMarginKobo,
        roundToKobo: existing.roundToKobo,
      },
      after: updated
        ? {
          marginBps: updated.marginBps,
          marginKobo: updated.marginKobo,
          minMarginKobo: updated.minMarginKobo,
          maxMarginKobo: updated.maxMarginKobo,
          roundToKobo: updated.roundToKobo,
        }
        : null,
      margin: updated ? describeMargin(updated) : null,
    },
  })

  return NextResponse.json({ success: true, data: updated })
}
