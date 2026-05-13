'use client'
import { useEffect, useState } from 'react'
import { BILL_PROVIDERS, CRYPTO_ASSETS, NETWORK_PROVIDERS, P2P_MERCHANTS } from '@/lib/constants'
import type { BankDirectoryEntry, BillProvider, CryptoAsset, NetworkProvider, P2PMerchant } from '@/types'

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
const HIDDEN_CRYPTO_PAIR_IDS = new Set<CryptoAsset['id']>(['USDC_SOLANA'])
let p2pMerchantsSnapshot: P2PMerchant[] = P2P_MERCHANTS
let p2pMerchantsFetchPromise: Promise<void> | null = null
const p2pMerchantListeners = new Set<(merchants: P2PMerchant[]) => void>()
const bankDirectorySnapshot = new Map<string, BankDirectoryEntry[]>()
const bankDirectoryInflight = new Map<string, Promise<void>>()
const bankDirectoryListeners = new Map<string, Set<(banks: BankDirectoryEntry[]) => void>>()

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

function emitP2PMerchants(nextMerchants: P2PMerchant[]) {
  p2pMerchantsSnapshot = nextMerchants
  for (const listener of p2pMerchantListeners) {
    listener(nextMerchants)
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

async function loadP2PMerchants() {
  if (p2pMerchantsFetchPromise) return p2pMerchantsFetchPromise

  p2pMerchantsFetchPromise = fetch('/api/p2p', { credentials: 'include', cache: 'no-store' })
    .then(async response => {
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Failed to load merchants.')
      }
      if (Array.isArray(payload.data) && payload.data.length > 0) {
        emitP2PMerchants(payload.data as P2PMerchant[])
      }
    })
    .catch(() => undefined)
    .finally(() => {
      p2pMerchantsFetchPromise = null
    })

  return p2pMerchantsFetchPromise
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

export function useP2PMerchants() {
  const [merchants, setMerchants] = useState<P2PMerchant[]>(p2pMerchantsSnapshot)

  useEffect(() => {
    p2pMerchantListeners.add(setMerchants)
    void loadP2PMerchants()
    return () => {
      p2pMerchantListeners.delete(setMerchants)
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
