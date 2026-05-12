import type { BillCatalogBiller, BillCatalogItem, BillDataBundle, BillProvider, NetworkProvider } from '@/types'

type FlutterwaveBillItem = {
  billerCode: string
  itemCode: string
  name: string
  amount: number
}

type FlutterwaveDataBundleCache = {
  expiresAt: number
  providers: NetworkProvider[]
}

type FlutterwaveBillItemsInFlightCache = Map<string, Promise<FlutterwaveBillItem[]>>

class FlutterwaveRequestError extends Error {
  statusCode: number
  statusText: string
  body: Record<string, unknown>

  constructor(message: string, statusCode: number, statusText: string, body: Record<string, unknown>) {
    super(message)
    this.name = 'FlutterwaveRequestError'
    this.statusCode = statusCode
    this.statusText = statusText
    this.body = body
  }
}

export type FlutterwaveBillPaymentResult = {
  provider: 'flutterwave'
  reference: string
  status: 'pending' | 'success' | 'failed'
  rawStatus?: string
  reason?: string
  providerReference?: string
  payload?: Record<string, unknown>
  billerCode?: string
  itemCode?: string
  itemName?: string
}

const FLUTTERWAVE_SUPPORTED_BILL_TYPES = new Set<BillProvider['type']>(['airtime', 'data', 'cable', 'electric'])
const FLUTTERWAVE_AIRTIME_BILLER_CODE = 'BIL099'
const FLUTTERWAVE_AIRTIME_ITEM_CODE = 'AT099'
const FLUTTERWAVE_DATA_BILLER_CODES: Record<string, string> = {
  mtn: 'BIL108',
  glo: 'BIL109',
  airtel: 'BIL110',
  '9mobile': 'BIL111',
  etisalat: 'BIL111',
}
const FLUTTERWAVE_DATA_BUNDLE_VALIDITY_OVERRIDES: Record<string, string> = {
  MD135: '1 day',
  MD136: '7 days',
  MD137: '7 days',
  MD139: '7 days',
  MD140: '30 days',
  MD373: '30 days',
  MD374: '30 days',
  MD376: '30 days',
  MD377: '30 days',
  MD378: '30 days',
  MD379: '30 days',
  MD147: '1 day',
  MD148: '30 days',
  MD149: '30 days',
  MD150: '30 days',
  MD151: '30 days',
  MD367: '30 days',
  MD368: '30 days',
  MD370: '30 days',
  MD372: '30 days',
  MD154: '30 days',
  MD155: '30 days',
  MD361: '30 days',
  MD141: '30 days',
  MD492: '30 days',
  MD573: '30 days',
  MD567: '30 days',
  MD569: '30 days',
  MD259: '30 days',
  MD617: '30 days',
  MD618: '30 days',
  MD619: '30 days',
  MD621: '30 days',
  MD624: '30 days',
  MD625: '30 days',
  MD626: '30 days',
  MD627: '60 days',
  MD629: '60 days',
  MD606: '30 days',
  MD610: '30 days',
  MD611: '30 days',
  MD612: '30 days',
  MD613: '30 days',
  MD608: '7 days',
  MD633: '30 days',
}
const FLUTTERWAVE_DATA_BUNDLE_CACHE_TTL_MS = 5 * 60 * 1000
const FLUTTERWAVE_CABLE_CATEGORY_CODE = 'CABLEBILLS'
const FLUTTERWAVE_CABLE_BILLERS_CACHE_TTL_MS = 10 * 60 * 1000
const FLUTTERWAVE_ELECTRIC_BILLERS_CACHE_TTL_MS = 10 * 60 * 1000
let flutterwaveDataBundleCache: FlutterwaveDataBundleCache | null = null
const flutterwaveBillItemsInFlight: FlutterwaveBillItemsInFlightCache = new Map()
let flutterwaveCableBillersCache: { expiresAt: number; billers: BillCatalogBiller[] } | null = null
let flutterwaveElectricBillersCache: { expiresAt: number; billers: BillCatalogBiller[] } | null = null
const BILLS_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_BILLS === '1'
const FLUTTERWAVE_ELECTRIC_BILLERS: FlutterwaveBiller[] = [
  { name: 'EKEDC', shortName: 'Eko Disco', billerCode: 'BIL112' },
  { name: 'IKEDC', shortName: 'Ikeja Disco', billerCode: 'BIL113' },
  { name: 'IBEDC', shortName: 'Ibadan Disco', billerCode: 'BIL114' },
  { name: 'EEDC', shortName: 'Enugu Disco', billerCode: 'BIL115' },
  { name: 'PHED', shortName: 'Port Harcourt Disco', billerCode: 'BIL116' },
  { name: 'BEDC', shortName: 'Benin Disco', billerCode: 'BIL117' },
  { name: 'YEDC', shortName: 'Yola Disco', billerCode: 'BIL118' },
  { name: 'KEDC', shortName: 'Kaduna Disco', billerCode: 'BIL119' },
  { name: 'KEDCO', shortName: 'Kano Disco', billerCode: 'BIL120' },
  { name: 'AEDC', shortName: 'Abuja Disco', billerCode: 'BIL204' },
]

