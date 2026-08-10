import type { BillDataBundle, NetworkProvider } from '@/types'
import { findBalanceInPayload, type ProviderBalance } from '@/lib/server/provider-balance'
import {
  loadPricingRules,
  normalizePlanType,
  pricePlanNgn,
  type PricingRuleRecord,
  type PricingVendor,
} from '@/lib/server/data-pricing'

/**
 * Bardetech VTU API — data bundles and airtime.
 *
 * Docs: https://bardetech.com/documentation/ (behind account login)
 * Auth: Authorization: Token <token>
 *
 *   GET  /api/network/  plan catalog
 *   POST /api/data/     buy data
 *   POST /api/topup/    buy airtime
 *
 * Bardetech runs the same Django VTU codebase as ASBDATA, so this mirrors asbdata-bills.ts
 * closely and deliberately: same auth header, same endpoint paths, same request bodies, and the
 * same "HTTP 200 with a status field" failure convention. Confirmed identical network ids
 * (1 MTN, 2 Glo, 3 9mobile, 4 Airtel) -- note 9mobile is 3 here as with ASBDATA, but 9 on Amigo.
 *
 * The two are kept as separate modules rather than one parameterised client because each vendor
 * prices independently, holds its own float, and drifts on its own schedule; a shared client would
 * couple an outage or a payload change on one to the other.
 *
 * Plan ids are only meaningful to the vendor that issued them, which is why bundles carry both
 * providerPlanId and providerNetworkId.
 */

export type BardetechPaymentResult = {
  provider: 'bardetech'
  reference: string
  status: 'success' | 'failed'
  rawStatus?: string
  reason?: string
  providerReference?: string
  payload?: Record<string, unknown>
  networkId?: number
  planId?: number
  /** True when we could not establish whether the provider acted. Never retry these. */
  indeterminate?: boolean
}

type BardetechPlan = {
  networkId: number
  planId: number
  size: string
  validity: string
  wholesaleNgn: number
  planType: string
}

type BardetechPlanCache = {
  expiresAt: number
  plans: BardetechPlan[]
}

const BARDETECH_CATALOG_TTL_MS = 5 * 60 * 1000
const BARDETECH_MAX_ATTEMPTS = 3
const BARDETECH_MIN_AIRTIME_NGN = 50
/**
 * Bardetech's published list carries occasional typos with trailing zeros -- a ₦3,050 plan listed
 * at ₦3,050,000,000. Margins are applied on top of wholesale, so a bad row would otherwise debit a
 * wallet for a fortune. Anything above this is treated as corrupt and dropped from the catalog.
 */
const BARDETECH_MAX_PLAUSIBLE_WHOLESALE_NGN = 200_000
const BILLS_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_BILLS === '1'
const BARDETECH_VENDOR: PricingVendor = 'bardetech'

export const BARDETECH_NETWORK_IDS: Record<string, number> = {
  mtn: 1,
  glo: 2,
  '9mobile': 3,
  etisalat: 3,
  airtel: 4,
}

export const BARDETECH_NETWORK_FROM_ID: Record<number, string> = {
  1: 'MTN',
  2: 'Glo',
  3: '9mobile',
  4: 'Airtel',
}

export const BARDETECH_NETWORKS = ['MTN', 'Airtel', 'Glo', '9mobile'] as const

/** Vendor wholesale catalog only — operator margins are applied per request. */
let bardetechPlanCache: BardetechPlanCache | null = null
let bardetechPlanPromise: Promise<BardetechPlan[]> | null = null
/** Last successfully priced provider list, used only as a fallback on catalog errors. */
let bardetechLastPricedProviders: NetworkProvider[] | null = null

/**
 * Drop the cached vendor catalog. Pricing rules are not cached with the catalog, so a margin
 * change does not require this — call it when the wholesale plan list itself must be refreshed.
 */
export function clearBardetechCatalogCache() {
  bardetechPlanCache = null
  bardetechPlanPromise = null
}

