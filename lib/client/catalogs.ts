'use client'
import { useEffect, useState } from 'react'
import { BILL_PROVIDERS, CRYPTO_ASSETS, NETWORK_PROVIDERS, NGX_MARKET_SUMMARY, NGX_STOCKS } from '@/lib/constants'
import { enrichStockQuote } from '@/lib/stock-filters'
import type { BankDirectoryEntry, BillProvider, CryptoAsset, NetworkProvider, StockQuote, StocksMarketSource, StocksMarketSummary } from '@/types'

const CRYPTO_ASSETS_CACHE_KEY = 'mafitapay.cryptoAssets'
const CRYPTO_ASSETS_CLIENT_REFRESH_TTL_MS = 45 * 1000
let cryptoAssetsSnapshot: CryptoAsset[] = []
let cryptoAssetsFetchPromise: Promise<void> | null = null
let cryptoAssetsLastFetchedAt = 0
const cryptoAssetListeners = new Set<(assets: CryptoAsset[]) => void>()
let cryptoAssetsRefreshing = false
const cryptoAssetRefreshListeners = new Set<(refreshing: boolean) => void>()

let billProvidersSnapshot: BillProvider[] = BILL_PROVIDERS
let networkProvidersSnapshot: NetworkProvider[] = NETWORK_PROVIDERS
let billCatalogFetchPromise: Promise<void> | null = null
let lastForcedBillCatalogRefreshAt = 0
const billProviderListeners = new Set<(providers: BillProvider[]) => void>()
const networkProviderListeners = new Set<(providers: NetworkProvider[]) => void>()
const BILL_CATALOG_FORCE_REFRESH_DEBOUNCE_MS = 60 * 1000
const BILL_PROVIDER_DISPLAY_ORDER = ['airtime', 'data', 'cable', 'electric', 'education', 'gas', 'insurance', 'water'] as const
let stocksSnapshot: StockQuote[] = NGX_STOCKS.map(enrichStockQuote)
let stocksSummarySnapshot: StocksMarketSummary = NGX_MARKET_SUMMARY
let stocksSourceSnapshot: StocksMarketSource = 'seed'
let stocksFetchPromise: Promise<void> | null = null
let stocksLastFetchedAt = 0
const STOCKS_CLIENT_REFRESH_TTL_MS = 20 * 60 * 1000
const stocksListeners = new Set<(stocks: StockQuote[]) => void>()
const stocksSummaryListeners = new Set<(summary: StocksMarketSummary) => void>()
const stocksSourceListeners = new Set<(source: StocksMarketSource) => void>()
const bankDirectorySnapshot = new Map<string, BankDirectoryEntry[]>()
const bankDirectoryInflight = new Map<string, Promise<void>>()
const bankDirectoryListeners = new Map<string, Set<(banks: BankDirectoryEntry[]) => void>>()

const LEGACY_CRYPTO_ICON_REPLACEMENTS: Record<string, string> = {
  // Token logos: keep eth.png as the main ETH mark (list + detail). Base chain logo is base.png.
  '/crypto-assets/eth-base.png': '/crypto-assets/eth.png',
  '/crypto-assets/ton.svg': '/crypto-assets/ton.png',
  '/crypto-assets/sui.svg': '/crypto-assets/sui.png',
  '/crypto-assets/near.svg': '/crypto-assets/near.png',
  // Admin uploads that were byte-identical to the named chain marks, kept so a cached
  // catalog still holding the uploaded path resolves after the duplicates were removed.
  '/crypto-assets/eth-d9a54208.png': '/crypto-assets/eth-arb.png',
  '/crypto-assets/eth-5cfef420.png': '/crypto-assets/eth-op.png',
}

function sortBillProviders(providers: BillProvider[]) {
  return [...providers].sort((a, b) => {
    const left = BILL_PROVIDER_DISPLAY_ORDER.indexOf(a.id as (typeof BILL_PROVIDER_DISPLAY_ORDER)[number])
    const right = BILL_PROVIDER_DISPLAY_ORDER.indexOf(b.id as (typeof BILL_PROVIDER_DISPLAY_ORDER)[number])
    const leftIndex = left === -1 ? BILL_PROVIDER_DISPLAY_ORDER.length : left
    const rightIndex = right === -1 ? BILL_PROVIDER_DISPLAY_ORDER.length : right
    return leftIndex - rightIndex
  })
}

