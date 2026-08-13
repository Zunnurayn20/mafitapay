import type { BillDataBundle, NetworkProvider } from '@/types'
import { getDisabledDataPlans } from '@/lib/server/data'
import { findBalanceInPayload, type ProviderBalance } from '@/lib/server/provider-balance'
import {
  loadPricingRules,
  normalizePlanType,
  pricePlanNgn,
  type PricingRuleRecord,
  type PricingVendor,
} from '@/lib/server/data-pricing'

type AmigoPlanEntry = {
  planId: number
  dataCapacity: number
  validity: number
  price: number
  category?: string
  efficiencyPercent?: number
  efficiencyLabel?: string
}

export type AmigoDataPaymentResult = {
  provider: 'amigo'
  reference: string
  status: 'success' | 'failed'
  rawStatus?: string
  reason?: string
  providerReference?: string
  payload?: Record<string, unknown>
  networkId?: number
  planId?: number
}

const AMIGO_BASE_URL = process.env.MAFITAPAY_AMIGO_BASE_URL?.trim().replace(/\/$/, '') || 'https://amigo.ng/api'
const BILLS_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_BILLS === '1'
const AMIGO_VENDOR: PricingVendor = 'amigo'

/**
 * No-op kept for call sites that used to invalidate a price-baked catalog cache.
 * Margins are applied per request from pricing rules, so nothing needs clearing.
 */
export function clearAmigoCatalogCache() {
  // intentionally empty
}

export const AMIGO_NETWORK_IDS: Record<string, number> = {
  mtn: 1,
  glo: 2,
  airtel: 4,
  '9mobile': 9,
  etisalat: 9,
}

export const AMIGO_NETWORK_FROM_ID: Record<number, string> = {
  1: 'MTN',
  2: 'Glo',
  4: 'Airtel',
  9: '9mobile',
}

export const AMIGO_NETWORKS = ['MTN', 'Airtel', 'Glo'] as const

export type PricedAmigoPlan = {
  networkId: number
  network: string
  planId: number
  planType: string
  label: string
  validity: string
  wholesaleNgn: number
  costNgn: number
  marginNgn: number
  retailNgn: number
  ruleId: string | null
  efficiencyPercent?: number
  efficiencyLabel?: string
}
const AMIGO_STATIC_REGULAR_PLANS: Record<'mtn' | 'glo' | 'airtel', AmigoPlanEntry[]> = {
  mtn: [
    { planId: 5000, dataCapacity: 0.5, validity: 30, price: 299, category: 'REGULAR' },
    { planId: 1001, dataCapacity: 1, validity: 30, price: 429, category: 'REGULAR' },
    { planId: 6666, dataCapacity: 2, validity: 30, price: 849, category: 'REGULAR' },
    { planId: 3333, dataCapacity: 3, validity: 30, price: 1329, category: 'REGULAR' },
    { planId: 9999, dataCapacity: 5, validity: 30, price: 1799, category: 'REGULAR' },
    { planId: 7777, dataCapacity: 7, validity: 30, price: 2499, category: 'REGULAR' },
    { planId: 1110, dataCapacity: 10, validity: 30, price: 3899, category: 'REGULAR' },
    { planId: 1515, dataCapacity: 15, validity: 30, price: 5690, category: 'REGULAR' },
    { planId: 424, dataCapacity: 20, validity: 30, price: 7899, category: 'REGULAR' },
    { planId: 379, dataCapacity: 36, validity: 30, price: 11900, category: 'REGULAR' },
    { planId: 360, dataCapacity: 75, validity: 30, price: 18990, category: 'REGULAR' },
  ],
  glo: [
    { planId: 199, dataCapacity: 0.2, validity: 30, price: 99, category: 'REGULAR' },
    { planId: 198, dataCapacity: 0.5, validity: 30, price: 199, category: 'REGULAR' },
    { planId: 194, dataCapacity: 1, validity: 30, price: 399, category: 'REGULAR' },
    { planId: 195, dataCapacity: 2, validity: 30, price: 799, category: 'REGULAR' },
    { planId: 196, dataCapacity: 3, validity: 30, price: 1199, category: 'REGULAR' },
    { planId: 197, dataCapacity: 5, validity: 30, price: 1999, category: 'REGULAR' },
    { planId: 200, dataCapacity: 10, validity: 30, price: 3990, category: 'REGULAR' },
  ],
  airtel: [
    { planId: 163, dataCapacity: 0.5, validity: 7, price: 549, category: 'REGULAR' },
    { planId: 145, dataCapacity: 1, validity: 30, price: 764, category: 'REGULAR' },
    { planId: 146, dataCapacity: 2, validity: 30, price: 1430, category: 'REGULAR' },
    { planId: 532, dataCapacity: 3, validity: 30, price: 1950, category: 'REGULAR' },
    { planId: 148, dataCapacity: 4, validity: 30, price: 2619, category: 'REGULAR' },
    { planId: 150, dataCapacity: 10, validity: 30, price: 3899, category: 'REGULAR' },
    { planId: 405, dataCapacity: 18, validity: 30, price: 6450, category: 'REGULAR' },
    { planId: 404, dataCapacity: 25, validity: 30, price: 8499, category: 'REGULAR' },
  ],
}

