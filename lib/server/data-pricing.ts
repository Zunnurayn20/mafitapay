/**
 * Profit margin on wholesale data plan prices.
 *
 * Ported from online-data-sub. The vendor quotes a wholesale price per plan;
 * retail is wholesale plus an operator-configured margin. Rules live in
 * pricing_rules and resolve most-specific-first, so a house-wide default can
 * be overridden per network, plan type, or individual plan.
 *
 * All money is kobo (integer). Percentages are basis points — 250 bps = 2.5%.
 * Vendor field scopes a rule to Amigo, ASBDATA, or both (null / empty).
 */
import {
  getPricingRules,
  type PricingRuleRecord as StoredPricingRule,
} from '@/lib/server/data'

export const PRICING_SCOPES = ['PLAN', 'PLAN_TYPE', 'NETWORK', 'GLOBAL'] as const
export type PricingScope = (typeof PRICING_SCOPES)[number]

export const PRICING_VENDORS = ['amigo', 'asbdata', 'bardetech'] as const
export type PricingVendor = (typeof PRICING_VENDORS)[number]

/** Display names for rule descriptions. Keyed so a new vendor cannot fall through to a wrong label. */
const VENDOR_LABELS: Record<string, string> = {
  amigo: 'Amigo',
  asbdata: 'ASBDATA',
  bardetech: 'Bardetech',
}

/** Specificity order — lower index wins. */
const SCOPE_RANK: Record<PricingScope, number> = {
  PLAN: 0,
  PLAN_TYPE: 1,
  NETWORK: 2,
  GLOBAL: 3,
}

export const MAX_MARGIN_BPS = 10_000 // 100%
export const MAX_FLAT_MARGIN_KOBO = 500_000 // ₦5,000

export type PricingRuleInput = {
  scope: PricingScope
  vendor: PricingVendor | null
  network: string | null
  planType: string | null
  variationCode: string | null
  marginBps: number
  marginKobo: number
  minMarginKobo: number
  maxMarginKobo: number | null
  roundToKobo: number
}

export type PricingRuleRecord = PricingRuleInput & {
  id: string
  active: boolean
  note: string | null
  updatedAt: string
  createdAt: string
  createdBy?: string
  updatedBy?: string
}

export type PlanPricingTarget = {
  network: string
  planType: string
  variationCode: string
  vendor: PricingVendor
}

export type PriceBreakdown = {
  costKobo: number
  marginKobo: number
  retailKobo: number
  ruleId: string | null
}

export function nairaToKobo(naira: number): number {
  return Math.round(Math.max(0, naira) * 100)
}

export function koboToNaira(kobo: number): number {
  return Math.round(kobo) / 100
}

/** Normalize vendor plan-type labels (SME, GIFTING, …). */
export function normalizePlanType(raw: string | undefined | null): string {
  if (!raw?.trim()) return 'STANDARD'
  const s = raw.trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

  if (/\bSME\s*2\b|\bSME2\b/.test(s)) return 'SME2'
  if (/\bSME\b/.test(s) && !/CORPORATE/.test(s)) return 'SME'
  if (/CORPORATE\s*GIFT|CORP\s*GIFT|CORPORATE/.test(s)) return 'CORPORATE GIFTING'
  if (/\bAWOOF\b/.test(s)) return 'AWOOF DATA'
  if (/\bGIFTING\b|\bGIFT\b/.test(s)) return 'GIFTING'
  if (/\bCG\b/.test(s)) return 'CORPORATE GIFTING'
  if (/\bSTANDARD\b|\bREGULAR\b|\bDIRECT\b/.test(s)) return 'STANDARD'

  if (/\d+\s*(GB|MB)/i.test(s) || /\d+\s*DAY/i.test(s)) return 'STANDARD'

  if (s.length <= 24 && !/\d/.test(s)) return s
  return 'STANDARD'
}

/**
 * Pick the rule that applies to a plan. A rule matches when every field it
 * constrains equals the plan's. GLOBAL (nothing constrained) always matches.
 * Vendor-null rules match any vendor; vendor-specific rules only that vendor.
 */