function logFlutterwaveBills(event: string, details?: Record<string, unknown>) {
  if (!BILLS_LOGGING_ENABLED) return
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[flutterwave-bills] ${event}${payload}`)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getFlutterwaveSecretKey() {
  return readString(process.env.MAFITAPAY_FLUTTERWAVE_SECRET_KEY)
}

function getFlutterwaveBaseUrl() {
  const explicit = readString(process.env.MAFITAPAY_FLUTTERWAVE_BASE_URL)
  if (explicit) return explicit.replace(/\/$/, '')
  return 'https://api.flutterwave.com/v3'
}

function getFlutterwaveBillsCallbackUrl() {
  return readString(process.env.MAFITAPAY_FLUTTERWAVE_BILLS_CALLBACK_URL)
}

function normalizeNetworkProvider(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('mtn')) return 'mtn'
  if (normalized.includes('glo')) return 'glo'
  if (normalized.includes('airtel')) return 'airtel'
  if (normalized.includes('9mobile') || normalized.includes('etisalat')) return '9mobile'
  return normalized
}

function formatDataBundleLabel(name: string) {
  const sizeMatch = name.match(/(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)/i)
  if (sizeMatch) {
    return `${sizeMatch[1]}${sizeMatch[2].toUpperCase()}`
  }
  return name.replace(/\s+data\s+bundle|\s+data\s+top-up\s+service|\s+data\s+purchase/gi, '').trim() || name
}

function extractDataBundleValidity(name: string) {
  const normalized = name.replace(/\s+/g, ' ').trim()

  const explicitDays = normalized.match(/(\d+)\s*(day|days)/i)
  if (explicitDays) {
    return `${explicitDays[1]} day${explicitDays[1] === '1' ? '' : 's'}`
  }

  const explicitWeeks = normalized.match(/(\d+)\s*(week|weeks)/i)
  if (explicitWeeks) {
    return `${explicitWeeks[1]} week${explicitWeeks[1] === '1' ? '' : 's'}`
  }

  const explicitMonths = normalized.match(/(\d+)\s*(month|months)/i)
  if (explicitMonths) {
    return `${explicitMonths[1]} month${explicitMonths[1] === '1' ? '' : 's'}`
  }

  if (/\bdaily\b/i.test(normalized)) return '1 day'
  if (/\bweekly\b/i.test(normalized)) return '7 days'
  if (/\bmonthly\b/i.test(normalized)) return '30 days'
  if (/\bnight\b/i.test(normalized)) return 'Night plan'
  if (/\bweekend\b/i.test(normalized)) return 'Weekend'

  return undefined
}

function resolveDataBundleValidity(itemCode: string, name: string) {
  const parsedValidity = extractDataBundleValidity(name)
  if (parsedValidity) return parsedValidity
  return FLUTTERWAVE_DATA_BUNDLE_VALIDITY_OVERRIDES[itemCode]
}

function mapFlutterwaveBillStatus(rawStatus: string | undefined, fallbackStatus: string | undefined): FlutterwaveBillPaymentResult['status'] {
  const normalized = readString(rawStatus || fallbackStatus).toLowerCase()
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed'
  if (normalized.includes('pending') || normalized.includes('process') || normalized.includes('queue')) return 'pending'
  return 'success'
}

async function flutterwaveRequest(path: string, init?: RequestInit) {
  const secretKey = getFlutterwaveSecretKey()
  if (!secretKey) {
    throw new Error('Flutterwave bills are not configured.')
  }

  const response = await fetch(`${getFlutterwaveBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}

  if (!response.ok || readString(body.status).toLowerCase() !== 'success') {
    throw new FlutterwaveRequestError(
      readString(body.message) || 'Flutterwave bill request failed.',
      response.status,
      response.statusText,
      body,
    )
  }

  return body
}