export type PricedBardetechPlan = BardetechPlan & {
  network: string
  planTypeNormalized: string
  costNgn: number
  marginNgn: number
  retailNgn: number
  ruleId: string | null
}

function logBardetechBills(event: string, details?: Record<string, unknown>) {
  if (!BILLS_LOGGING_ENABLED) return
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[bardetech-bills] ${event}${payload}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function getBardetechConfig() {
  return {
    baseUrl: (process.env.MAFITAPAY_BARDETECH_BASE_URL?.trim() || 'https://bardetech.com').replace(/\/+$/, ''),
    token: process.env.MAFITAPAY_BARDETECH_TOKEN?.trim() || '',
    airtimeType: process.env.MAFITAPAY_BARDETECH_AIRTIME_TYPE?.trim() || 'VTU',
  }
}

export function isBardetechBillsEnabled() {
  return Boolean(getBardetechConfig().token)
}

/**
 * Prepaid float Bardetech holds for us — the wallet bills and airtime are vended against.
 *
 * Fails soft: this backs an admin display, so an unreachable provider should read "unavailable"
 * beside the other figures rather than blanking the page.
 */
export async function getBardetechBalance(): Promise<ProviderBalance> {
  const config = getBardetechConfig()
  const label = 'Bardetech float'

  if (!config.token) {
    return {
      provider: 'bardetech',
      label,
      configured: false,
      balance: null,
      message: 'Bardetech token is not configured.',
    }
  }

  const path = process.env.MAFITAPAY_BARDETECH_BALANCE_PATH?.trim() || '/api/user/'

  try {
    const { status, json } = await bardetechRequest('GET', path)

    if (status >= 400) {
      logBardetechBills('balance.error', { status })
      return {
        provider: 'bardetech',
        label,
        configured: true,
        balance: null,
        message: `Bardetech balance request failed (${status}).`,
      }
    }

    const balance = findBalanceInPayload(json)
    if (balance == null) {
      logBardetechBills('balance.unrecognized')
      return {
        provider: 'bardetech',
        label,
        configured: true,
        balance: null,
        message: 'Bardetech balance response did not include a recognizable balance field.',
      }
    }

    logBardetechBills('balance.ok', { balance })
    return { provider: 'bardetech', label, configured: true, balance }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bardetech balance request failed.'
    logBardetechBills('balance.threw', { message })
    return { provider: 'bardetech', label, configured: true, balance: null, message }
  }
}

export function getBardetechNetworkId(networkName: string): number | undefined {
  const normalized = networkName.trim().toLowerCase()
  if (normalized.includes('mtn')) return BARDETECH_NETWORK_IDS.mtn
  if (normalized.includes('glo')) return BARDETECH_NETWORK_IDS.glo
  if (normalized.includes('airtel')) return BARDETECH_NETWORK_IDS.airtel
  if (normalized.includes('9mobile') || normalized.includes('etisalat')) return BARDETECH_NETWORK_IDS['9mobile']
  return undefined
}

function normalizeNetworkProviderName(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('mtn')) return 'mtn'
  if (normalized.includes('glo')) return 'glo'
  if (normalized.includes('airtel')) return 'airtel'
  if (normalized.includes('9mobile') || normalized.includes('etisalat')) return '9mobile'
  return normalized
}

function digitsOnly(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('234')) return `0${digits.slice(3)}`
  return digits
}

/**
 * Transport-level failures leave the request in an unknown state -- the provider may have acted.
 * Callers must treat these as final rather than retrying against another provider.
 */
function isTransportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const code = isRecord(error) && 'code' in error ? String(error.code) : ''
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|socket|timeout|aborted/i.test(`${message} ${code}`)
}

function transportMessage(error: unknown) {
  if (isTransportError(error)) {
    return 'Could not reach Bardetech. The purchase may or may not have gone through.'
  }
  return error instanceof Error ? error.message : 'Bardetech request failed.'
}