export function resolveRule<T extends PricingRuleRecord>(
  rules: T[],
  plan: PlanPricingTarget,
): T | null {
  const matches = rules.filter(rule => {
    if (!rule.active) return false
    if (rule.vendor && rule.vendor !== plan.vendor) return false
    if (rule.network && rule.network !== plan.network) return false
    if (rule.planType && rule.planType !== plan.planType) return false
    if (rule.variationCode && rule.variationCode !== plan.variationCode) return false
    return true
  })

  if (matches.length === 0) return null

  return matches.reduce((best, rule) => {
    const delta = SCOPE_RANK[rule.scope] - SCOPE_RANK[best.scope]
    if (delta !== 0) return delta < 0 ? rule : best
    // Prefer vendor-specific over vendor-null at the same scope.
    if (rule.vendor && !best.vendor) return rule
    if (!rule.vendor && best.vendor) return best
    return rule.updatedAt > best.updatedAt ? rule : best
  })
}

export function roundUpTo(amountKobo: number, step: number): number {
  if (!Number.isFinite(step) || step <= 1) return amountKobo
  return Math.ceil(amountKobo / step) * step
}

/**
 * Apply a rule to a wholesale price. Percentage first, then flat add-on,
 * then floor/cap, then rounding. Rounding counts as margin so
 * costKobo + marginKobo === retailKobo always holds.
 */
export function applyRule(
  costKobo: number,
  rule: Pick<
    PricingRuleRecord,
    'id' | 'marginBps' | 'marginKobo' | 'minMarginKobo' | 'maxMarginKobo' | 'roundToKobo'
  > | null,
): PriceBreakdown {
  const cost = Math.max(0, Math.round(costKobo))
  if (!rule) {
    return { costKobo: cost, marginKobo: 0, retailKobo: cost, ruleId: null }
  }

  const pct = Math.round((cost * clampBps(rule.marginBps)) / 10_000)
  let margin = pct + Math.max(0, Math.round(rule.marginKobo))

  margin = Math.max(margin, Math.max(0, Math.round(rule.minMarginKobo)))
  if (rule.maxMarginKobo != null && rule.maxMarginKobo >= 0) {
    margin = Math.min(margin, Math.round(rule.maxMarginKobo))
  }

  const retail = roundUpTo(cost + margin, Math.max(0, Math.round(rule.roundToKobo)))

  return {
    costKobo: cost,
    marginKobo: retail - cost,
    retailKobo: retail,
    ruleId: rule.id,
  }
}

function clampBps(bps: number): number {
  if (!Number.isFinite(bps)) return 0
  return Math.min(Math.max(Math.round(bps), 0), MAX_MARGIN_BPS)
}

export function priceFor(
  rules: PricingRuleRecord[],
  plan: PlanPricingTarget,
  costKobo: number,
): PriceBreakdown {
  return applyRule(costKobo, resolveRule(rules, plan))
}

/** Price a plan from wholesale naira; returns naira amounts plus the rule used. */
export function pricePlanNgn(
  rules: PricingRuleRecord[],
  plan: PlanPricingTarget,
  wholesaleNgn: number,
): { costNgn: number; marginNgn: number; retailNgn: number; ruleId: string | null } {
  const breakdown = priceFor(rules, plan, nairaToKobo(wholesaleNgn))
  return {
    costNgn: koboToNaira(breakdown.costKobo),
    marginNgn: koboToNaira(breakdown.marginKobo),
    retailNgn: koboToNaira(breakdown.retailKobo),
    ruleId: breakdown.ruleId,
  }
}

export async function loadPricingRules(): Promise<PricingRuleRecord[]> {
  const rows = await getPricingRules({ activeOnly: true })
  return rows.map(toRecord)
}

export async function loadPricingRulesForAdmin(): Promise<PricingRuleRecord[]> {
  const rows = await getPricingRules({ activeOnly: false })
  return rows.map(toRecord)
}