// Pair visibility is owned by crypto_pairs.is_active, which getCryptoAssets already filters on, so
// the admin's archive toggle is the single source of truth. A hardcoded hide list used to live here
// too and held USDC_SOLANA back even though the server had the pair active and executable.
function normalizeCryptoAssets(assets: CryptoAsset[]) {
  return assets.map(asset => ({
    ...asset,
    icon: LEGACY_CRYPTO_ICON_REPLACEMENTS[asset.icon] ?? asset.icon,
  }))
}

function readCachedCryptoAssets() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(CRYPTO_ASSETS_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeCryptoAssets(parsed as CryptoAsset[]) : []
  } catch {
    return []
  }
}

function writeCachedCryptoAssets(assets: CryptoAsset[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CRYPTO_ASSETS_CACHE_KEY, JSON.stringify(assets))
  } catch {
    // Ignore storage write failures and keep the in-memory snapshot.
  }
}

function emitCryptoAssets(nextAssets: CryptoAsset[]) {
  const previousById = new Map(cryptoAssetsSnapshot.map(asset => [asset.id, asset]))
  const withMovement = nextAssets.map(asset => {
    const previous = previousById.get(asset.id)
    const currentPrice = asset.marketPriceUsd
    const previousPrice = previous?.marketPriceUsd

    let refreshDirection: CryptoAsset['refreshDirection'] = 'flat'
    if (
      Number.isFinite(currentPrice) &&
      Number.isFinite(previousPrice) &&
      currentPrice != null &&
      previousPrice != null
    ) {
      if (currentPrice > previousPrice) refreshDirection = 'up'
      else if (currentPrice < previousPrice) refreshDirection = 'down'
    }

    return {
      ...asset,
      refreshDirection,
    }
  })

  cryptoAssetsSnapshot = withMovement
  cryptoAssetsLastFetchedAt = Date.now()
  writeCachedCryptoAssets(withMovement)
  for (const listener of cryptoAssetListeners) {
    listener(withMovement)
  }
}

function emitCryptoAssetsRefreshing(nextRefreshing: boolean) {
  cryptoAssetsRefreshing = nextRefreshing
  for (const listener of cryptoAssetRefreshListeners) {
    listener(nextRefreshing)
  }
}

function emitBillCatalog(nextProviders: BillProvider[], nextNetworkProviders: NetworkProvider[]) {
  billProvidersSnapshot = sortBillProviders(nextProviders)
  networkProvidersSnapshot = nextNetworkProviders

  for (const listener of billProviderListeners) {
    listener(billProvidersSnapshot)
  }

  for (const listener of networkProviderListeners) {
    listener(nextNetworkProviders)
  }
}

function emitStocks(
  nextStocks: StockQuote[],
  nextSummary = stocksSummarySnapshot,
  nextSource: StocksMarketSource = stocksSourceSnapshot,
) {
  const enrichedStocks = nextStocks.map(enrichStockQuote)
  stocksSnapshot = enrichedStocks
  stocksSummarySnapshot = nextSummary
  stocksSourceSnapshot = nextSource
  stocksLastFetchedAt = Date.now()
  for (const listener of stocksListeners) {
    listener(enrichedStocks)
  }
  for (const listener of stocksSummaryListeners) {
    listener(nextSummary)
  }
  for (const listener of stocksSourceListeners) {
    listener(nextSource)
  }
}

function emitBankDirectory(country: string, nextBanks: BankDirectoryEntry[]) {
  bankDirectorySnapshot.set(country, nextBanks)
  const listeners = bankDirectoryListeners.get(country)
  if (!listeners) return
  for (const listener of listeners) {
    listener(nextBanks)
  }
}

