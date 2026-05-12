import type { CryptoPairId } from '@/types'

type TransakEnvironment = 'staging' | 'production'

type TransakPairConfig = {
  cryptoCurrencyCode: string
  network: string
}

type TransakAccessTokenResponse =
  | string
  | {
      accessToken?: string
      token?: string
      data?: {
        accessToken?: string
        token?: string
        access_token?: string
        expiresAt?: string
        expires_at?: string
      }
      expiresAt?: string
      expires_at?: string
    }

export type TransakConfigState = {
  configured: boolean
  env: TransakEnvironment
  apiKeyConfigured: boolean
  apiSecretConfigured: boolean
  referrerDomainConfigured: boolean
  redirectUrlConfigured: boolean
}

type CreateTransakWidgetSessionInput = {
  pairId: CryptoPairId
  amountNgn: number
  walletAddress: string
  partnerOrderId: string
  partnerCustomerId: string
  email?: string
  redirectUrl?: string
}

export type TransakOrderStatus =
  | 'AWAITING_PAYMENT_FROM_USER'
  | 'PAYMENT_DONE_MARKED_BY_USER'
  | 'PROCESSING'
  | 'PENDING_DELIVERY_FROM_TRANSAK'
  | 'ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUNDED'
  | 'EXPIRED'

export type TransakOrderSnapshot = {
  providerOrderId: string
  partnerOrderId?: string
  status: TransakOrderStatus | string
  cryptoAmount?: number
  fiatAmount?: number
  walletAddress?: string
  network?: string
  cryptoCurrency?: string
  createdAt?: string
  txHash?: string
  raw: Record<string, unknown>
}

const TRANSAK_PAIR_MAP: Partial<Record<CryptoPairId, TransakPairConfig>> = {
  USDT_BSC: { cryptoCurrencyCode: 'USDT', network: 'bsc' },
  USDC_BASE: { cryptoCurrencyCode: 'USDC', network: 'base' },
  ETH_BASE: { cryptoCurrencyCode: 'ETH', network: 'base' },
  ETH_ETHEREUM: { cryptoCurrencyCode: 'ETH', network: 'ethereum' },
  SOL_SOLANA: { cryptoCurrencyCode: 'SOL', network: 'solana' },
  BNB_BSC: { cryptoCurrencyCode: 'BNB', network: 'bsc' },
}

function readEnv(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : ''
}

function getTransakEnvironment(): TransakEnvironment {
  return readEnv('MAFITAPAY_TRANSAK_ENV').toLowerCase() === 'production' ? 'production' : 'staging'
}

function getPartnerBaseUrl() {
  return getTransakEnvironment() === 'production'
    ? 'https://api.transak.com'
    : 'https://api-stg.transak.com'
}

function getGatewayBaseUrl() {
  return getTransakEnvironment() === 'production'
    ? 'https://api-gateway.transak.com'
    : 'https://api-gateway-stg.transak.com'
}

function getTransakPairConfig(pairId: CryptoPairId) {
  return TRANSAK_PAIR_MAP[pairId] ?? null
}

export function isTransakPairSupported(pairId: CryptoPairId) {
  return Boolean(getTransakPairConfig(pairId))
}

export function getTransakConfigState(): TransakConfigState {
  const apiKeyConfigured = Boolean(readEnv('MAFITAPAY_TRANSAK_API_KEY'))
  const apiSecretConfigured = Boolean(readEnv('MAFITAPAY_TRANSAK_API_SECRET'))
  const referrerDomainConfigured = Boolean(readEnv('MAFITAPAY_TRANSAK_REFERRER_DOMAIN'))
  const redirectUrlConfigured = Boolean(readEnv('MAFITAPAY_TRANSAK_REDIRECT_URL'))

  return {
    configured: apiKeyConfigured && apiSecretConfigured && referrerDomainConfigured,
    env: getTransakEnvironment(),
    apiKeyConfigured,
    apiSecretConfigured,
    referrerDomainConfigured,
    redirectUrlConfigured,
  }
}

export function mapTransakStatusToLocalOrderStatus(status?: string) {
  switch ((status || '').toUpperCase()) {
    case 'COMPLETED':
      return 'fulfilled' as const
    case 'FAILED':
    case 'CANCELLED':
    case 'REFUNDED':
      return 'failed' as const
    case 'EXPIRED':
      return 'expired' as const
    default:
      return 'pending' as const
  }
}

function parseAccessToken(payload: TransakAccessTokenResponse): { token: string; expiresAt?: string } | null {
  if (typeof payload === 'string' && payload.trim()) {
    return { token: payload.trim() }
  }
  if (!payload || typeof payload !== 'object') return null

  const candidates = [
    payload.accessToken,
    payload.token,
    payload.data?.accessToken,
    payload.data?.token,
    payload.data?.access_token,
  ]
  const token = candidates.find(value => typeof value === 'string' && value.trim())
  if (!token) return null

  return {
    token,
    expiresAt:
      payload.expiresAt ||
      payload.expires_at ||
      payload.data?.expiresAt ||
      payload.data?.expires_at,
  }
}