function toRecord(row: StoredPricingRule): PricingRuleRecord {
  const scope = (PRICING_SCOPES as readonly string[]).includes(row.scope)
    ? (row.scope as PricingScope)
    : 'GLOBAL'
  const vendor =
    row.vendor && (PRICING_VENDORS as readonly string[]).includes(row.vendor)
      ? (row.vendor as PricingVendor)
      : null

  return {
    id: row.id,
    scope,
    vendor,
    network: row.network,
    planType: row.planType,
    variationCode: row.variationCode,
    marginBps: row.marginBps,
    marginKobo: row.marginKobo,
    minMarginKobo: row.minMarginKobo,
    maxMarginKobo: row.maxMarginKobo,
    roundToKobo: row.roundToKobo,
    active: row.active,
    note: row.note,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  }
}

export function describeScope(rule: {
  scope: string
  vendor?: string | null
  network?: string | null
  planType?: string | null
  variationCode?: string | null
}): string {
  const vendorPrefix = rule.vendor ? `${VENDOR_LABELS[rule.vendor] ?? rule.vendor} · ` : ''
  switch (rule.scope) {
    case 'GLOBAL':
      return `${vendorPrefix}All plans`.trim()
    case 'NETWORK':
      return `${vendorPrefix}${rule.network || 'Network'}`
    case 'PLAN_TYPE':
      return `${vendorPrefix}${[rule.network, rule.planType].filter(Boolean).join(' · ') || 'Plan type'}`
    case 'PLAN':
      return `${vendorPrefix}${[rule.network, `Plan ${rule.variationCode}`].filter(Boolean).join(' · ')}`
    default:
      return 'Unknown'
  }
}

/** "2.5% + ₦20" style summary of the margin itself. */
export function describeMargin(rule: Pick<PricingRuleRecord, 'marginBps' | 'marginKobo'>): string {
  const parts: string[] = []
  if (rule.marginBps > 0) {
    parts.push(`${(rule.marginBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`)
  }
  if (rule.marginKobo > 0) {
    parts.push(`₦${(rule.marginKobo / 100).toLocaleString('en-NG')}`)
  }
  return parts.length ? parts.join(' + ') : 'No margin'
}

export function validatePricingRuleInput(body: {
  scope: string
  vendor?: string | null
  network?: string | null
  planType?: string | null
  variationCode?: string | null
  marginBps: number
  marginKobo: number
  minMarginKobo: number
  maxMarginKobo: number | null
  roundToKobo: number
}): string | null {
  if (!(PRICING_SCOPES as readonly string[]).includes(body.scope)) {
    return 'Invalid scope.'
  }
  if (body.vendor && !(PRICING_VENDORS as readonly string[]).includes(body.vendor)) {
    return 'Invalid vendor.'
  }
  if (body.scope === 'NETWORK' && !body.network) return 'Network is required for NETWORK scope.'
  if (body.scope === 'PLAN_TYPE' && !(body.network && body.planType)) {
    return 'Network and plan type are required for PLAN_TYPE scope.'
  }
  if (body.scope === 'PLAN' && !(body.network && body.variationCode)) {
    return 'Network and plan code are required for PLAN scope.'
  }
  if (body.scope === 'PLAN' && !body.vendor) {
    return 'Vendor is required for PLAN scope (plan codes differ between Amigo and ASBDATA).'
  }
  if (body.marginBps < 0 || body.marginBps > MAX_MARGIN_BPS) {
    return `Percent margin must be between 0 and ${MAX_MARGIN_BPS / 100}%.`
  }
  if (body.marginKobo < 0 || body.marginKobo > MAX_FLAT_MARGIN_KOBO) {
    return `Flat margin cannot exceed ₦${(MAX_FLAT_MARGIN_KOBO / 100).toLocaleString('en-NG')}.`
  }
  if (body.minMarginKobo < 0) return 'Minimum margin cannot be negative.'
  if (body.maxMarginKobo != null && body.maxMarginKobo < 0) return 'Maximum margin cannot be negative.'
  if (body.roundToKobo < 0) return 'Round-to cannot be negative.'
  return null
}
