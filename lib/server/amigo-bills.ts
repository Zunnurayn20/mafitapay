import type { BillDataBundle, NetworkProvider } from '@/types'

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

type AmigoCatalogCache = {
  expiresAt: number
  providers: NetworkProvider[]
}

const AMIGO_BASE_URL = process.env.MAFITAPAY_AMIGO_BASE_URL?.trim().replace(/\/$/, '') || 'https://amigo.ng/api'
const AMIGO_CATALOG_TTL_MS = 5 * 60 * 1000
export const AMIGO_PLATFORM_MARKUP_NGN = 15
const BILLS_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_BILLS === '1'
let amigoCatalogCache: AmigoCatalogCache | null = null
let amigoCatalogPromise: Promise<NetworkProvider[]> | null = null

const AMIGO_NETWORK_IDS: Record<string, number> = {
  mtn: 1,
  glo: 2,
  airtel: 4,
  '9mobile': 9,
  etisalat: 9,
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

function toAmigoBundles(networkId: number, entries: AmigoPlanEntry[]): BillDataBundle[] {
  return entries.map(entry => {
    const label = formatCapacityLabel(entry.dataCapacity)
    return {
      label,
      amount: entry.price + AMIGO_PLATFORM_MARKUP_NGN,
      itemCode: `AMIGO_PLAN_${entry.planId}`,
      billerCode: `AMIGO_NETWORK_${networkId}`,
      itemName: label,
      validity: formatValidity(entry.validity),
      provider: 'amigo',
      providerPlanId: String(entry.planId),
      providerNetworkId: networkId,
      efficiencyPercent: entry.efficiencyPercent,
      efficiencyLabel: entry.efficiencyLabel || entry.category,
    }
  })
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
    .sort((a, b) => {
      if ((a.provider === 'amigo') !== (b.provider === 'amigo')) {
        return a.provider === 'amigo' ? -1 : 1
      }
      return a.amount - b.amount
    })
}

export function isAmigoBillsEnabled() {
  return Boolean(getAmigoApiKey())
}

export async function listAmigoDataBundleNetworkProviders(
  networkProviders: NetworkProvider[],
  options?: { forceRefresh?: boolean },
) {
  if (!isAmigoBillsEnabled()) return networkProviders

  const now = Date.now()
  if (!options?.forceRefresh && amigoCatalogCache && amigoCatalogCache.expiresAt > now) {
    logAmigoBills('catalog.cache-hit', {
      expiresInMs: amigoCatalogCache.expiresAt - now,
      providers: amigoCatalogCache.providers.map(provider => ({
        name: provider.name,
        bundleCount: provider.dataBundles?.length ?? 0,
      })),
    })
    return amigoCatalogCache.providers
  }

  if (amigoCatalogPromise) {
    logAmigoBills('catalog.join')
    return amigoCatalogPromise
  }

  if (options?.forceRefresh) {
    logAmigoBills('catalog.cache-bypass', { reason: 'forceRefresh' })
  }

  logAmigoBills('catalog.request')
  amigoCatalogPromise = Promise.resolve().then(() => {
      const bundlesByNetworkId = new Map<number, BillDataBundle[]>()
      bundlesByNetworkId.set(1, toAmigoBundles(1, AMIGO_STATIC_REGULAR_PLANS.mtn))
      bundlesByNetworkId.set(2, toAmigoBundles(2, AMIGO_STATIC_REGULAR_PLANS.glo))
      bundlesByNetworkId.set(4, toAmigoBundles(4, AMIGO_STATIC_REGULAR_PLANS.airtel))

      logAmigoBills('catalog.response', {
        source: 'static_verified_catalog',
        providers: Array.from(bundlesByNetworkId.entries()).map(([networkId, bundles]) => ({
          networkId,
          bundleCount: bundles.length,
          bundles: bundles.map(bundle => ({
            planId: bundle.providerPlanId,
            label: bundle.label,
            amount: bundle.amount,
            validity: bundle.validity,
            category: bundle.efficiencyLabel || null,
          })),
        })),
      })

      const mergedProviders = networkProviders.map(provider => {
        const networkKey = normalizeNetworkProvider(provider.name)
        const networkId = AMIGO_NETWORK_IDS[networkKey]
        const dataBundles = networkId ? bundlesByNetworkId.get(networkId) : undefined
        return dataBundles && dataBundles.length > 0
          ? { ...provider, dataBundles: mergeProviderBundles(provider.dataBundles, dataBundles) }
          : provider
      })

      amigoCatalogCache = {
        expiresAt: Date.now() + AMIGO_CATALOG_TTL_MS,
        providers: mergedProviders,
      }

      return mergedProviders
    })
    .catch(error => {
      logAmigoBills('catalog.error', {
        message: error instanceof Error ? error.message : 'Unknown Amigo catalog error.',
      })
      throw error
    })
    .finally(() => {
      amigoCatalogPromise = null
    })

  return amigoCatalogPromise
}

export async function listAmigoDataBundleNetworkProvidersSafe(
  networkProviders: NetworkProvider[],
  options?: { forceRefresh?: boolean },
) {
  try {
    return await listAmigoDataBundleNetworkProviders(networkProviders, options)
  } catch (error) {
    const fallbackProviders = amigoCatalogCache?.providers ?? networkProviders
    logAmigoBills('catalog.fallback', {
      message: error instanceof Error ? error.message : 'Unknown Amigo catalog fallback error.',
      fallbackProviders: fallbackProviders.map(provider => ({
        name: provider.name,
        bundleCount: provider.dataBundles?.length ?? 0,
      })),
    })
    return fallbackProviders
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