async function getFlutterwaveBillItems(billerCode: string): Promise<FlutterwaveBillItem[]> {
  const inFlight = flutterwaveBillItemsInFlight.get(billerCode)
  if (inFlight) {
    logFlutterwaveBills('data-bundles.join', { billerCode })
    return inFlight
  }

  logFlutterwaveBills('data-bundles.request', { billerCode })
  const request = flutterwaveRequest(`/billers/${encodeURIComponent(billerCode)}/items`)
    .then(body => {
      const rows = Array.isArray(body.data) ? body.data : []

      const items = rows
        .map(row => {
          if (!isRecord(row)) return null
          const itemCode = readString(row.item_code)
          const name = readString(row.name)
          const amount = Number(row.amount)
          if (!itemCode || !name || !Number.isFinite(amount)) return null
          return {
            billerCode,
            itemCode,
            name,
            amount,
          }
        })
        .filter((item): item is FlutterwaveBillItem => Boolean(item))

      logFlutterwaveBills('data-bundles.response', {
        billerCode,
        count: items.length,
        items: items.map(item => ({
          itemCode: item.itemCode,
          amount: item.amount,
          rawName: item.name,
          label: formatDataBundleLabel(item.name),
          validity: resolveDataBundleValidity(item.itemCode, item.name) || null,
        })),
      })

      return items
    })
    .catch(error => {
    logFlutterwaveBills('data-bundles.error', {
        billerCode,
        message: error instanceof Error ? error.message : 'Unknown Flutterwave bundle fetch error.',
        ...(error instanceof FlutterwaveRequestError ? {
          statusCode: error.statusCode,
          statusText: error.statusText,
          body: error.body,
        } : {}),
      })
      throw error
    })
    .finally(() => {
      flutterwaveBillItemsInFlight.delete(billerCode)
    })

  flutterwaveBillItemsInFlight.set(billerCode, request)
  return request
}

function toFlutterwaveDataBundles(items: FlutterwaveBillItem[]): BillDataBundle[] {
  return items.map(item => ({
    label: formatDataBundleLabel(item.name),
    amount: item.amount,
    itemCode: item.itemCode,
    billerCode: item.billerCode,
    itemName: item.name,
    validity: resolveDataBundleValidity(item.itemCode, item.name),
  }))
}

type FlutterwaveBiller = {
  billerCode: string
  name: string
  shortName?: string
}

async function getFlutterwaveBillersByCategory(category: string): Promise<FlutterwaveBiller[]> {
  const body = await flutterwaveRequest(`/bills/${encodeURIComponent(category)}/billers?country=NG`)
  const rows = Array.isArray(body.data) ? body.data : []
  return rows
    .map(row => {
      if (!isRecord(row)) return null
      const billerCode = readString(row.biller_code)
      const name = readString(row.name)
      if (!billerCode || !name) return null
      return {
        billerCode,
        name,
        shortName: readString(row.short_name) || undefined,
      }
    })
    .filter((row): row is FlutterwaveBiller => Boolean(row))
}