async function bardetechRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: unknown; text: string }> {
  const config = getBardetechConfig()
  if (!config.token) {
    throw new Error('Bardetech is not configured.')
  }

  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  let lastError: unknown

  for (let attempt = 1; attempt <= BARDETECH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Token ${config.token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      })

      const text = await response.text()
      let json: unknown = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = { raw: text }
      }

      return { status: response.status, json, text }
    } catch (error) {
      lastError = error
      // Only the catalog read is safe to retry blindly; purchases pass through here too, so retry
      // only on transport errors, where no response was ever produced.
      if (!isTransportError(error) || attempt === BARDETECH_MAX_ATTEMPTS) throw error
      await new Promise(resolve => setTimeout(resolve, 400 * attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * Bardetech answers the catalog with network-keyed arrays (MTN_PLAN, GLO_PLAN, ...) but the shape
 * has moved around on sibling deployments, so fall back through the other layouts seen in the wild.
 */
function extractPlanRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter(isRecord)
  if (!isRecord(json)) return []

  const planKeys = Object.keys(json).filter(key => /_PLAN$/i.test(key))
  if (planKeys.length) {
    const rows: Record<string, unknown>[] = []
    for (const key of planKeys) {
      const value = json[key]
      if (Array.isArray(value)) rows.push(...value.filter(isRecord))
    }
    if (rows.length) return rows
  }

  for (const key of ['data', 'plans', 'results', 'Plan', 'network', 'Dataplans']) {
    const value = json[key]
    if (Array.isArray(value)) return value.filter(isRecord)
    if (isRecord(value)) {
      const nested: Record<string, unknown>[] = []
      for (const entry of Object.values(value)) {
        if (Array.isArray(entry)) nested.push(...entry.filter(isRecord))
      }
      if (nested.length) return nested
    }
  }

  return []
}

function networkIdFromName(name: string): number | null {
  return getBardetechNetworkId(name) ?? null
}

function normalizeSize(size: string) {
  const trimmed = size.trim()
  if (!trimmed) return 'Data'
  if (/gb|mb/i.test(trimmed)) return trimmed.replace(/\s+/g, '')

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    return numeric >= 1 ? `${numeric}GB` : `${Math.round(numeric * 1000)}MB`
  }
  return trimmed
}

function parsePlanRow(row: Record<string, unknown>): BardetechPlan | null {
  const planId =
    readNumber(row.id)
    ?? readNumber(row.dataplan_id)
    ?? readNumber(row.plan_id)
    ?? readNumber(row.data_id)
  const networkId =
    readNumber(row.network)
    ?? readNumber(row.network_id)
    ?? networkIdFromName(readString(row.plan_network || row.network_name || row.networkname))
  const wholesaleNgn =
    readNumber(row.plan_amount)
    ?? readNumber(row.amount)
    ?? readNumber(row.price)

  if (planId == null || networkId == null || wholesaleNgn == null) return null
  if (!BARDETECH_NETWORK_FROM_ID[networkId]) return null
  // Drop corrupt rows rather than pricing a margin on top of an impossible wholesale figure.
  if (wholesaleNgn <= 0 || wholesaleNgn > BARDETECH_MAX_PLAUSIBLE_WHOLESALE_NGN) return null

  const rawSize = readString(row.plan) || readString(row.size || row.plan_size || row.data_size) || 'Data'
  // Some rows echo the plan id in the size column; that is not a data size.
  const size = /^\d+$/.test(rawSize) && rawSize === String(planId) ? 'Data' : normalizeSize(rawSize)
  const validity = readString(row.month_validate || row.validity || row.plan_validity || row.day) || '—'
  const planType = readString(row.plan_type || row.type || row.category)

  return { networkId, planId, size, validity, wholesaleNgn, planType }
}

function toBardetechBundles(plans: PricedBardetechPlan[]): BillDataBundle[] {
  return plans.map(plan => ({
    label: plan.size,
    amount: plan.retailNgn,
    itemCode: `BARDETECH_PLAN_${plan.planId}`,
    billerCode: `BARDETECH_NETWORK_${plan.networkId}`,
    itemName: plan.size,
    validity: plan.validity,
    provider: 'bardetech' as const,
    providerPlanId: String(plan.planId),
    providerNetworkId: plan.networkId,
    planType: plan.planTypeNormalized,
    efficiencyLabel: plan.planTypeNormalized !== 'STANDARD' ? plan.planTypeNormalized : (plan.planType || undefined),
  }))
}

function applyBardetechPricing(plans: BardetechPlan[], rules: PricingRuleRecord[]): PricedBardetechPlan[] {
  return plans.map(plan => {
    const network = BARDETECH_NETWORK_FROM_ID[plan.networkId] || 'Unknown'
    const planTypeNormalized = normalizePlanType(plan.planType)
    const priced = pricePlanNgn(
      rules,
      {
        network,
        planType: planTypeNormalized,
        variationCode: String(plan.planId),
        vendor: BARDETECH_VENDOR,
      },
      plan.wholesaleNgn,
    )
    return {
      ...plan,
      network,
      planTypeNormalized,
      costNgn: priced.costNgn,
      marginNgn: priced.marginNgn,
      retailNgn: priced.retailNgn,
      ruleId: priced.ruleId,
    }
  })
}

function mergeBardetechBundles(existing: BillDataBundle[] | undefined, incoming: BillDataBundle[]) {
  const merged = [...(existing ?? []), ...incoming]
  const seen = new Set<string>()

  return merged
    .filter(bundle => {
      const key = `${bundle.provider || 'flutterwave'}:${bundle.itemCode}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.amount - b.amount)
}

async function fetchBardetechPlans(): Promise<BardetechPlan[]> {
  const { status, json } = await bardetechRequest('GET', '/api/network/')
  if (status >= 400) {
    throw new Error(`Bardetech plan catalog failed (${status}).`)
  }

  const rows = extractPlanRows(json)
  const plans = rows.map(parsePlanRow).filter((plan): plan is BardetechPlan => plan !== null)

  logBardetechBills('catalog.response', { rows: rows.length, plans: plans.length })

  if (rows.length > 0 && plans.length === 0) {
    // The endpoint answered but nothing matched the shapes we know about. Surface it rather than
    // quietly serving an empty catalog.
    throw new Error('Bardetech plan catalog returned no recognizable plans.')
  }

  return plans
}

/** Wholesale plans with a short TTL. Margins are never stored here. */
export async function getCachedBardetechPlans(options?: { forceRefresh?: boolean }): Promise<BardetechPlan[]> {
  const now = Date.now()
  if (!options?.forceRefresh && bardetechPlanCache && bardetechPlanCache.expiresAt > now) {
    logBardetechBills('catalog.cache-hit', { expiresInMs: bardetechPlanCache.expiresAt - now, plans: bardetechPlanCache.plans.length })
    return bardetechPlanCache.plans
  }

  if (bardetechPlanPromise) {
    logBardetechBills('catalog.join')
    return bardetechPlanPromise
  }

  logBardetechBills('catalog.request')
  bardetechPlanPromise = fetchBardetechPlans()
    .then(plans => {
      bardetechPlanCache = {
        expiresAt: Date.now() + BARDETECH_CATALOG_TTL_MS,
        plans,
      }
      return plans
    })
    .catch(error => {
      logBardetechBills('catalog.error', {
        message: error instanceof Error ? error.message : 'Unknown Bardetech catalog error.',
      })
      throw error
    })
    .finally(() => {
      bardetechPlanPromise = null
    })

  return bardetechPlanPromise
}

/** Vendor catalog (cached) with current pricing rules (uncached) applied. */
export async function getPricedBardetechPlans(options?: { forceRefresh?: boolean }): Promise<PricedBardetechPlan[]> {
  const [plans, rules] = await Promise.all([
    getCachedBardetechPlans(options),
    loadPricingRules(),
  ])
  return applyBardetechPricing(plans, rules)
}

/**
 * Authoritative price for one Bardetech plan. The purchase path must use this rather than a price
 * supplied by the client.
 */
export async function getBardetechPlanForPurchase(
  networkId: number,
  planId: string,
): Promise<PricedBardetechPlan | null> {
  const priced = await getPricedBardetechPlans()
  return priced.find(plan => plan.networkId === networkId && String(plan.planId) === String(planId)) ?? null
}

export async function listBardetechDataBundleNetworkProviders(
  networkProviders: NetworkProvider[],
  options?: { forceRefresh?: boolean },
): Promise<NetworkProvider[]> {
  if (!isBardetechBillsEnabled()) return networkProviders

  const priced = await getPricedBardetechPlans(options)
  const bundlesByNetworkId = new Map<number, BillDataBundle[]>()
  for (const bundle of toBardetechBundles(priced)) {
    const networkId = bundle.providerNetworkId
    if (networkId === undefined) continue
    const current = bundlesByNetworkId.get(networkId) ?? []
    current.push(bundle)
    bundlesByNetworkId.set(networkId, current)
  }

  const mergedProviders = networkProviders.map(provider => {
    const networkKey = normalizeNetworkProviderName(provider.name)
    const networkId = BARDETECH_NETWORK_IDS[networkKey]
    const bundles = networkId ? bundlesByNetworkId.get(networkId) : undefined
    return bundles && bundles.length > 0
      ? { ...provider, dataBundles: mergeBardetechBundles(provider.dataBundles, bundles) }
      : provider
  })

  bardetechLastPricedProviders = mergedProviders
  return mergedProviders
}

export async function listBardetechDataBundleNetworkProvidersSafe(
  networkProviders: NetworkProvider[],
  options?: { forceRefresh?: boolean },
): Promise<NetworkProvider[]> {
  try {
    return await listBardetechDataBundleNetworkProviders(networkProviders, options)
  } catch (error) {
    logBardetechBills('catalog.fallback', {
      message: error instanceof Error ? error.message : 'Unknown Bardetech catalog fallback error.',
    })
    return bardetechLastPricedProviders ?? networkProviders
  }
}

/** Distinct plan types currently in the Bardetech catalog (for the admin form). */
export async function listBardetechPlanTypes(): Promise<string[]> {
  try {
    const plans = await getCachedBardetechPlans()
    return Array.from(new Set(plans.map(plan => normalizePlanType(plan.planType)))).sort()
  } catch {
    return []
  }
}

/**
 * Bardetech reports failures with HTTP 200 and a status field, so the body decides the outcome.
 * Anything we cannot read as an explicit success is treated as a failure.
 */
function mapPurchaseResult(
  status: number,
  json: unknown,
  text: string,
  reference: string,
  context: { networkId: number; planId?: number },
): BardetechPaymentResult {
  const record = isRecord(json) ? json : {}
  const statusText = (readString(record.Status) || readString(record.status) || readString(record.status_code)).toLowerCase()
  const apiCode = readNumber(record.status) ?? readNumber(record.Status) ?? readNumber(record.code)

  const message =
    readString(record.api_response)
    || readString(record.message)
    || readString(record.msg)
    || readString(record.error)
    || (text && text.length < 200 ? text : '')
    || (status >= 400 ? `Bardetech HTTP ${status}` : '')

  const providerReference =
    readString(record.ident)
    || readString(record.reference)
    || readString(record.transid)
    || readString(record.transaction_id)
    || readString(record.id)
    || readString(isRecord(record.data) ? record.data.ident : undefined)
    || undefined

  const looksSuccessful =
    statusText.includes('success')
    || statusText === 'ok'
    || statusText === 'delivered'
    || apiCode === 1
    || apiCode === 200
    || record.success === true
    || record.Status === true
    || readString(record.api_response).toLowerCase().includes('success')

  const looksFailed =
    status >= 400
    || statusText.includes('fail')
    || statusText.includes('error')
    || statusText.includes('insufficient')
    || record.success === false

  const success = !looksFailed && looksSuccessful

  return {
    provider: 'bardetech',
    reference,
    status: success ? 'success' : 'failed',
    rawStatus: statusText || String(status),
    reason: success ? undefined : (message || 'Bardetech purchase failed.'),
    providerReference: providerReference || undefined,
    payload: isRecord(json) ? json : undefined,
    networkId: context.networkId,
    planId: context.planId,
    // A 2xx with no readable status means we cannot prove either outcome.
    indeterminate: !looksFailed && !looksSuccessful && status < 400,
  }
}

export async function createBardetechDataPayment(input: {
  networkId: number
  mobileNumber: string
  planId: string
  reference: string
}): Promise<BardetechPaymentResult> {
  const planId = Number(input.planId)
  if (!Number.isFinite(planId)) {
    return {
      provider: 'bardetech',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'INVALID_PLAN',
      reason: 'Invalid Bardetech plan id.',
      networkId: input.networkId,
    }
  }

  if (!BARDETECH_NETWORK_FROM_ID[input.networkId]) {
    return {
      provider: 'bardetech',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'UNSUPPORTED_NETWORK',
      reason: 'Selected network is not supported by Bardetech.',
      networkId: input.networkId,
      planId,
    }
  }

  logBardetechBills('purchase.request', { kind: 'data', networkId: input.networkId, planId, reference: input.reference })

  try {
    const { status, json, text } = await bardetechRequest('POST', '/api/data/', {
      network: input.networkId,
      mobile_number: digitsOnly(input.mobileNumber),
      plan: planId,
      Ported_number: true,
    })

    const result = mapPurchaseResult(status, json, text, input.reference, { networkId: input.networkId, planId })
    logBardetechBills('purchase.response', { kind: 'data', status: result.status, rawStatus: result.rawStatus })
    return result
  } catch (error) {
    const indeterminate = isTransportError(error)
    logBardetechBills('purchase.error', { kind: 'data', message: transportMessage(error), indeterminate })
    return {
      provider: 'bardetech',
      reference: input.reference,
      status: 'failed',
      rawStatus: indeterminate ? 'TRANSPORT_ERROR' : 'REQUEST_ERROR',
      reason: transportMessage(error),
      networkId: input.networkId,
      planId,
      indeterminate,
    }
  }
}

export async function createBardetechAirtimePayment(input: {
  networkId: number
  mobileNumber: string
  amount: number
  reference: string
}): Promise<BardetechPaymentResult> {
  if (!BARDETECH_NETWORK_FROM_ID[input.networkId]) {
    return {
      provider: 'bardetech',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'UNSUPPORTED_NETWORK',
      reason: 'Selected network is not supported by Bardetech.',
      networkId: input.networkId,
    }
  }

  const amountNgn = Math.round(input.amount)
  if (amountNgn < BARDETECH_MIN_AIRTIME_NGN) {
    return {
      provider: 'bardetech',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'AMOUNT_TOO_LOW',
      reason: `Minimum Bardetech airtime is ₦${BARDETECH_MIN_AIRTIME_NGN}.`,
      networkId: input.networkId,
    }
  }

  const config = getBardetechConfig()
  logBardetechBills('purchase.request', { kind: 'airtime', networkId: input.networkId, amount: amountNgn, reference: input.reference })

  try {
    const { status, json, text } = await bardetechRequest('POST', '/api/topup/', {
      network: input.networkId,
      amount: amountNgn,
      mobile_number: digitsOnly(input.mobileNumber),
      Ported_number: true,
      airtime_type: config.airtimeType,
    })

    const result = mapPurchaseResult(status, json, text, input.reference, { networkId: input.networkId })
    logBardetechBills('purchase.response', { kind: 'airtime', status: result.status, rawStatus: result.rawStatus })
    return result
  } catch (error) {
    const indeterminate = isTransportError(error)
    logBardetechBills('purchase.error', { kind: 'airtime', message: transportMessage(error), indeterminate })
    return {
      provider: 'bardetech',
      reference: input.reference,
      status: 'failed',
      rawStatus: indeterminate ? 'TRANSPORT_ERROR' : 'REQUEST_ERROR',
      reason: transportMessage(error),
      networkId: input.networkId,
      indeterminate,
    }
  }
}