async function loadBillCatalog(options?: { force?: boolean }) {
  if (billCatalogFetchPromise) return billCatalogFetchPromise

  const wantsForceRefresh = options?.force === true
  const shouldForceRefresh = wantsForceRefresh && (Date.now() - lastForcedBillCatalogRefreshAt > BILL_CATALOG_FORCE_REFRESH_DEBOUNCE_MS)
  if (shouldForceRefresh) {
    lastForcedBillCatalogRefreshAt = Date.now()
  }

  const search = shouldForceRefresh ? '?refresh=1' : ''
  billCatalogFetchPromise = fetch(`/api/bills${search}`, { credentials: 'include', cache: 'no-store' })
    .then(async response => {
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Failed to load bill catalog.')
      }

      const nextProviders = Array.isArray(payload.data?.providers)
        ? payload.data.providers as BillProvider[]
        : billProvidersSnapshot
      const nextNetworkProviders = Array.isArray(payload.data?.networkProviders) && payload.data.networkProviders.length > 0
        ? payload.data.networkProviders as NetworkProvider[]
        : networkProvidersSnapshot

      emitBillCatalog(nextProviders, nextNetworkProviders)
    })
    .catch(() => undefined)
    .finally(() => {
      billCatalogFetchPromise = null
    })

  return billCatalogFetchPromise
}

export async function refreshBillCatalog(options?: { force?: boolean }) {
  await loadBillCatalog({ force: options?.force === true })
  return {
    providers: billProvidersSnapshot,
    networkProviders: networkProvidersSnapshot,
  }
}

async function loadCryptoAssets(options?: { force?: boolean; liveOnly?: boolean }) {
  if (cryptoAssetsFetchPromise) return cryptoAssetsFetchPromise
  if (!options?.force && cryptoAssetsSnapshot.length > 0 && Date.now() - cryptoAssetsLastFetchedAt < CRYPTO_ASSETS_CLIENT_REFRESH_TTL_MS) {
    return
  }

  emitCryptoAssetsRefreshing(true)
  const params = new URLSearchParams()
  if (options?.force) params.set('refresh', '1')
  if (options?.liveOnly) params.set('strict', '1')
  const search = params.toString() ? `?${params.toString()}` : ''
  cryptoAssetsFetchPromise = fetch(`/api/crypto${search}`, { credentials: 'include', cache: 'no-store' })
    .then(async response => {
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Failed to load crypto assets.')
      }
      if (Array.isArray(payload.data)) {
        emitCryptoAssets(normalizeCryptoAssets(payload.data as CryptoAsset[]))
        return
      }
      throw new Error('Crypto asset payload was malformed.')
    })
    .catch(() => {
      if (cryptoAssetsSnapshot.length === 0) {
        const cachedAssets = readCachedCryptoAssets()
        if (cachedAssets.length > 0) {
          emitCryptoAssets(cachedAssets)
          return
        }
        emitCryptoAssets(normalizeCryptoAssets(CRYPTO_ASSETS))
      }
    })
    .finally(() => {
      cryptoAssetsFetchPromise = null
      emitCryptoAssetsRefreshing(false)
    })

  return cryptoAssetsFetchPromise
}

async function loadStocksMarket() {
  if (stocksFetchPromise) return stocksFetchPromise

  stocksFetchPromise = fetch('/api/stocks', { credentials: 'include', cache: 'no-store' })
    .then(async response => {
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Failed to load stocks market.')
      }
      const nextStocks = Array.isArray(payload.data?.stocks) ? payload.data.stocks as StockQuote[] : stocksSnapshot
      const nextSummary = payload.data?.summary ?? stocksSummarySnapshot
      const nextSource = payload.data?.source === 'live'
        || payload.data?.source === 'stale'
        || payload.data?.source === 'seed'
        ? payload.data.source
        : stocksSourceSnapshot
      emitStocks(nextStocks, nextSummary, nextSource)
    })
    .catch(() => undefined)
    .finally(() => {
      stocksFetchPromise = null
    })

  return stocksFetchPromise
}

async function loadBankDirectory(country: string) {
  const existing = bankDirectoryInflight.get(country)
  if (existing) return existing

  const request = fetch(`/api/banks?country=${encodeURIComponent(country)}`, { credentials: 'include', cache: 'no-store' })
    .then(async response => {
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Failed to load banks.')
      }
      if (Array.isArray(payload.data)) {
        emitBankDirectory(country, payload.data as BankDirectoryEntry[])
      }
    })
    .catch(() => undefined)
    .finally(() => {
      bankDirectoryInflight.delete(country)
    })

  bankDirectoryInflight.set(country, request)
  return request
}