function logAmigoBills(event: string, details?: Record<string, unknown>) {
  if (!BILLS_LOGGING_ENABLED) return
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[amigo-bills] ${event}${payload}`)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getAmigoApiKey() {
  return readString(process.env.MAFITAPAY_AMIGO_API_KEY)
}

function normalizeNetworkProvider(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('mtn')) return 'mtn'
  if (normalized.includes('glo')) return 'glo'
  if (normalized.includes('airtel')) return 'airtel'
  if (normalized.includes('9mobile') || normalized.includes('etisalat')) return '9mobile'
  return normalized
}

function formatCapacityLabel(value: number) {
  if (value >= 1) {
    const display = Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '')
    return `${display}GB`
  }

  const megabytes = Math.round(value * 1000)
  return `${megabytes}MB`
}

function formatValidity(validity: number) {
  return `${validity} day${validity === 1 ? '' : 's'}`
}

async function amigoRequest(path: string, init?: RequestInit) {
  const apiKey = getAmigoApiKey()
  if (!apiKey) {
    throw new Error('Amigo bills are not configured.')
  }

  const response = await fetch(`${AMIGO_BASE_URL}${path}`, {
    ...init,
    headers: {
      'X-API-Key': apiKey,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}

  if (!response.ok) {
    const message =
      readString(body.message)
      || readString(body.detail)
      || readString(body.error)
      || `Amigo API request failed with status ${response.status}.`

    logAmigoBills('request.error', {
      path,
      status: response.status,
      statusText: response.statusText,
      message,
      body,
    })

    throw new Error(message)
  }

  logAmigoBills('request.success', {
    path,
    status: response.status,
    keys: Object.keys(body),
  })

  return body
}

function listAmigoWholesalePlans(): Array<{
  networkId: number
  network: string
  entry: AmigoPlanEntry
}> {
  return [
    ...AMIGO_STATIC_REGULAR_PLANS.mtn.map(entry => ({ networkId: 1, network: 'MTN', entry })),
    ...AMIGO_STATIC_REGULAR_PLANS.glo.map(entry => ({ networkId: 2, network: 'Glo', entry })),
    ...AMIGO_STATIC_REGULAR_PLANS.airtel.map(entry => ({ networkId: 4, network: 'Airtel', entry })),
  ]
}

function applyAmigoPricing(
  rules: PricingRuleRecord[],
): PricedAmigoPlan[] {
  return listAmigoWholesalePlans().map(({ networkId, network, entry }) => {
    const planType = normalizePlanType(entry.category || entry.efficiencyLabel || 'REGULAR')
    const priced = pricePlanNgn(
      rules,
      {
        network,
        planType,
        variationCode: String(entry.planId),
        vendor: AMIGO_VENDOR,
      },
      entry.price,
    )
    return {
      networkId,
      network,
      planId: entry.planId,
      planType,
      label: formatCapacityLabel(entry.dataCapacity),
      validity: formatValidity(entry.validity),
      wholesaleNgn: entry.price,
      costNgn: priced.costNgn,
      marginNgn: priced.marginNgn,
      retailNgn: priced.retailNgn,
      ruleId: priced.ruleId,
      efficiencyPercent: entry.efficiencyPercent,
      efficiencyLabel: entry.efficiencyLabel || entry.category,
    }
  })
}

function toAmigoBundles(plans: PricedAmigoPlan[]): BillDataBundle[] {
  return plans.map(plan => ({
    label: plan.label,
    amount: plan.retailNgn,
    itemCode: `AMIGO_PLAN_${plan.planId}`,
    billerCode: `AMIGO_NETWORK_${plan.networkId}`,
    itemName: plan.label,
    validity: plan.validity,
    provider: 'amigo',
    providerPlanId: String(plan.planId),
    providerNetworkId: plan.networkId,
    planType: plan.planType,
    efficiencyPercent: plan.efficiencyPercent,
    efficiencyLabel: plan.efficiencyLabel,
  }))
}

/** Static Amigo catalog with current pricing rules applied. */
export async function getPricedAmigoPlans(): Promise<PricedAmigoPlan[]> {
  const [rules, disabled] = await Promise.all([loadPricingRules(), getDisabledDataPlans()])
  const disabledKeys = new Set(disabled.filter(plan => plan.vendor === 'amigo').map(plan => `${plan.networkId}:${plan.planId}`))
  return applyAmigoPricing(rules).filter(plan => !disabledKeys.has(`${plan.networkId}:${plan.planId}`))
}

/**
 * Authoritative price for one Amigo plan. The purchase path must use this rather than a price
 * supplied by the client.
 */
export async function getAmigoPlanForPurchase(
  networkId: number,
  planId: string,
): Promise<PricedAmigoPlan | null> {
  const priced = await getPricedAmigoPlans()
  return priced.find(plan => plan.networkId === networkId && String(plan.planId) === String(planId)) ?? null
}

function mergeProviderBundles(existingBundles: BillDataBundle[] | undefined, amigoBundles: BillDataBundle[]) {
  const merged = [...(existingBundles ?? []), ...amigoBundles]
  const seen = new Set<string>()

  return merged
    .filter(bundle => {
      const key = `${bundle.provider || 'flutterwave'}:${bundle.itemCode}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    // Cheapest first regardless of provider. This used to float Amigo above everything else, which
    // would now bury a cheaper ASBDATA plan underneath a pricier Amigo one.
    .sort((a, b) => a.amount - b.amount)
}