function toCableCatalogItems(items: FlutterwaveBillItem[], accountLabel?: string): BillCatalogItem[] {
  return items.map(item => ({
    label: item.name,
    amount: item.amount,
    itemCode: item.itemCode,
    billerCode: item.billerCode,
    itemName: item.name,
    accountLabel,
  }))
}

async function getFlutterwaveBillerItemsCatalog(biller: FlutterwaveBiller) {
  const body = await flutterwaveRequest(`/billers/${encodeURIComponent(biller.billerCode)}/items`)
  const rows = Array.isArray(body.data) ? body.data : []
  const accountLabel = rows.find(isRecord)
    ? readString((rows.find(isRecord) as Record<string, unknown>).label_name) || undefined
    : undefined
  const items = rows
    .map(row => {
      if (!isRecord(row)) return null
      const itemCode = readString(row.item_code)
      const name = readString(row.name)
      const amount = Number(row.amount)
      if (!itemCode || !name || !Number.isFinite(amount)) return null
      return {
        billerCode: biller.billerCode,
        itemCode,
        name,
        amount,
      } satisfies FlutterwaveBillItem
    })
    .filter((item): item is FlutterwaveBillItem => Boolean(item))

  return {
    name: biller.name,
    shortName: biller.shortName,
    billerCode: biller.billerCode,
    accountLabel,
    items: toCableCatalogItems(items, accountLabel),
  } satisfies BillCatalogBiller
}

async function validateFlutterwaveBillCustomer(itemCode: string, customer: string) {
  await flutterwaveRequest(`/bill-items/${encodeURIComponent(itemCode)}/validate?customer=${encodeURIComponent(customer)}`)
}

async function resolveFlutterwaveBillTarget(input: {
  type: BillProvider['type']
  networkProvider?: string
  amount: number
  billerCode?: string
  itemCode?: string
}): Promise<FlutterwaveBillItem> {
  if (input.type === 'airtime') {
    return {
      billerCode: FLUTTERWAVE_AIRTIME_BILLER_CODE,
      itemCode: FLUTTERWAVE_AIRTIME_ITEM_CODE,
      name: 'Airtime',
      amount: input.amount,
    }
  }

  if (input.type === 'cable') {
    if (!input.billerCode || !input.itemCode) {
      throw new Error('Select a valid cable package.')
    }

    const items = await getFlutterwaveBillItems(input.billerCode)
    const match = items.find(item =>
      item.itemCode === input.itemCode
      && item.billerCode === input.billerCode
      && Math.abs(item.amount - input.amount) < 0.0001
    )
    if (!match) {
      throw new Error('Selected cable package is no longer available.')
    }
    return match
  }

  if (input.type === 'electric') {
    if (!input.billerCode || !input.itemCode) {
      throw new Error('Select a valid electricity package.')
    }

    const items = await getFlutterwaveBillItems(input.billerCode)
    const match = items.find(item =>
      item.itemCode === input.itemCode
      && item.billerCode === input.billerCode
    )
    if (!match) {
      throw new Error('Selected electricity package is no longer available.')
    }
    return match
  }

  if (input.type !== 'data') {
    throw new Error('Selected bill category is not live yet.')
  }

  const networkKey = normalizeNetworkProvider(input.networkProvider || '')
  const billerCode = FLUTTERWAVE_DATA_BILLER_CODES[networkKey]
  if (!billerCode) {
    throw new Error('Selected network provider is not supported for live data vending yet.')
  }

  const items = await getFlutterwaveBillItems(billerCode)
  const match = input.itemCode
    ? items.find(item =>
      item.itemCode === input.itemCode
      && item.billerCode === (input.billerCode || billerCode)
      && Math.abs(item.amount - input.amount) < 0.0001
    )
    : items.find(item => Math.abs(item.amount - input.amount) < 0.0001)
  if (!match) {
    throw new Error('Selected amount is not available for this network data bundle.')
  }

  return match
}

