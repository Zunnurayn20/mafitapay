import { execFile } from 'node:child_process'
import https from 'node:https'
import { promisify } from 'node:util'
import { computeBuyRate, computeSellRate, getDefaultCryptoMarketSourceId } from '@/lib/crypto-market'
import type { CryptoAsset } from '@/types'

const COINGECKO_API_BASE_URL = process.env.COINGECKO_BASE_URL?.trim() || 'https://api.coingecko.com/api/v3'
const COINGECKO_SIMPLE_PRICE_URL = `${COINGECKO_API_BASE_URL.replace(/\/+$/, '')}/simple/price`

const COINGECKO_MIN_INTERVAL_MS = 4_000
const USD_PRICE_FRESH_TTL_MS = 30_000
const USD_NGN_FRESH_TTL_MS = 300_000
const HEALTH_PROBE_COOLDOWN_MS = 300_000
const LIVE_PRICE_CACHE_TTL_MS = USD_NGN_FRESH_TTL_MS
const UPSTREAM_FETCH_TIMEOUT_MS = 12_000
const UPSTREAM_RETRY_DELAYS_MS = [1_250]

const SAFE_FALLBACK_NON_STABLE_USD = 0.25
const SAFE_FALLBACK_STABLE_USD = 1
const SAFE_FX_FALLBACK_NGN = 1500
const execFileAsync = promisify(execFile)
const CRYPTO_MARKET_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_CRYPTO_MARKET === '1'

type CoinGeckoSimplePriceResponse = Record<string, {
  ngn?: number
  usd?: number
  usd_24h_change?: number
}>

type PriceSource = 'coingecko' | 'backup' | 'safe'

type UsdPriceEntry = {
  priceUsd: number
  source: PriceSource
  change24h: number
}

type MarketState = {
  freshUsdByAsset: Record<string, { priceUsd: number; expiresAt: number; change24h: number }>
  backupUsdByAsset: Record<string, { priceUsd: number; change24h: number }>
  freshFx?: { rate: number; expiresAt: number }
  backupFx?: number
  lastCoinGeckoCallTs: number
  lastError?: string
  lastProvider?: 'CoinGecko' | 'Fallback'
  lastUpdatedAt?: number
  lastCheckedAt?: number
  queue?: Promise<void>
}

interface CryptoMarketHydrationOptions {
  liveOnly?: boolean
}