export function isAmigoBillsEnabled() {
  return Boolean(getAmigoApiKey())
}

/**
 * Prepaid float Amigo holds for us.
 *
 * Same shape as the ASBDATA lookup: overridable path, balance located by search, failure returned
 * rather than thrown so one dead vendor cannot take down the admin overview.
 */
export async function getAmigoBalance(): Promise<ProviderBalance> {
  const label = 'Amigo float'

  if (!isAmigoBillsEnabled()) {
    return {
      provider: 'amigo',
      label,
      configured: false,
      balance: null,
      message: 'Amigo API key is not configured.',
    }
  }

  // Verified against the live API: GET /wallet/ answers
  // {"success":true,"data":{"balance":1024,"display":"₦1,024.00","currency":"NGN",...}}.
  // Overridable in case Amigo moves it.
  const path = process.env.MAFITAPAY_AMIGO_BALANCE_PATH?.trim() || '/wallet/'

  try {
    const body = await amigoRequest(path)
    const balance = findBalanceInPayload(body)

    if (balance == null) {
      logAmigoBills('balance.unrecognized')
      return {
        provider: 'amigo',
        label,
        configured: true,
        balance: null,
        message: 'Amigo balance response did not include a recognizable balance field.',
      }
    }

    logAmigoBills('balance.ok', { balance })
    return { provider: 'amigo', label, configured: true, balance }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Amigo balance request failed.'
    logAmigoBills('balance.threw', { message })
    return { provider: 'amigo', label, configured: true, balance: null, message }
  }
}