export function isFlutterwaveBillsEnabled() {
  return Boolean(getFlutterwaveSecretKey())
}

export function isFlutterwaveBillTypeSupported(type: BillProvider['type']) {
  return FLUTTERWAVE_SUPPORTED_BILL_TYPES.has(type)
}

export async function listFlutterwaveDataBundleNetworkProviders(
  networkProviders: NetworkProvider[],
  options?: { forceRefresh?: boolean },
) {
  const now = Date.now()
  if (!options?.forceRefresh && flutterwaveDataBundleCache && flutterwaveDataBundleCache.expiresAt > now) {
    logFlutterwaveBills('data-bundles.cache-hit', {
      expiresInMs: flutterwaveDataBundleCache.expiresAt - now,
      providers: flutterwaveDataBundleCache.providers.map(provider => ({
        name: provider.name,
        bundleCount: provider.dataBundles?.length ?? 0,
      })),
    })
    return flutterwaveDataBundleCache.providers
  }

  if (options?.forceRefresh) {
    logFlutterwaveBills('data-bundles.cache-bypass', { reason: 'forceRefresh' })
  }

  const previousProvidersByName = new Map(
    (flutterwaveDataBundleCache?.providers ?? []).map(provider => [provider.name, provider] as const)
  )

  const resolvedProviders = await Promise.all(
    networkProviders.map(async provider => {
      const networkKey = normalizeNetworkProvider(provider.name)
      const billerCode = FLUTTERWAVE_DATA_BILLER_CODES[networkKey]
      if (!billerCode) return provider

      try {
        const items = await getFlutterwaveBillItems(billerCode)
        const enrichedProvider = {
          ...provider,
          dataBundles: toFlutterwaveDataBundles(items),
        }
        logFlutterwaveBills('data-bundles.provider', {
          provider: provider.name,
          billerCode,
          bundleCount: enrichedProvider.dataBundles?.length ?? 0,
          bundles: enrichedProvider.dataBundles?.map(bundle => ({
            label: bundle.label,
            amount: bundle.amount,
            validity: bundle.validity || null,
            itemCode: bundle.itemCode,
            rawName: bundle.itemName,
          })),
        })
        return enrichedProvider
      } catch (error) {
        const previousProvider = previousProvidersByName.get(provider.name)
        logFlutterwaveBills('data-bundles.provider-error', {
          provider: provider.name,
          billerCode,
          message: error instanceof Error ? error.message : 'Unable to build provider bundle catalog.',
          fallbackBundleCount: previousProvider?.dataBundles?.length ?? 0,
        })
        return previousProvider?.dataBundles?.length ? previousProvider : provider
      }
    })
  )

  const hasResolvedBundles = resolvedProviders.some(provider => (provider.dataBundles?.length ?? 0) > 0)
  const hasPreviousBundles = (flutterwaveDataBundleCache?.providers ?? []).some(provider => (provider.dataBundles?.length ?? 0) > 0)
  const providersToStore = !hasResolvedBundles && hasPreviousBundles
    ? flutterwaveDataBundleCache!.providers
    : resolvedProviders

  flutterwaveDataBundleCache = {
    expiresAt: now + FLUTTERWAVE_DATA_BUNDLE_CACHE_TTL_MS,
    providers: providersToStore,
  }

  logFlutterwaveBills('data-bundles.cache-store', {
    providers: providersToStore.map(provider => ({
      name: provider.name,
      bundleCount: provider.dataBundles?.length ?? 0,
    })),
  })

  return providersToStore
}