function logCryptoMarket(event: string, details?: Record<string, unknown>) {
  if (!CRYPTO_MARKET_LOGGING_ENABLED) return
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[crypto-market] ${event}${payload}`)
}

function getMarketState() {
  const globalState = globalThis as typeof globalThis & {
    __mafitapayCryptoMarketState?: MarketState
  }

  if (!globalState.__mafitapayCryptoMarketState) {
    globalState.__mafitapayCryptoMarketState = {
      freshUsdByAsset: {},
      backupUsdByAsset: {},
      lastCoinGeckoCallTs: 0,
    }
  }

  return globalState.__mafitapayCryptoMarketState
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function isCryptoMarketSnapshotFresh(updatedAt?: string | null) {
  if (!updatedAt) return false
  const timestamp = new Date(updatedAt).getTime()
  if (!Number.isFinite(timestamp)) return false
  return Date.now() - timestamp <= LIVE_PRICE_CACHE_TTL_MS
}

async function fetchJsonOverHttps<T>(input: string, headers?: Record<string, string>) {
  const url = new URL(input)

  return await new Promise<T>((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        'user-agent': 'mafitapay/0.1.0',
        ...headers,
      },
    }, response => {
      const statusCode = response.statusCode ?? 0
      let body = ''

      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        if (statusCode < 200 || statusCode >= 300) {
          const error = new Error(`Request failed with status ${statusCode}.`)
          ;(error as Error & { statusCode?: number; responseBody?: string }).statusCode = statusCode
          ;(error as Error & { statusCode?: number; responseBody?: string }).responseBody = body
          reject(error)
          return
        }

        try {
          resolve(JSON.parse(body) as T)
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Invalid JSON response.'))
        }
      })
    })

    request.setTimeout(UPSTREAM_FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error('Request timed out.'))
    })
    request.on('error', reject)
    request.end()
  })
}

async function fetchJsonViaCurl<T>(input: string, headers?: Record<string, string>) {
  const args = ['-sS', '--max-time', String(Math.ceil(UPSTREAM_FETCH_TIMEOUT_MS / 1000)), input]

  for (const [key, value] of Object.entries({
    'user-agent': 'mafitapay/0.1.0',
    ...headers,
  })) {
    args.push('-H', `${key}: ${value}`)
  }

  const { stdout } = await execFileAsync('curl', args)
  return JSON.parse(stdout) as T
}

async function fetchJsonWithRetry<T>(input: string, headers?: Record<string, string>) {
  let lastError: unknown

  for (let attempt = 0; attempt <= UPSTREAM_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchJsonOverHttps<T>(input, headers)
    } catch (error) {
      lastError = error
      if (attempt < UPSTREAM_RETRY_DELAYS_MS.length) {
        await sleep(UPSTREAM_RETRY_DELAYS_MS[attempt])
        continue
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Upstream request failed.')
}

function getCoinGeckoHeaders() {
  const apiKey = process.env.COINGECKO_API_KEY?.trim()
  const headers: Record<string, string> = {
    accept: 'application/json',
  }
  if (!apiKey) return headers

  if (COINGECKO_API_BASE_URL.includes('pro-api.coingecko.com')) {
    headers['x-cg-pro-api-key'] = apiKey
  } else {
    headers['x-cg-demo-api-key'] = apiKey
  }

  return headers
}

function isPublicCoinGeckoUrl() {
  return !COINGECKO_API_BASE_URL.includes('pro-api.coingecko.com')
}

async function withCoinGeckoRateLimit<T>(operation: () => Promise<T>) {
  const state = getMarketState()
  const previous = state.queue ?? Promise.resolve()
  let release!: () => void
  state.queue = new Promise<void>(resolve => {
    release = resolve
  })

  await previous
  try {
    const elapsed = Date.now() - state.lastCoinGeckoCallTs
    if (elapsed < COINGECKO_MIN_INTERVAL_MS) {
      await sleep(COINGECKO_MIN_INTERVAL_MS - elapsed)
    }
    const result = await operation()
    state.lastCoinGeckoCallTs = Date.now()
    return result
  } finally {
    release()
  }
}

async function fetchCoinGeckoSimplePrice(ids: string[], currency: 'usd' | 'ngn') {
  if (ids.length === 0) return {} as CoinGeckoSimplePriceResponse

  return await withCoinGeckoRateLimit(async () => {
    const uniqueIds = [...new Set(ids)]
    const params = new URLSearchParams({
      ids: uniqueIds.join(','),
      vs_currencies: currency,
    })
    if (currency === 'usd') {
      params.set('include_24hr_change', 'true')
    }

    logCryptoMarket('coingecko.request', { currency, ids: uniqueIds })
    const url = `${COINGECKO_SIMPLE_PRICE_URL}?${params.toString()}`

    try {
      const response = await fetchJsonWithRetry<CoinGeckoSimplePriceResponse>(
        url,
        getCoinGeckoHeaders(),
      )
      logCryptoMarket('coingecko.success', { currency, ids: uniqueIds, auth: 'configured' })
      return response
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number }).statusCode
      const hasConfiguredKey = Boolean(process.env.COINGECKO_API_KEY?.trim())

      if (statusCode === 401 && hasConfiguredKey && isPublicCoinGeckoUrl()) {
        logCryptoMarket('coingecko.retry_unauthenticated', { currency, ids: uniqueIds })
        const response = await fetchJsonWithRetry<CoinGeckoSimplePriceResponse>(url, { accept: 'application/json' })
        logCryptoMarket('coingecko.success', { currency, ids: uniqueIds, auth: 'none' })
        return response
      }

      logCryptoMarket('coingecko.retry_curl', {
        currency,
        ids: uniqueIds,
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: statusCode ?? null,
      })
      const response = await fetchJsonViaCurl<CoinGeckoSimplePriceResponse>(url, getCoinGeckoHeaders())
      logCryptoMarket('coingecko.success', { currency, ids: uniqueIds, transport: 'curl' })
      return response
    }
  })
}

function getSafeFallbackUsd(assetId: string) {
  const stableIds = new Set(['tether', 'usdt', 'usd-coin', 'usdc'])
  return stableIds.has(assetId.toLowerCase()) ? SAFE_FALLBACK_STABLE_USD : SAFE_FALLBACK_NON_STABLE_USD
}


function seedBackupUsdFromAssets(assets: CryptoAsset[]) {
  const state = getMarketState()

  for (const asset of assets) {
    const assetId = asset.marketSourceId || getDefaultCryptoMarketSourceId(asset.symbol)
    if (!assetId || state.backupUsdByAsset[assetId]?.priceUsd) continue
    if (asset.marketSnapshotSource !== 'live' && asset.marketSnapshotSource !== 'backup') continue

    const marketPriceUsd = Number(asset.marketPriceUsd)
    if (Number.isFinite(marketPriceUsd) && marketPriceUsd > 0) {
      state.backupUsdByAsset[assetId] = {
        priceUsd: marketPriceUsd,
        change24h: Number.isFinite(asset.change24h) ? asset.change24h : 0,
      }
    }
  }
}

async function getCryptoPricesInUsd(assets: CryptoAsset[], options?: CryptoMarketHydrationOptions) {
  const state = getMarketState()
  const now = Date.now()
  const prices: Record<string, UsdPriceEntry> = {}
  const toFetch: Array<{ asset: CryptoAsset; assetId: string }> = []

  seedBackupUsdFromAssets(assets)

  for (const asset of assets) {
    const assetId = asset.marketSourceId || getDefaultCryptoMarketSourceId(asset.symbol)
    if (!assetId) continue

    const fresh = state.freshUsdByAsset[assetId]
    if (fresh && fresh.expiresAt > now && fresh.priceUsd > 0) {
      prices[assetId] = {
        priceUsd: fresh.priceUsd,
        source: 'coingecko',
        change24h: fresh.change24h,
      }
      continue
    }

    toFetch.push({ asset, assetId })
  }

  if (toFetch.length === 0) return prices
  logCryptoMarket('usd.refresh.start', {
    liveOnly: options?.liveOnly === true,
    assetIds: toFetch.map(item => item.assetId),
  })

  try {
    const coinGeckoResponse = await fetchCoinGeckoSimplePrice(
      toFetch.map(item => item.assetId),
      'usd',
    )

    for (const { assetId } of toFetch) {
      const rawPrice = coinGeckoResponse[assetId]?.usd
      const rawChange24h = coinGeckoResponse[assetId]?.usd_24h_change
      if (typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0) {
        const change24h = typeof rawChange24h === 'number' && Number.isFinite(rawChange24h) ? rawChange24h : 0
        prices[assetId] = {
          priceUsd: rawPrice,
          source: 'coingecko',
          change24h,
        }
        state.freshUsdByAsset[assetId] = {
          priceUsd: rawPrice,
          expiresAt: now + USD_PRICE_FRESH_TTL_MS,
          change24h,
        }
        state.backupUsdByAsset[assetId] = {
          priceUsd: rawPrice,
          change24h,
        }
        continue
      }
      const backup = state.backupUsdByAsset[assetId]

      if (!options?.liveOnly && backup?.priceUsd) {
        prices[assetId] = {
          priceUsd: backup.priceUsd,
          source: 'backup',
          change24h: backup.change24h,
        }
      } else {
        prices[assetId] = {
          priceUsd: 0,
          source: 'safe',
          change24h: 0,
        }
      }
    }

    state.lastProvider = 'CoinGecko'
    state.lastError = undefined
    state.lastUpdatedAt = Date.now()
    state.lastCheckedAt = Date.now()
    logCryptoMarket('usd.refresh.complete', {
      liveOnly: options?.liveOnly === true,
      provider: 'CoinGecko',
      sources: Object.fromEntries(Object.entries(prices).map(([assetId, entry]) => [assetId, entry.source])),
    })
    return prices
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CoinGecko USD fetch failed.'
    state.lastError = message
    state.lastCheckedAt = Date.now()
    logCryptoMarket('coingecko.error', { message, liveOnly: options?.liveOnly === true })

    for (const { assetId } of toFetch) {
      const backup = state.backupUsdByAsset[assetId]

      if (!options?.liveOnly && backup?.priceUsd) {
        prices[assetId] = {
          priceUsd: backup.priceUsd,
          source: 'backup',
          change24h: backup.change24h,
        }
        state.lastProvider = 'Fallback'
      } else {
        prices[assetId] = {
          priceUsd: 0,
          source: 'safe',
          change24h: 0,
        }
        state.lastProvider = 'Fallback'
      }
    }

    logCryptoMarket('usd.refresh.complete', {
      liveOnly: options?.liveOnly === true,
      provider: state.lastProvider || 'Fallback',
      sources: Object.fromEntries(Object.entries(prices).map(([assetId, entry]) => [assetId, entry.source])),
    })
    return prices
  }
}

async function getUsdNgnRateRaw(assets: CryptoAsset[], options?: CryptoMarketHydrationOptions) {
  const state = getMarketState()
  const now = Date.now()

  if (state.freshFx && state.freshFx.expiresAt > now && state.freshFx.rate > 0) {
    return { rate: state.freshFx.rate, source: 'coingecko' as PriceSource }
  }

  try {
    const response = await fetchCoinGeckoSimplePrice(['tether'], 'ngn')
    const rawRate = Number(response.tether?.ngn)
    if (!Number.isFinite(rawRate) || rawRate <= 0) {
      throw new Error('CoinGecko returned invalid USD/NGN rate.')
    }

    state.freshFx = {
      rate: rawRate,
      expiresAt: now + USD_NGN_FRESH_TTL_MS,
    }
    state.backupFx = rawRate
    state.lastProvider = 'CoinGecko'
    state.lastError = undefined
    state.lastUpdatedAt = Date.now()
    state.lastCheckedAt = Date.now()
    logCryptoMarket('fx.success', { source: 'coingecko', rate: rawRate, liveOnly: options?.liveOnly === true })

    return { rate: rawRate, source: 'coingecko' as PriceSource }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CoinGecko USD/NGN fetch failed.'
    state.lastError = message
    state.lastCheckedAt = Date.now()
    logCryptoMarket('fx.error', { message, liveOnly: options?.liveOnly === true })

    if (!options?.liveOnly && state.backupFx && state.backupFx > 0) {
      state.lastProvider = 'Fallback'
      logCryptoMarket('fx.fallback', { source: 'backupFx', rate: state.backupFx })
      return { rate: state.backupFx, source: 'backup' as PriceSource }
    }

    const stableReference = !options?.liveOnly ? assets.find(asset =>
      (asset.symbol === 'USDT' || asset.symbol === 'USDC') && Number.isFinite(asset.marketRate) && asset.marketRate > 0
    ) : undefined
    if (stableReference?.marketRate && stableReference.marketRate > 0) {
      state.lastProvider = 'Fallback'
      logCryptoMarket('fx.fallback', { source: 'stableReference', rate: stableReference.marketRate })
      return { rate: stableReference.marketRate, source: 'backup' as PriceSource }
    }

    state.lastProvider = 'Fallback'
    logCryptoMarket('fx.fallback', { source: options?.liveOnly ? 'none' : 'safe', rate: options?.liveOnly ? 0 : SAFE_FX_FALLBACK_NGN })
    return { rate: options?.liveOnly ? 0 : SAFE_FX_FALLBACK_NGN, source: 'safe' as PriceSource }
  }
}

export async function hydrateCryptoAssetPricing<T extends CryptoAsset>(assets: T[], options?: CryptoMarketHydrationOptions): Promise<T[]> {
  logCryptoMarket('hydrate.start', {
    liveOnly: options?.liveOnly === true,
    assetIds: assets.map(asset => asset.id),
  })
  const usdPrices = await getCryptoPricesInUsd(assets, options)
  const usdNgn = await getUsdNgnRateRaw(assets, options)
  const state = getMarketState()

  const hydrated = assets.map(asset => {
    const assetId = asset.marketSourceId || getDefaultCryptoMarketSourceId(asset.symbol)
    const usdEntry = assetId ? usdPrices[assetId] : undefined
    const marketPriceUsd = options?.liveOnly
      ? (usdEntry && usdEntry.source !== 'safe' && usdEntry.priceUsd > 0 ? usdEntry.priceUsd : undefined)
      : usdEntry?.priceUsd || asset.marketPriceUsd || getSafeFallbackUsd(assetId || asset.symbol)
    const derivedMarketRate = marketPriceUsd && usdNgn.rate > 0 ? marketPriceUsd * usdNgn.rate : 0
    const useDerivedRate = Boolean(usdEntry && usdEntry.source !== 'safe' && marketPriceUsd && usdNgn.rate > 0)
    const marketRate = useDerivedRate && Number.isFinite(derivedMarketRate) && derivedMarketRate > 0
      ? derivedMarketRate
      : options?.liveOnly ? 0 : asset.marketRate
    const pricingSource =
      usdEntry?.source === 'coingecko'
        ? 'live'
        : usdEntry?.source === 'backup'
          ? 'backup'
          : 'safe'
    const marketSnapshotSource =
      usdEntry?.source === 'coingecko'
        ? 'live'
        : usdEntry?.source === 'backup'
          ? 'backup'
          : 'safe'
    const marketPriceUpdatedAt =
      pricingSource === 'live'
        ? (state.lastUpdatedAt ? new Date(state.lastUpdatedAt).toISOString() : asset.marketPriceUpdatedAt)
        : pricingSource === 'backup'
          ? (asset.marketPriceUpdatedAt ?? (state.lastUpdatedAt ? new Date(state.lastUpdatedAt).toISOString() : undefined))
          : options?.liveOnly ? undefined : asset.marketPriceUpdatedAt

    return {
      ...asset,
      marketSourceId: assetId,
      marketSnapshotSource,
      pricingSource,
      marketPriceUsd,
      marketPriceUpdatedAt,
      marketRate,
      change24h: usdEntry?.change24h ?? (options?.liveOnly ? 0 : asset.change24h),
      buyRate: marketRate > 0 ? computeBuyRate(marketRate, asset.buySpreadBps) : 0,
      sellRate: marketRate > 0 ? computeSellRate(marketRate, asset.sellSpreadBps) : 0,
    }
  })

  logCryptoMarket('hydrate.complete', {
    liveOnly: options?.liveOnly === true,
    assets: hydrated.map(asset => ({
      id: asset.id,
      pricingSource: asset.pricingSource,
      marketPriceUsd: asset.marketPriceUsd ?? null,
      marketRate: asset.marketRate,
      updatedAt: asset.marketPriceUpdatedAt ?? null,
    })),
    fxSource: usdNgn.source,
  })

  return hydrated
}

export async function getCryptoMarketHealth() {
  const state = getMarketState()
  const sampleIds = ['ethereum', 'usd-coin', 'tether']
  const trackedAssets = [
    { id: 'tether', label: 'USDT' },
    { id: 'usd-coin', label: 'USDC' },
    { id: 'ethereum', label: 'ETH' },
    { id: 'solana', label: 'SOL' },
    { id: 'binancecoin', label: 'BNB' },
  ] as const
  const authMode = COINGECKO_API_BASE_URL.includes('pro-api.coingecko.com') ? 'pro' : 'demo'
  const cacheAgeMs = state.lastUpdatedAt ? Math.max(0, Date.now() - state.lastUpdatedAt) : null
  const recentlyChecked = Boolean(state.lastCheckedAt && (Date.now() - state.lastCheckedAt) < HEALTH_PROBE_COOLDOWN_MS)
  const hasBackups = Object.keys(state.backupUsdByAsset).length > 0 || Boolean(state.backupFx)

  const perAssetStatus = trackedAssets.map(asset => {
    const fresh = state.freshUsdByAsset[asset.id]
    const backup = state.backupUsdByAsset[asset.id]
    if (fresh && fresh.expiresAt > Date.now() && fresh.priceUsd > 0) {
      return { id: asset.id, label: asset.label, status: 'live' as const, priceUsd: fresh.priceUsd, updatedAt: state.lastUpdatedAt ? new Date(state.lastUpdatedAt).toISOString() : null }
    }
    if (backup?.priceUsd) {
      return { id: asset.id, label: asset.label, status: 'backup' as const, priceUsd: backup.priceUsd, updatedAt: state.lastUpdatedAt ? new Date(state.lastUpdatedAt).toISOString() : null }
    }
    return { id: asset.id, label: asset.label, status: 'safe' as const, priceUsd: 0, updatedAt: null }
  })

  if (cacheAgeMs != null && cacheAgeMs <= LIVE_PRICE_CACHE_TTL_MS && state.lastProvider && !state.lastError) {
    return {
      ready: true,
      liveReachable: true,
      provider: state.lastProvider,
      baseUrl: COINGECKO_API_BASE_URL,
      authMode,
      cacheTtlMs: LIVE_PRICE_CACHE_TTL_MS,
      cacheAgeMs,
      sampleIds,
      perAssetStatus,
      cachedAssets: Object.keys(state.backupUsdByAsset),
      status: 'live' as const,
      criticalChecks: [
        {
          key: 'live_fetch',
          label: 'Live Price Fetch',
          ready: true,
          detail: `Serving fresh market pricing through ${state.lastProvider}.`,
        },
      ],
      warnings: [],
      lastError: null,
    }
  }

  if (recentlyChecked && state.lastError) {
    return {
      ready: hasBackups,
      liveReachable: false,
      provider: state.lastProvider || 'Fallback',
      baseUrl: COINGECKO_API_BASE_URL,
      authMode,
      cacheTtlMs: LIVE_PRICE_CACHE_TTL_MS,
      cacheAgeMs,
      sampleIds,
      perAssetStatus,
      cachedAssets: Object.keys(state.backupUsdByAsset),
      status: hasBackups ? 'fallback' as const : 'down' as const,
      criticalChecks: [
        {
          key: 'live_fetch',
          label: 'Live Price Fetch',
          ready: hasBackups,
          detail: `Using probe cooldown after recent upstream failure: ${state.lastError}`,
        },
      ],
      warnings: hasBackups
        ? ['Serving backup or safe fallback market values while waiting before the next upstream probe.']
        : ['Live market probe is cooling down after a recent upstream failure.'],
      lastError: state.lastError,
    }
  }

  try {
    const seededAssets: CryptoAsset[] = sampleIds.map(id => ({
      id: id === 'ethereum' ? 'ETH_BASE' : id === 'usd-coin' ? 'USDC_BASE' : 'USDT_BSC',
      symbol: id === 'ethereum' ? 'ETH' : id === 'usd-coin' ? 'USDC' : 'USDT',
      name: id === 'ethereum' ? 'Ethereum' : id === 'usd-coin' ? 'USD Coin' : 'Tether USD',
      network: id === 'ethereum' ? 'Base' : id === 'usd-coin' ? 'Base' : 'BSC',
      icon: '',
      marketSourceId: id,
      marketPriceUsd: 0,
      marketRate: id === 'ethereum' ? 2500000 : 1400,
      buyRate: 0,
      sellRate: 0,
      buySpreadBps: 0,
      sellSpreadBps: 0,
      quoteTtlSeconds: 90,
      change24h: 0,
    }))

    const usdPrices = await getCryptoPricesInUsd(seededAssets)
    const fx = await getUsdNgnRateRaw(seededAssets)
    const liveReady = sampleIds.every(id => {
      const entry = usdPrices[id]
      return entry && entry.source === 'coingecko'
    })
    const activeProvider = 'CoinGecko'

    return {
      ready: liveReady,
      liveReachable: liveReady,
      provider: activeProvider,
      baseUrl: COINGECKO_API_BASE_URL,
      authMode,
      cacheTtlMs: LIVE_PRICE_CACHE_TTL_MS,
      cacheAgeMs: state.lastUpdatedAt ? Math.max(0, Date.now() - state.lastUpdatedAt) : null,
      sampleIds,
      perAssetStatus,
      cachedAssets: Object.keys(state.backupUsdByAsset),
      status: liveReady ? 'live' as const : 'fallback' as const,
      criticalChecks: [
        {
          key: 'live_fetch',
          label: 'Live Price Fetch',
          ready: liveReady,
          detail: liveReady
            ? `Live market pricing is active via ${activeProvider}. USD/NGN source: ${fx.source}.`
            : 'Some sample assets are still using backup or safe fallback pricing.',
        },
      ],
      warnings: liveReady ? [] : ['At least one asset is using backup or safe fallback pricing instead of a current external quote.'],
      lastError: state.lastError ?? null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live market fetch failed.'
    state.lastError = message
    state.lastCheckedAt = Date.now()
    return {
      ready: hasBackups,
      liveReachable: false,
      provider: state.lastProvider || 'Fallback',
      baseUrl: COINGECKO_API_BASE_URL,
      authMode,
      cacheTtlMs: LIVE_PRICE_CACHE_TTL_MS,
      cacheAgeMs,
      sampleIds,
      perAssetStatus,
      cachedAssets: Object.keys(state.backupUsdByAsset),
      status: hasBackups ? 'fallback' as const : 'down' as const,
      criticalChecks: [
        {
          key: 'live_fetch',
          label: 'Live Price Fetch',
          ready: false,
          detail: message,
        },
      ],
      warnings: ['The app is serving backup or safe fallback market values until live connectivity is restored.'],
      lastError: message,
    }
  }
}