async function getTransakAccessToken() {
  const globalState = globalThis as typeof globalThis & {
    __mafitapayTransakToken?: { token: string; expiresAt?: string; cachedAt: number }
  }
  const cached = globalState.__mafitapayTransakToken
  if (cached) {
    const expiresAtMs = cached.expiresAt ? new Date(cached.expiresAt).getTime() : cached.cachedAt + 25 * 60 * 1000
    if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > 60_000) {
      return cached.token
    }
  }

  const secret = readEnv('MAFITAPAY_TRANSAK_API_SECRET')
  if (!secret) {
    throw new Error('Transak API secret is not configured.')
  }

  const response = await fetch(`${getPartnerBaseUrl()}/partners/api/v2/refresh-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      apiSecret: secret,
    }),
  })

  const payload = (await response.json().catch(() => null)) as TransakAccessTokenResponse | null
  if (!response.ok || !payload) {
    throw new Error('Unable to refresh Transak access token.')
  }

  const parsed = parseAccessToken(payload)
  if (!parsed) {
    throw new Error('Transak access token response could not be parsed.')
  }

  globalState.__mafitapayTransakToken = {
    token: parsed.token,
    expiresAt: parsed.expiresAt,
    cachedAt: Date.now(),
  }

  return parsed.token
}

function parseTransakOrder(raw: Record<string, unknown>): TransakOrderSnapshot | null {
  const providerOrderId = typeof raw._id === 'string'
    ? raw._id
    : typeof raw.orderId === 'string'
      ? raw.orderId
      : ''
  if (!providerOrderId) return null

  return {
    providerOrderId,
    partnerOrderId: typeof raw.partnerOrderId === 'string' ? raw.partnerOrderId : undefined,
    status: typeof raw.status === 'string' ? raw.status : 'PROCESSING',
    cryptoAmount: typeof raw.cryptoAmount === 'number' ? raw.cryptoAmount : undefined,
    fiatAmount: typeof raw.fiatAmount === 'number' ? raw.fiatAmount : undefined,
    walletAddress: typeof raw.walletAddress === 'string' ? raw.walletAddress : undefined,
    network: typeof raw.network === 'string' ? raw.network : undefined,
    cryptoCurrency: typeof raw.cryptoCurrency === 'string' ? raw.cryptoCurrency : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    txHash: typeof raw.txHash === 'string' ? raw.txHash : undefined,
    raw,
  }
}

export async function getTransakOrderByPartnerOrderId(partnerOrderId: string): Promise<TransakOrderSnapshot | null> {
  const config = getTransakConfigState()
  if (!config.configured) {
    throw new Error('Transak is not fully configured.')
  }

  const accessToken = await getTransakAccessToken()
  const url = new URL(`${getPartnerBaseUrl()}/partners/api/v2/orders`)
  url.searchParams.set('limit', '1')
  url.searchParams.set('filter[productsAvailed]', '["BUY"]')
  url.searchParams.set('filter[partnerOrderId]', partnerOrderId)

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'access-token': accessToken,
    },
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>> } | null
  if (!response.ok) {
    throw new Error('Unable to fetch Transak order status.')
  }

  const first = Array.isArray(payload?.data) ? payload.data[0] : null
  if (!first) return null
  return parseTransakOrder(first)
}

export async function createTransakWidgetSession(input: CreateTransakWidgetSessionInput) {
  const config = getTransakConfigState()
  if (!config.configured) {
    throw new Error('Transak is not fully configured.')
  }

  const pair = getTransakPairConfig(input.pairId)
  if (!pair) {
    throw new Error('Unsupported Transak pair.')
  }

  const accessToken = await getTransakAccessToken()
  const apiKey = readEnv('MAFITAPAY_TRANSAK_API_KEY')
  const referrerDomain = readEnv('MAFITAPAY_TRANSAK_REFERRER_DOMAIN')
  const redirectUrl = input.redirectUrl || readEnv('MAFITAPAY_TRANSAK_REDIRECT_URL')

  const response = await fetch(`${getGatewayBaseUrl()}/api/v2/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'access-token': accessToken,
    },
    body: JSON.stringify({
      widgetParams: {
        apiKey,
        referrerDomain,
        productsAvailed: 'BUY',
        fiatAmount: input.amountNgn,
        fiatCurrency: 'NGN',
        cryptoCurrencyCode: pair.cryptoCurrencyCode,
        network: pair.network,
        walletAddress: input.walletAddress,
        disableWalletAddressForm: true,
        partnerOrderId: input.partnerOrderId,
        partnerCustomerId: input.partnerCustomerId,
        redirectURL: redirectUrl || undefined,
        email: input.email || undefined,
      },
    }),
  })

  const payload = await response.json().catch(() => null) as { data?: { widgetUrl?: string } } | null
  const widgetUrl = payload?.data?.widgetUrl
  if (!response.ok || !widgetUrl) {
    throw new Error('Unable to create Transak widget session.')
  }

  return {
    provider: 'transak' as const,
    pair,
    widgetUrl,
  }
}