export async function listFlutterwaveCableBillProviders(
  providers: BillProvider[],
  options?: { forceRefresh?: boolean },
) {
  const now = Date.now()
  if (!options?.forceRefresh && flutterwaveCableBillersCache && flutterwaveCableBillersCache.expiresAt > now) {
    return providers.map(provider =>
      provider.type === 'cable'
        ? { ...provider, billers: flutterwaveCableBillersCache!.billers }
        : provider
    )
  }

  const billers = await getFlutterwaveBillersByCategory(FLUTTERWAVE_CABLE_CATEGORY_CODE)
  const detailedBillers = await Promise.all(
    billers.map(getFlutterwaveBillerItemsCatalog)
  )

  flutterwaveCableBillersCache = {
    expiresAt: now + FLUTTERWAVE_CABLE_BILLERS_CACHE_TTL_MS,
    billers: detailedBillers.filter(biller => biller.items.length > 0),
  }

  return providers.map(provider =>
    provider.type === 'cable'
      ? { ...provider, billers: flutterwaveCableBillersCache!.billers }
      : provider
  )
}

export async function listFlutterwaveCableBillProvidersSafe(
  providers: BillProvider[],
  options?: { forceRefresh?: boolean },
) {
  try {
    return await listFlutterwaveCableBillProviders(providers, options)
  } catch (error) {
    const fallbackBillers = flutterwaveCableBillersCache?.billers ?? []
    logFlutterwaveBills('cable-billers.fallback', {
      message: error instanceof Error ? error.message : 'Unknown Flutterwave cable catalog fallback error.',
      fallbackBillerCount: fallbackBillers.length,
    })

    return providers.map(provider =>
      provider.type === 'cable'
        ? { ...provider, billers: fallbackBillers }
        : provider
    )
  }
}

export async function listFlutterwaveElectricBillProviders(
  providers: BillProvider[],
  options?: { forceRefresh?: boolean },
) {
  const now = Date.now()
  if (!options?.forceRefresh && flutterwaveElectricBillersCache && flutterwaveElectricBillersCache.expiresAt > now) {
    return providers.map(provider =>
      provider.type === 'electric'
        ? { ...provider, billers: flutterwaveElectricBillersCache!.billers }
        : provider
    )
  }

  const detailedBillers = await Promise.all(
    FLUTTERWAVE_ELECTRIC_BILLERS.map(getFlutterwaveBillerItemsCatalog)
  )

  flutterwaveElectricBillersCache = {
    expiresAt: now + FLUTTERWAVE_ELECTRIC_BILLERS_CACHE_TTL_MS,
    billers: detailedBillers.filter(biller => biller.items.length > 0),
  }

  return providers.map(provider =>
    provider.type === 'electric'
      ? { ...provider, billers: flutterwaveElectricBillersCache!.billers }
      : provider
  )
}

export async function listFlutterwaveElectricBillProvidersSafe(
  providers: BillProvider[],
  options?: { forceRefresh?: boolean },
) {
  try {
    return await listFlutterwaveElectricBillProviders(providers, options)
  } catch (error) {
    const fallbackBillers = flutterwaveElectricBillersCache?.billers ?? []
    logFlutterwaveBills('electric-billers.fallback', {
      message: error instanceof Error ? error.message : 'Unknown Flutterwave electricity catalog fallback error.',
      fallbackBillerCount: fallbackBillers.length,
    })

    return providers.map(provider =>
      provider.type === 'electric'
        ? { ...provider, billers: fallbackBillers }
        : provider
    )
  }
}

export function mapFlutterwaveBillPaymentStatus(status: string | null | undefined): 'success' | 'failed' | null {
  const normalized = readString(status).toLowerCase()
  if (!normalized) return null
  if (normalized.includes('success') || normalized.includes('complete')) return 'success'
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed'
  return null
}

