import type { BillDataBundle, NetworkProvider } from '@/types'
import { findBalanceInPayload, type ProviderBalance } from '@/lib/server/provider-balance'

/**
 * ASBDATA VTU API — data bundles and airtime.
 *
 * Docs: https://documenter.getpostman.com/view/12429346/UVe9QUS8
 * Auth: Authorization: Token <token>
 *
 *   GET  /api/network/  plan catalog
 *   POST /api/data/     buy data
 *   POST /api/topup/    buy airtime
 *
 * Ported from the online-data-sub repo, with two deliberate departures: that version works in
 * kobo and simulates a successful purchase when no token is configured. Here everything is whole
 * naira, and an unconfigured provider reports failure -- a fake success would debit a real wallet.
 *
 * Note the network ids are NOT the same as Amigo's: 9mobile is 3 here and 9 there. A plan id is
 * only ever meaningful to the provider that issued it, which is why bundles carry both
 * providerPlanId and providerNetworkId.
 */

export type AsbdataPaymentResult = {
  provider: 'asbdata'
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

type AsbdataPlan = {
  networkId: number
  planId: number
  size: string
  validity: string
  wholesaleNgn: number
  planType: string
}

type AsbdataCatalogCache = {
  expiresAt: number
  providers: NetworkProvider[]
}

const ASBDATA_CATALOG_TTL_MS = 5 * 60 * 1000
const ASBDATA_MAX_ATTEMPTS = 3
const ASBDATA_MIN_AIRTIME_NGN = 50
const BILLS_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_BILLS === '1'

export const ASBDATA_PLATFORM_MARKUP_NGN = Number(process.env.MAFITAPAY_ASBDATA_PLATFORM_MARKUP_NGN ?? 15)

const ASBDATA_NETWORK_IDS: Record<string, number> = {
  mtn: 1,
  glo: 2,
  '9mobile': 3,
  etisalat: 3,
  airtel: 4,
}

const ASBDATA_NETWORK_FROM_ID: Record<number, string> = {
  1: 'MTN',
  2: 'Glo',
  3: '9mobile',
  4: 'Airtel',
}

let asbdataCatalogCache: AsbdataCatalogCache | null = null
let asbdataCatalogPromise: Promise<NetworkProvider[]> | null = null

function logAsbdataBills(event: string, details?: Record<string, unknown>) {
  if (!BILLS_LOGGING_ENABLED) return
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[asbdata-bills] ${event}${payload}`)
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

function getAsbdataConfig() {
  return {
    baseUrl: (process.env.MAFITAPAY_ASBDATA_BASE_URL?.trim() || 'https://asbdata.com').replace(/\/+$/, ''),
    token: process.env.MAFITAPAY_ASBDATA_TOKEN?.trim() || '',
    airtimeType: process.env.MAFITAPAY_ASBDATA_AIRTIME_TYPE?.trim() || 'VTU',
  }
}

export function isAsbdataBillsEnabled() {
  return Boolean(getAsbdataConfig().token)
}

/**
 * Prepaid float ASBDATA holds for us — the wallet bills and airtime are vended against.
 *
 * The account endpoint has moved between deployments, so the path is overridable and the balance
 * field is located by search rather than a fixed key. Fails soft: this backs an admin display, so
 * an unreachable provider should read "unavailable" beside the other figures, not blank the page.
 */
export async function getAsbdataBalance(): Promise<ProviderBalance> {
  const config = getAsbdataConfig()
  const label = 'ASBDATA float'

  if (!config.token) {
    return {
      provider: 'asbdata',
      label,
      configured: false,
      balance: null,
      message: 'ASBDATA token is not configured.',
    }
  }

  const path = process.env.MAFITAPAY_ASBDATA_BALANCE_PATH?.trim() || '/api/user/'

  try {
    const { status, json } = await asbdataRequest('GET', path)

    if (status >= 400) {
      logAsbdataBills('balance.error', { status })
      return {
        provider: 'asbdata',
        label,
        configured: true,
        balance: null,
        message: `ASBDATA balance request failed (${status}).`,
      }
    }

    const balance = findBalanceInPayload(json)
    if (balance == null) {
      logAsbdataBills('balance.unrecognized')
      return {
        provider: 'asbdata',
        label,
        configured: true,
        balance: null,
        message: 'ASBDATA balance response did not include a recognizable balance field.',
      }
    }

    logAsbdataBills('balance.ok', { balance })
    return { provider: 'asbdata', label, configured: true, balance }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ASBDATA balance request failed.'
    logAsbdataBills('balance.threw', { message })
    return { provider: 'asbdata', label, configured: true, balance: null, message }
  }
}

export function getAsbdataNetworkId(networkName: string): number | undefined {
  const normalized = networkName.trim().toLowerCase()
  if (normalized.includes('mtn')) return ASBDATA_NETWORK_IDS.mtn
  if (normalized.includes('glo')) return ASBDATA_NETWORK_IDS.glo
  if (normalized.includes('airtel')) return ASBDATA_NETWORK_IDS.airtel
  if (normalized.includes('9mobile') || normalized.includes('etisalat')) return ASBDATA_NETWORK_IDS['9mobile']
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
    return 'Could not reach ASBDATA. The purchase may or may not have gone through.'
  }
  return error instanceof Error ? error.message : 'ASBDATA request failed.'
}

async function asbdataRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: unknown; text: string }> {
  const config = getAsbdataConfig()
  if (!config.token) {
    throw new Error('ASBDATA is not configured.')
  }

  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  let lastError: unknown

  for (let attempt = 1; attempt <= ASBDATA_MAX_ATTEMPTS; attempt += 1) {
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
      if (!isTransportError(error) || attempt === ASBDATA_MAX_ATTEMPTS) throw error
      await new Promise(resolve => setTimeout(resolve, 400 * attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * ASBDATA answers the catalog with network-keyed arrays (MTN_PLAN, GLO_PLAN, ...) but the shape
 * has moved around, so fall back through the other layouts seen in the wild.
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
  return getAsbdataNetworkId(name) ?? null
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

function parsePlanRow(row: Record<string, unknown>): AsbdataPlan | null {
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
  if (!ASBDATA_NETWORK_FROM_ID[networkId]) return null

  const rawSize = readString(row.plan) || readString(row.size || row.plan_size || row.data_size) || 'Data'
  // Some rows echo the plan id in the size column; that is not a data size.
  const size = /^\d+$/.test(rawSize) && rawSize === String(planId) ? 'Data' : normalizeSize(rawSize)
  const validity = readString(row.month_validate || row.validity || row.plan_validity || row.day) || '—'
  const planType = readString(row.plan_type || row.type || row.category)

  return { networkId, planId, size, validity, wholesaleNgn, planType }
}

function toAsbdataBundles(plans: AsbdataPlan[]): BillDataBundle[] {
  return plans.map(plan => ({
    label: plan.size,
    amount: plan.wholesaleNgn + ASBDATA_PLATFORM_MARKUP_NGN,
    itemCode: `ASBDATA_PLAN_${plan.planId}`,
    billerCode: `ASBDATA_NETWORK_${plan.networkId}`,
    itemName: plan.size,
    validity: plan.validity,
    provider: 'asbdata' as const,
    providerPlanId: String(plan.planId),
    providerNetworkId: plan.networkId,
    efficiencyLabel: plan.planType || undefined,
  }))
}

function mergeAsbdataBundles(existing: BillDataBundle[] | undefined, incoming: BillDataBundle[]) {
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

async function loadAsbdataPlans(): Promise<AsbdataPlan[]> {
  const { status, json } = await asbdataRequest('GET', '/api/network/')
  if (status >= 400) {
    throw new Error(`ASBDATA plan catalog failed (${status}).`)
  }

  const rows = extractPlanRows(json)
  const plans = rows.map(parsePlanRow).filter((plan): plan is AsbdataPlan => plan !== null)

  logAsbdataBills('catalog.response', { rows: rows.length, plans: plans.length })

  if (rows.length > 0 && plans.length === 0) {
    // The endpoint answered but nothing matched the shapes we know about. Surface it rather than
    // quietly serving an empty catalog.
    throw new Error('ASBDATA plan catalog returned no recognizable plans.')
  }

  return plans
}

export async function listAsbdataDataBundleNetworkProviders(
  networkProviders: NetworkProvider[],
  options?: { forceRefresh?: boolean },
): Promise<NetworkProvider[]> {
  if (!isAsbdataBillsEnabled()) return networkProviders

  const now = Date.now()
  if (!options?.forceRefresh && asbdataCatalogCache && asbdataCatalogCache.expiresAt > now) {
    logAsbdataBills('catalog.cache-hit', { expiresInMs: asbdataCatalogCache.expiresAt - now })
    return asbdataCatalogCache.providers
  }

  if (asbdataCatalogPromise) {
    logAsbdataBills('catalog.join')
    return asbdataCatalogPromise
  }

  logAsbdataBills('catalog.request')
  asbdataCatalogPromise = loadAsbdataPlans()
    .then(plans => {
      const bundlesByNetworkId = new Map<number, BillDataBundle[]>()
      for (const bundle of toAsbdataBundles(plans)) {
        const networkId = bundle.providerNetworkId
        if (networkId === undefined) continue
        const current = bundlesByNetworkId.get(networkId) ?? []
        current.push(bundle)
        bundlesByNetworkId.set(networkId, current)
      }

      const mergedProviders = networkProviders.map(provider => {
        const networkKey = normalizeNetworkProviderName(provider.name)
        const networkId = ASBDATA_NETWORK_IDS[networkKey]
        const bundles = networkId ? bundlesByNetworkId.get(networkId) : undefined
        return bundles && bundles.length > 0
          ? { ...provider, dataBundles: mergeAsbdataBundles(provider.dataBundles, bundles) }
          : provider
      })

      asbdataCatalogCache = {
        expiresAt: Date.now() + ASBDATA_CATALOG_TTL_MS,
        providers: mergedProviders,
      }

      return mergedProviders
    })
    .catch(error => {
      logAsbdataBills('catalog.error', {
        message: error instanceof Error ? error.message : 'Unknown ASBDATA catalog error.',
      })
      throw error
    })
    .finally(() => {
      asbdataCatalogPromise = null
    })

  return asbdataCatalogPromise
}

export async function listAsbdataDataBundleNetworkProvidersSafe(
  networkProviders: NetworkProvider[],
  options?: { forceRefresh?: boolean },
): Promise<NetworkProvider[]> {
  try {
    return await listAsbdataDataBundleNetworkProviders(networkProviders, options)
  } catch (error) {
    logAsbdataBills('catalog.fallback', {
      message: error instanceof Error ? error.message : 'Unknown ASBDATA catalog fallback error.',
    })
    return asbdataCatalogCache?.providers ?? networkProviders
  }
}

/**
 * ASBDATA reports failures with HTTP 200 and a status field, so the body decides the outcome.
 * Anything we cannot read as an explicit success is treated as a failure.
 */
function mapPurchaseResult(
  status: number,
  json: unknown,
  text: string,
  reference: string,
  context: { networkId: number; planId?: number },
): AsbdataPaymentResult {
  const record = isRecord(json) ? json : {}
  const statusText = (readString(record.Status) || readString(record.status) || readString(record.status_code)).toLowerCase()
  const apiCode = readNumber(record.status) ?? readNumber(record.Status) ?? readNumber(record.code)

  const message =
    readString(record.api_response)
    || readString(record.message)
    || readString(record.msg)
    || readString(record.error)
    || (text && text.length < 200 ? text : '')
    || (status >= 400 ? `ASBDATA HTTP ${status}` : '')

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
    provider: 'asbdata',
    reference,
    status: success ? 'success' : 'failed',
    rawStatus: statusText || String(status),
    reason: success ? undefined : (message || 'ASBDATA purchase failed.'),
    providerReference: providerReference || undefined,
    payload: isRecord(json) ? json : undefined,
    networkId: context.networkId,
    planId: context.planId,
    // A 2xx with no readable status means we cannot prove either outcome.
    indeterminate: !looksFailed && !looksSuccessful && status < 400,
  }
}

export async function createAsbdataDataPayment(input: {
  networkId: number
  mobileNumber: string
  planId: string
  reference: string
}): Promise<AsbdataPaymentResult> {
  const planId = Number(input.planId)
  if (!Number.isFinite(planId)) {
    return {
      provider: 'asbdata',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'INVALID_PLAN',
      reason: 'Invalid ASBDATA plan id.',
      networkId: input.networkId,
    }
  }

  if (!ASBDATA_NETWORK_FROM_ID[input.networkId]) {
    return {
      provider: 'asbdata',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'UNSUPPORTED_NETWORK',
      reason: 'Selected network is not supported by ASBDATA.',
      networkId: input.networkId,
      planId,
    }
  }

  logAsbdataBills('purchase.request', { kind: 'data', networkId: input.networkId, planId, reference: input.reference })

  try {
    const { status, json, text } = await asbdataRequest('POST', '/api/data/', {
      network: input.networkId,
      mobile_number: digitsOnly(input.mobileNumber),
      plan: planId,
      Ported_number: true,
    })

    const result = mapPurchaseResult(status, json, text, input.reference, { networkId: input.networkId, planId })
    logAsbdataBills('purchase.response', { kind: 'data', status: result.status, rawStatus: result.rawStatus })
    return result
  } catch (error) {
    const indeterminate = isTransportError(error)
    logAsbdataBills('purchase.error', { kind: 'data', message: transportMessage(error), indeterminate })
    return {
      provider: 'asbdata',
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

export async function createAsbdataAirtimePayment(input: {
  networkId: number
  mobileNumber: string
  amount: number
  reference: string
}): Promise<AsbdataPaymentResult> {
  if (!ASBDATA_NETWORK_FROM_ID[input.networkId]) {
    return {
      provider: 'asbdata',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'UNSUPPORTED_NETWORK',
      reason: 'Selected network is not supported by ASBDATA.',
      networkId: input.networkId,
    }
  }

  const amountNgn = Math.round(input.amount)
  if (amountNgn < ASBDATA_MIN_AIRTIME_NGN) {
    return {
      provider: 'asbdata',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'AMOUNT_TOO_LOW',
      reason: `Minimum ASBDATA airtime is ₦${ASBDATA_MIN_AIRTIME_NGN}.`,
      networkId: input.networkId,
    }
  }

  const config = getAsbdataConfig()
  logAsbdataBills('purchase.request', { kind: 'airtime', networkId: input.networkId, amount: amountNgn, reference: input.reference })

  try {
    const { status, json, text } = await asbdataRequest('POST', '/api/topup/', {
      network: input.networkId,
      amount: amountNgn,
      mobile_number: digitsOnly(input.mobileNumber),
      Ported_number: true,
      airtime_type: config.airtimeType,
    })

    const result = mapPurchaseResult(status, json, text, input.reference, { networkId: input.networkId })
    logAsbdataBills('purchase.response', { kind: 'airtime', status: result.status, rawStatus: result.rawStatus })
    return result
  } catch (error) {
    const indeterminate = isTransportError(error)
    logAsbdataBills('purchase.error', { kind: 'airtime', message: transportMessage(error), indeterminate })
    return {
      provider: 'asbdata',
      reference: input.reference,
      status: 'failed',
      rawStatus: indeterminate ? 'TRANSPORT_ERROR' : 'REQUEST_ERROR',
      reason: transportMessage(error),
      networkId: input.networkId,
      indeterminate,
    }
  }
}
