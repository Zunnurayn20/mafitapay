'use client'
import { useEffect, useState } from 'react'
import { BILL_PROVIDERS, CRYPTO_ASSETS, NETWORK_PROVIDERS, P2P_MERCHANTS } from '@/lib/constants'
import type { BankDirectoryEntry, BillProvider, CryptoAsset, NetworkProvider, P2PMerchant } from '@/types'

const CRYPTO_ASSETS_CACHE_KEY = 'mafitapay.cryptoAssets'
let cryptoAssetsSnapshot: CryptoAsset[] = []
let cryptoAssetsFetchPromise: Promise<void> | null = null
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
const HIDDEN_CRYPTO_PAIR_IDS = new Set<CryptoAsset['id']>(['USDC_SOLANA'])

function sortBillProviders(providers: BillProvider[]) {
  return [...providers].sort((a, b) => {
    const left = BILL_PROVIDER_DISPLAY_ORDER.indexOf(a.id as (typeof BILL_PROVIDER_DISPLAY_ORDER)[number])
    const right = BILL_PROVIDER_DISPLAY_ORDER.indexOf(b.id as (typeof BILL_PROVIDER_DISPLAY_ORDER)[number])
    const leftIndex = left === -1 ? BILL_PROVIDER_DISPLAY_ORDER.length : left
    const rightIndex = right === -1 ? BILL_PROVIDER_DISPLAY_ORDER.length : right
    return leftIndex - rightIndex
  })
}

function filterVisibleCryptoAssets(assets: CryptoAsset[]) {
  return assets.filter(asset => !HIDDEN_CRYPTO_PAIR_IDS.has(asset.id))
}

function readCachedCryptoAssets() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(CRYPTO_ASSETS_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? filterVisibleCryptoAssets(parsed as CryptoAsset[]) : []
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
        emitCryptoAssets(filterVisibleCryptoAssets(payload.data as CryptoAsset[]))
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
        emitCryptoAssets(filterVisibleCryptoAssets(CRYPTO_ASSETS))
      }
    })
    .finally(() => {
      cryptoAssetsFetchPromise = null
      emitCryptoAssetsRefreshing(false)
    })

  return cryptoAssetsFetchPromise
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

export function useP2PMerchants() {
  const [merchants, setMerchants] = useState<P2PMerchant[]>(P2P_MERCHANTS)

  useEffect(() => {
    let active = true

    void fetch('/api/p2p', { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Failed to load merchants.')
        }
        if (active && Array.isArray(payload.data) && payload.data.length > 0) {
          setMerchants(payload.data as P2PMerchant[])
        }
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [])

  return merchants
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
  const [banks, setBanks] = useState<BankDirectoryEntry[]>([])

  useEffect(() => {
    let active = true

    void fetch(`/api/banks?country=${encodeURIComponent(country)}`, { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Failed to load banks.')
        }
        if (active && Array.isArray(payload.data)) {
          setBanks(payload.data as BankDirectoryEntry[])
        }
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [country])

  return banks
}