export async function retrieveFlutterwaveBillPayment(reference: string): Promise<FlutterwaveBillPaymentResult> {
  try {
    const body = await flutterwaveRequest(`/bills/${encodeURIComponent(reference)}`)
    const data = isRecord(body.data) ? body.data : {}
    const rawStatus =
      readString(data.status)
      || readString(data.payment_status)
      || readString(data.processor_response)
      || readString(body.message)
      || 'PENDING'

    return {
      provider: 'flutterwave',
      reference: readString(data.reference) || reference,
      status: mapFlutterwaveBillStatus(rawStatus, readString(body.status)),
      rawStatus,
      reason: readString(body.message) || undefined,
      providerReference: readString(data.id) || reference,
      payload: body,
      billerCode: readString(data.biller_code) || undefined,
      itemCode: readString(data.item_code) || undefined,
      itemName: readString(data.name) || undefined,
    }
  } catch (error) {
    return {
      provider: 'flutterwave',
      reference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'Unable to retrieve Flutterwave bill payment.',
    }
  }
}

export async function createFlutterwaveBillPayment(input: {
  type: BillProvider['type']
  networkProvider?: string
  account: string
  amount: number
  reference: string
  billerCode?: string
  itemCode?: string
}): Promise<FlutterwaveBillPaymentResult> {
  if (!isFlutterwaveBillTypeSupported(input.type)) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'UNSUPPORTED',
      reason: 'Selected bill category is not live yet.',
    }
  }

  let target: FlutterwaveBillItem
  try {
    target = await resolveFlutterwaveBillTarget(input)
    if (input.type !== 'airtime' && input.type !== 'data') {
      await validateFlutterwaveBillCustomer(target.itemCode, input.account)
    }
  } catch (error) {
    logFlutterwaveBills('payment.validation-error', {
      type: input.type,
      networkProvider: input.networkProvider || null,
      billerCode: input.billerCode || target?.billerCode || null,
      itemCode: input.itemCode || target?.itemCode || null,
      amount: input.amount,
      message: error instanceof Error ? error.message : 'Unable to validate bill payment details.',
      ...(error instanceof FlutterwaveRequestError ? {
        statusCode: error.statusCode,
        statusText: error.statusText,
        body: error.body,
      } : {}),
    })
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'VALIDATION_ERROR',
      reason: error instanceof Error ? error.message : 'Unable to validate bill payment details.',
    }
  }

  try {
    logFlutterwaveBills('payment.request', {
      type: input.type,
      networkProvider: input.networkProvider || null,
      billerCode: target.billerCode,
      itemCode: target.itemCode,
      itemName: target.name,
      amount: input.amount,
      reference: input.reference,
    })
    const body = await flutterwaveRequest(
      `/billers/${encodeURIComponent(target.billerCode)}/items/${encodeURIComponent(target.itemCode)}/payment`,
      {
        method: 'POST',
        body: JSON.stringify({
          country: 'NG',
          customer_id: input.account,
          amount: input.amount,
          reference: input.reference,
          ...(getFlutterwaveBillsCallbackUrl() ? { callback_url: getFlutterwaveBillsCallbackUrl() } : {}),
          ...(input.type === 'data' ? { type: target.name } : {}),
        }),
      }
    )

    const data = isRecord(body.data) ? body.data : {}
    const rawStatus =
      readString(data.status)
      || readString(data.payment_status)
      || readString(data.processor_response)
      || readString(body.message)
      || 'SUCCESS'

    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: mapFlutterwaveBillStatus(rawStatus, readString(body.status)),
      rawStatus,
      reason: readString(body.message) || undefined,
      providerReference: readString(data.id) || readString(data.reference) || input.reference,
      payload: body,
      billerCode: target.billerCode,
      itemCode: target.itemCode,
      itemName: target.name,
    }
  } catch (error) {
    logFlutterwaveBills('payment.error', {
      type: input.type,
      networkProvider: input.networkProvider || null,
      billerCode: target.billerCode,
      itemCode: target.itemCode,
      itemName: target.name,
      amount: input.amount,
      reference: input.reference,
      message: error instanceof Error ? error.message : 'Flutterwave bill payment failed.',
      ...(error instanceof FlutterwaveRequestError ? {
        statusCode: error.statusCode,
        statusText: error.statusText,
        body: error.body,
      } : {}),
    })
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'Flutterwave bill payment failed.',
    }
  }
}