export async function refreshCryptoAssets(input?: CryptoAsset[] | { force?: boolean; liveOnly?: boolean }) {
  if (Array.isArray(input)) {
    emitCryptoAssets(input)
    return input
  }

  const wantsStrictLiveRefresh = input?.force === true && input?.liveOnly === true
  if (wantsStrictLiveRefresh && cryptoAssetsFetchPromise) {
    await cryptoAssetsFetchPromise
  }

  await loadCryptoAssets({ force: input?.force === true, liveOnly: input?.liveOnly === true })
  return cryptoAssetsSnapshot
}

export function useCryptoAssets() {
  const [assets, setAssets] = useState<CryptoAsset[]>(() => {
    if (cryptoAssetsSnapshot.length > 0) return cryptoAssetsSnapshot
    const cachedAssets = readCachedCryptoAssets()
    if (cachedAssets.length > 0) {
      cryptoAssetsSnapshot = cachedAssets
      return cachedAssets
    }
    return []
  })

  useEffect(() => {
    cryptoAssetListeners.add(setAssets)
    if (cryptoAssetsSnapshot.length === 0) {
      const cachedAssets = readCachedCryptoAssets()
      if (cachedAssets.length > 0) {
        emitCryptoAssets(cachedAssets)
      }
    }
    return () => {
      cryptoAssetListeners.delete(setAssets)
    }
  }, [])

  return assets
}

export function useCryptoAssetsRefreshing() {
  const [refreshing, setRefreshing] = useState(cryptoAssetsRefreshing)

  useEffect(() => {
    cryptoAssetRefreshListeners.add(setRefreshing)
    return () => {
      cryptoAssetRefreshListeners.delete(setRefreshing)
    }
  }, [])

  return refreshing
}

export function useStocksMarket() {
  const [stocks, setStocks] = useState<StockQuote[]>(stocksSnapshot)
  const [summary, setSummary] = useState(stocksSummarySnapshot)
  const [source, setSource] = useState<StocksMarketSource>(stocksSourceSnapshot)

  useEffect(() => {
    stocksListeners.add(setStocks)
    stocksSummaryListeners.add(setSummary)
    stocksSourceListeners.add(setSource)

    void loadStocksMarket()

    const interval = window.setInterval(() => {
      if (Date.now() - stocksLastFetchedAt >= STOCKS_CLIENT_REFRESH_TTL_MS) {
        void loadStocksMarket()
      }
    }, 60_000)

    return () => {
      stocksListeners.delete(setStocks)
      stocksSummaryListeners.delete(setSummary)
      stocksSourceListeners.delete(setSource)
      window.clearInterval(interval)
    }
  }, [])

  return { stocks, summary, source }
}

export function useBillProviders() {
  const [providers, setProviders] = useState<BillProvider[]>(billProvidersSnapshot)

  useEffect(() => {
    billProviderListeners.add(setProviders)
    void loadBillCatalog()
    return () => {
      billProviderListeners.delete(setProviders)
    }
  }, [])

  return providers
}

export function useNetworkProviders() {
  const [providers, setProviders] = useState<NetworkProvider[]>(networkProvidersSnapshot)

  useEffect(() => {
    networkProviderListeners.add(setProviders)
    void loadBillCatalog()
    return () => {
      networkProviderListeners.delete(setProviders)
    }
  }, [])

  return providers
}

export function useBankDirectory(country = 'NG') {
  const [banks, setBanks] = useState<BankDirectoryEntry[]>(() => bankDirectorySnapshot.get(country) ?? [])

  useEffect(() => {
    const listeners = bankDirectoryListeners.get(country) ?? new Set<(banks: BankDirectoryEntry[]) => void>()
    listeners.add(setBanks)
    bankDirectoryListeners.set(country, listeners)
    if (bankDirectorySnapshot.has(country)) {
      setBanks(bankDirectorySnapshot.get(country) ?? [])
    }
    void loadBankDirectory(country)
    return () => {
      const current = bankDirectoryListeners.get(country)
      if (!current) return
      current.delete(setBanks)
      if (current.size === 0) {
        bankDirectoryListeners.delete(country)
      }
    }
  }, [country])

  return banks
}