export async function listAmigoDataBundleNetworkProviders(
  networkProviders: NetworkProvider[],
  _options?: { forceRefresh?: boolean },
) {
  if (!isAmigoBillsEnabled()) return networkProviders

  logAmigoBills('catalog.request', { source: 'static_verified_catalog' })
  const priced = await getPricedAmigoPlans()
  const bundles = toAmigoBundles(priced)
  const bundlesByNetworkId = new Map<number, BillDataBundle[]>()
  for (const bundle of bundles) {
    const networkId = bundle.providerNetworkId
    if (networkId === undefined) continue
    const current = bundlesByNetworkId.get(networkId) ?? []
    current.push(bundle)
    bundlesByNetworkId.set(networkId, current)
  }

  logAmigoBills('catalog.response', {
    source: 'static_verified_catalog',
    providers: Array.from(bundlesByNetworkId.entries()).map(([networkId, networkBundles]) => ({
      networkId,
      bundleCount: networkBundles.length,
      bundles: networkBundles.map(bundle => ({
        planId: bundle.providerPlanId,
        label: bundle.label,
        amount: bundle.amount,
        validity: bundle.validity,
        category: bundle.efficiencyLabel || null,
      })),
    })),
  })

  return networkProviders.map(provider => {
    const networkKey = normalizeNetworkProvider(provider.name)
    const networkId = AMIGO_NETWORK_IDS[networkKey]
    const dataBundles = networkId ? bundlesByNetworkId.get(networkId) : undefined
    return dataBundles && dataBundles.length > 0
      ? { ...provider, dataBundles: mergeProviderBundles(provider.dataBundles, dataBundles) }
      : provider
  })
}

export async function listAmigoDataBundleNetworkProvidersSafe(
  networkProviders: NetworkProvider[],
  options?: { forceRefresh?: boolean },
) {
  try {
    return await listAmigoDataBundleNetworkProviders(networkProviders, options)
  } catch (error) {
    logAmigoBills('catalog.fallback', {
      message: error instanceof Error ? error.message : 'Unknown Amigo catalog fallback error.',
    })
    return networkProviders
  }
}

export async function createAmigoDataPayment(input: {
  networkId: number
  mobileNumber: string
  planId: string
  reference: string
}) {
  logAmigoBills('purchase.request', {
    networkId: input.networkId,
    planId: input.planId,
    reference: input.reference,
  })

  try {
    const body = await amigoRequest('/data/', {
      method: 'POST',
      headers: {
        'Idempotency-Key': input.reference,
      },
      body: JSON.stringify({
        network: input.networkId,
        mobile_number: input.mobileNumber,
        plan: Number(input.planId),
        Ported_number: true,
      }),
    })

    const success = body.success === true
    const rawStatus = readString(body.status) || (success ? 'delivered' : 'failed')
    const reason = readString(body.message) || undefined

    const result: AmigoDataPaymentResult = {
      provider: 'amigo',
      reference: readString(body.reference) || input.reference,
      status: success ? 'success' : 'failed',
      rawStatus,
      reason,
      providerReference: readString(body.reference) || input.reference,
      payload: body,
      networkId: input.networkId,
      planId: Number(input.planId),
    }

    logAmigoBills('purchase.response', {
      reference: result.reference,
      status: result.status,
      rawStatus: result.rawStatus,
      networkId: result.networkId,
      planId: result.planId,
    })

    return result
  } catch (error) {
    const result: AmigoDataPaymentResult = {
      provider: 'amigo',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'Amigo data purchase failed.',
      networkId: input.networkId,
      planId: Number(input.planId),
    }
    logAmigoBills('purchase.error', {
      reference: input.reference,
      networkId: input.networkId,
      planId: input.planId,
      message: result.reason,
    })
    return result
  }
}
