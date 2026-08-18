'use client'

import { useEffect, useState } from 'react'
import { refreshCryptoAssets } from '@/lib/client/catalogs'
import { computeBuyRate, computeSellRate, DEFAULT_USD_MARGIN_NGN, getDefaultCryptoMarketSourceId } from '@/lib/crypto-market'
import { buildCryptoPairId } from '@/lib/routed-assets'
import { useAppStore } from '@/store'
import type { TokenLookupResult } from '@/lib/crypto-contract-lookup'
import type { AuditLog, BillProvider, CryptoAsset, CryptoDepositEvent, CryptoOrder, DepositIntent, LedgerEntry, PayoutRequest, ProviderDiagnosticsReport, ProviderEvent, RewardAwardRequest, RewardRule, RewardRuleReport, Transaction, User } from '@/types'
import {
  ADMIN_ENDPOINTS,
  BILL_ICON_SUGGESTIONS,
  BILL_PROVIDER_TYPES,
  CRYPTO_EXECUTION_RAIL_OPTIONS,
  CRYPTO_LOGO_SUGGESTIONS,
  CRYPTO_NETWORK_OPTIONS,
  REWARD_AUDIENCE_OPTIONS,
  REWARD_KIND_OPTIONS,
  REWARD_TRANSACTION_TYPE_OPTIONS,
  REWARD_TRIGGER_OPTIONS,
  ROUTED_ADDRESS_FAMILY_OPTIONS,
  ROUTED_PROFILE_OPTIONS,
  type AdminSection,
  type AdminSubmodule,
  type AdminKey,
  type BillCatalogFilter,
  type CryptoCatalogFilter,
  type ReferenceCase,
  findRoutedProfileForAsset,
  getRoutedProfileConfig,
  parseOptionalNumber,
  renderPriceFreshness,
  renderPricingSourceLabel,
} from './admin-config'

const ADMIN_FETCH_CACHE_TTL_MS = 15_000
const adminFetchSnapshotCache = new Map<string, { expiresAt: number; data: unknown }>()
const adminFetchInFlight = new Map<string, Promise<unknown>>()

/**
 * Field-by-field compare used to decide whether a catalog record still matches what the server last
 * confirmed. Primitives compare directly; array fields (a reward rule's transaction-type lists)
 * compare by contents, because a fresh array with identical entries is not an edit. Unlike comparing
 * JSON.stringify output this cannot report a false difference from key ordering alone.
 */
function isSameCatalogRecord(left: unknown, right: unknown) {
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>

  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const first = a[key]
    const second = b[key]

    if (Array.isArray(first) || Array.isArray(second)) {
      if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false
      if (first.some((entry, index) => entry !== second[index])) return false
      continue
    }
    if (first !== second) return false
  }
  return true
}

/** Ids present in the working copy that differ from — or are missing from — the saved baseline. */
function dirtyIdsBetween<T extends { id: string }>(working: T[], saved: T[]) {
  const savedById = new Map(saved.map(item => [item.id, item]))
  return working
    .filter(item => {
      const previous = savedById.get(item.id)
      return !previous || !isSameCatalogRecord(previous, item)
    })
    .map(item => item.id)
}

type AdminCriticalCheck = {
  key: string
  label: string
  ready: boolean
  detail: string
}

type BaseExecutorHealth = {
  criticalChecks: AdminCriticalCheck[]
  builderCode: string
  rpcUrl: string
  configuredAddress: string
  derivedAddress?: string
  contracts: {
    reserve: string
    usdc: string
    weth: string
  }
  warnings: string[]
}

type BaseTreasuryBalances = {
  walletAddress: string
  ethWei: string
  usdcUnits: string
}

type ZeroExHealth = {
  criticalChecks: AdminCriticalCheck[]
  baseUrl: string
  chainId: string | number
  warnings: string[]
}

type CryptoMarketAssetStatus = {
  id: string
  label: string
  status: 'live' | 'backup' | 'unavailable'
  priceUsd: number
  updatedAt?: string | null
}

type CryptoMarketHealth = {
  criticalChecks: AdminCriticalCheck[]
  provider: string
  baseUrl: string
  authMode: string
  status: 'live' | 'fallback' | 'error'
  cacheTtlMs: number
  cacheAgeMs?: number | null
  sampleIds: string[]
  cachedAssets: string[]
  lastError?: string | null
  perAssetStatus: CryptoMarketAssetStatus[]
  warnings: string[]
}

type FlutterwaveHealth = {
  criticalChecks: AdminCriticalCheck[]
  resolution: {
    resolutionEnabled: boolean
    secretKeyConfigured: boolean
    provider: string
    baseUrl: string
  }
  secureIdentity: {
    configured: boolean
    algorithm?: string
    keyVersion?: string
  }
  transfers: {
    payoutsEnabled: boolean
    webhooksEnabled: boolean
    clientIdConfigured: boolean
    clientSecretConfigured: boolean
    secretHashConfigured: boolean
    callbackUrlConfigured: boolean
    jobSecretConfigured: boolean
  }
  mode: {
    mixed: boolean
    resolutionOnly: boolean
    payoutsOnly: boolean
  }
  warnings: string[]
}

type FlutterwaveBillsHealth = {
  configured: boolean
  pendingCount: number
  recentSuccess: Array<{ transaction: Transaction }>
  providerFailures: DepositIntent[]
  pendingBills: Array<{ transaction: Transaction }>
  recentFailures: Array<{ transaction: Transaction }>
  rails: {
    dataPrimary: string
    amigoConfigured: boolean
    flutterwaveConfigured: boolean
  }
  recentAmigoData: unknown[]
  recentFlutterwaveBills: unknown[]
  recentProviderEvents: ProviderEvent[]
}

async function fetchAdminJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
  const payload = await response.json()
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error || 'Failed to load admin data.') as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return payload.data as T
}

async function fetchAdminJsonCached<T>(url: string, options?: { force?: boolean }): Promise<T> {
  const force = options?.force === true
  const now = Date.now()

  if (!force) {
    const cached = adminFetchSnapshotCache.get(url)
    if (cached && cached.expiresAt > now) {
      return cached.data as T
    }

    const pending = adminFetchInFlight.get(url)
    if (pending) {
      return pending as Promise<T>
    }
  }

  const request = fetchAdminJson<T>(url)
    .then(data => {
      adminFetchSnapshotCache.set(url, { expiresAt: Date.now() + ADMIN_FETCH_CACHE_TTL_MS, data })
      return data
    })
    .finally(() => {
      adminFetchInFlight.delete(url)
    })

  adminFetchInFlight.set(url, request)
  return request
}

function primeAdminFetchCache<T>(url: string, data: T) {
  adminFetchSnapshotCache.set(url, { expiresAt: Date.now() + ADMIN_FETCH_CACHE_TTL_MS, data })
  adminFetchInFlight.delete(url)
}

function invalidateAdminFetchCache(url: string) {
  adminFetchSnapshotCache.delete(url)
  adminFetchInFlight.delete(url)
}

export function useAdminWorkspace(section: AdminSection, submodule?: AdminSubmodule) {
  const { showToast, user } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(true)
  const [saving, setSaving] = useState<AdminKey | null>(null)
  const [savingCryptoPricing, setSavingCryptoPricing] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [providerEvents, setProviderEvents] = useState<ProviderEvent[]>([])
  const [depositIntents, setDepositIntents] = useState<DepositIntent[]>([])
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([])
  const [cryptoOrders, setCryptoOrders] = useState<CryptoOrder[]>([])
  const [cryptoPricing, setCryptoPricing] = useState<CryptoAsset[]>([])
  /**
   * What the server last confirmed. `cryptoPricing` is the working copy the editor mutates as the
   * operator types; the difference between the two is exactly the set of unsaved edits.
   */
  const [savedCryptoPricing, setSavedCryptoPricing] = useState<CryptoAsset[]>([])
  const [savingCryptoPairId, setSavingCryptoPairId] = useState<string | null>(null)
  const [cryptoDepositEvents, setCryptoDepositEvents] = useState<CryptoDepositEvent[]>([])
  const [recentSweepGasStats, setRecentSweepGasStats] = useState<any[]>([])
  const [cryptoDepositStatusFilter, setCryptoDepositStatusFilter] = useState<'all' | CryptoDepositEvent['status']>('all')
  const [cryptoDepositSweepFilter, setCryptoDepositSweepFilter] = useState<'all' | NonNullable<CryptoDepositEvent['sweepStatus']>>('all')
  const [cryptoDepositPairFilter, setCryptoDepositPairFilter] = useState<string>('')
  const [cryptoDepositSearch, setCryptoDepositSearch] = useState<string>('')
  const [refreshingCryptoDepositEvents, setRefreshingCryptoDepositEvents] = useState(false)
  const [cryptoCatalogFilter, setCryptoCatalogFilter] = useState<CryptoCatalogFilter>('all')
  const [billProviderCatalog, setBillProviderCatalog] = useState<BillProvider[]>([])
  const [rewardRules, setRewardRules] = useState<RewardRule[]>([])
  // Server-confirmed baselines, exactly as for crypto pairs: the gap between working copy and
  // baseline is the set of unsaved edits.
  const [savedBillProviderCatalog, setSavedBillProviderCatalog] = useState<BillProvider[]>([])
  const [savedRewardRules, setSavedRewardRules] = useState<RewardRule[]>([])
  const [savingRewardRuleId, setSavingRewardRuleId] = useState<string | null>(null)
  const [savingBillProviderId, setSavingBillProviderId] = useState<string | null>(null)
  const [rewardRuleReport, setRewardRuleReport] = useState<RewardRuleReport | null>(null)
  const [providerDiagnosticsReport, setProviderDiagnosticsReport] = useState<ProviderDiagnosticsReport | null>(null)
  const [refreshingProviderDiagnostics, setRefreshingProviderDiagnostics] = useState(false)
  const [refreshingSettlementQueues, setRefreshingSettlementQueues] = useState(false)
  const [refreshingProviderEvents, setRefreshingProviderEvents] = useState(false)
  const [billCatalogFilter, setBillCatalogFilter] = useState<BillCatalogFilter>('all')
  const [savingBillProviders, setSavingBillProviders] = useState(false)
  const [savingRewardRules, setSavingRewardRules] = useState(false)
  const [reviewingRewardRequestId, setReviewingRewardRequestId] = useState<string | null>(null)
  const [customRoutedProfileIds, setCustomRoutedProfileIds] = useState<Record<string, boolean>>({})
  const [newBillProvider, setNewBillProvider] = useState<{
    id: string
    name: string
    icon: string
    type: BillProvider['type']
    accountLabel: string
    accountPlaceholder: string
    helperText: string
    minAmount: number
    maxAmount: number
    requiresNetwork: boolean
    requiresAccount: boolean
    isActive: boolean
  }>({
    id: '',
    name: '',
    icon: '',
    type: 'airtime',
    accountLabel: 'Phone Number',
    accountPlaceholder: '0803 000 0000',
    helperText: '',
    minAmount: 100,
    maxAmount: 50000,
    requiresNetwork: true,
    requiresAccount: true,
    isActive: true,
  })
  const [newRewardRule, setNewRewardRule] = useState<{
    id: string
    name: string
    description: string
    kind: RewardRule['kind']
    triggerEvent: RewardRule['triggerEvent']
    audience: RewardRule['audience']
    amountNgn: number
    requiresReferral: boolean
    allowedTransactionTypes: Transaction['type'][]
    excludedTransactionTypes: Transaction['type'][]
    dailyPayoutCapNgn: string
    manualApprovalRequired: boolean
    isActive: boolean
  }>({
    id: '',
    name: '',
    description: '',
    kind: 'referral',
    triggerEvent: 'first_successful_transaction',
    audience: 'inviter',
    amountNgn: 200,
    requiresReferral: true,
    allowedTransactionTypes: [],
    excludedTransactionTypes: [],
    dailyPayoutCapNgn: '',
    manualApprovalRequired: false,
    isActive: true,
  })
  const [newCryptoAsset, setNewCryptoAsset] = useState<{
    symbol: string
    name: string
    network: CryptoAsset['network']
    icon: string
    marketSourceId: string
    buyMarginNgnPerUsd: number
    sellMarginNgnPerUsd: number
    buyNetworkFeeNgn: string
    sellNetworkFeeNgn: string
    quoteTtlSeconds: number
    isActive: boolean
    baseExecutionEnabled: boolean
    executionRail: NonNullable<CryptoAsset['executionRail']> | ''
    routedProfile: string
    routedToChain: string
    routedToToken: string
    routedDecimals: string
    routedAddressFamily: NonNullable<CryptoAsset['routedAddressFamily']> | ''
    minimumBuyNgn: string
    maxQuoteDriftPercent: string
  }>({
    symbol: '',
    name: '',
    network: 'Base',
    icon: '',
    marketSourceId: '',
    buyMarginNgnPerUsd: DEFAULT_USD_MARGIN_NGN,
    sellMarginNgnPerUsd: DEFAULT_USD_MARGIN_NGN,
    buyNetworkFeeNgn: '',
    sellNetworkFeeNgn: '',
    quoteTtlSeconds: 90,
    isActive: true,
    baseExecutionEnabled: false,
    executionRail: '',
    routedProfile: '',
    routedToChain: '',
    routedToToken: '',
    routedDecimals: '',
    routedAddressFamily: '',
    minimumBuyNgn: '',
    maxQuoteDriftPercent: '',
  })
  const [referenceCase, setReferenceCase] = useState<ReferenceCase | null>(null)
  const [flutterwaveHealth, setFlutterwaveHealth] = useState<FlutterwaveHealth | null>(null)
  const [flutterwaveBillsHealth, setFlutterwaveBillsHealth] = useState<FlutterwaveBillsHealth | null>(null)
  const [baseExecutorHealth, setBaseExecutorHealth] = useState<BaseExecutorHealth | null>(null)
  const [zeroExHealth, setZeroExHealth] = useState<ZeroExHealth | null>(null)
  const [cryptoMarketHealth, setCryptoMarketHealth] = useState<CryptoMarketHealth | null>(null)
  const [baseTreasuryBalances, setBaseTreasuryBalances] = useState<BaseTreasuryBalances | null>(null)
  const [refreshingCryptoMarket, setRefreshingCryptoMarket] = useState(false)
  const [transactions, setTransactions] = useState<Array<{ userId: string; transaction: Transaction }>>([])
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null)
  const [ledgerTrace, setLedgerTrace] = useState<{ userId: string; transaction: Transaction; ledgerEntries: LedgerEntry[] } | null>(null)
  const [kycItems, setKycItems] = useState<Array<{
    id: string
    userId: string
    documentType: string
    documentNumber: string
    documentUrl: string
    documentName?: string
    status: string
    notes?: string
    createdAt: string
  }>>([])
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)
  const [resolvingReference, setResolvingReference] = useState<string | null>(null)
  const [requeueingReference, setRequeueingReference] = useState<string | null>(null)
  const [resolvingCryptoOrderId, setResolvingCryptoOrderId] = useState<string | null>(null)
  const [updatingCryptoExecutionId, setUpdatingCryptoExecutionId] = useState<string | null>(null)
  const [broadcastingCryptoOrderId, setBroadcastingCryptoOrderId] = useState<string | null>(null)
  const [syncingBaseReceiptOrderId, setSyncingBaseReceiptOrderId] = useState<string | null>(null)
  const [syncingAllBaseReceipts, setSyncingAllBaseReceipts] = useState(false)
  const [syncingCryptoOrderId, setSyncingCryptoOrderId] = useState<string | null>(null)
  const [uploadingCryptoLogoId, setUploadingCryptoLogoId] = useState<string | null>(null)
  const [contractLookupAddress, setContractLookupAddress] = useState('')
  const [lookingUpContract, setLookingUpContract] = useState(false)
  const [contractLookup, setContractLookup] = useState<TokenLookupResult | null>(null)
  const [loadingReferenceCase, setLoadingReferenceCase] = useState<string | null>(null)
  const [syncingAllPayouts, setSyncingAllPayouts] = useState(false)
  const [requeueingEventId, setRequeueingEventId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [kycFundingFilter, setKycFundingFilter] = useState<'all' | 'funding_only'>('all')
  const [settlementSearch, setSettlementSearch] = useState('')
  const [settlementStatusFilter, setSettlementStatusFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('pending')
  const [settlementProviderFilter, setSettlementProviderFilter] = useState('')
  const [providerEventStatusFilter, setProviderEventStatusFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('all')
  const [providerEventProviderFilter, setProviderEventProviderFilter] = useState('')
  const [webhookTestPayload, setWebhookTestPayload] = useState(`{
  "event": "charge.completed",
  "data": {
    "id": "evt_test_manual",
    "flw_ref": "flw_test_manual",
    "tx_ref": "static_va_test_reference",
    "amount": 5000,
    "status": "successful",
    "payment_type": "bank_transfer",
    "account_number": "1234567890",
    "bank_name": "Test Bank",
    "narration": "Test User MAFITAPAY",
    "customer": {
      "email": "user@example.com"
    }
  }
}`)
  const [runningWebhookTest, setRunningWebhookTest] = useState(false)
  const [webhookTestResult, setWebhookTestResult] = useState<{ status: number; body: unknown } | null>(null)
  const [drafts, setDrafts] = useState<Record<AdminKey, string>>({
    assets: '[]',
    rewardRules: '[]',
    billProviders: '[]',
    networkProviders: '[]',
  })

  useEffect(() => {
    let active = true

    void (async () => {
      if (section === 'catalogs') {
        if (!submodule) return

        if (submodule === 'assets') {
          const loadedCryptoPricing = await fetchAdminJsonCached<CryptoAsset[]>('/api/admin/crypto-assets')
          if (!active) return
          const nextAssets = Array.isArray(loadedCryptoPricing) ? loadedCryptoPricing : []
          adoptPersistedCryptoPricing(nextAssets)
          setDrafts(current => ({ ...current, assets: JSON.stringify(nextAssets, null, 2) }))
          return
        }

        if (submodule === 'rewards') {
          const [loadedRewardRules, loadedRewardRuleReport] = await Promise.all([
            fetchAdminJsonCached<RewardRule[]>('/api/admin/reward-rules'),
            fetchAdminJsonCached<RewardRuleReport>('/api/admin/reward-rules/report?limit=20'),
          ])
          if (!active) return
          const nextRules = Array.isArray(loadedRewardRules) ? loadedRewardRules : []
          adoptPersistedRewardRules(nextRules)
          setRewardRuleReport(loadedRewardRuleReport ?? null)
          setDrafts(current => ({ ...current, rewardRules: JSON.stringify(nextRules, null, 2) }))
          return
        }

        if (submodule === 'bills') {
          const loadedBillProviders = await fetchAdminJsonCached<BillProvider[]>('/api/admin/bill-providers')
          if (!active) return
          const nextProviders = Array.isArray(loadedBillProviders) ? loadedBillProviders : []
          adoptPersistedBillProviders(nextProviders)
          setDrafts(current => ({ ...current, billProviders: JSON.stringify(nextProviders, null, 2) }))
          return
        }

        if (submodule === 'raw') {
          const rawEndpoints = ADMIN_ENDPOINTS.filter(config => config.key !== 'assets' && config.key !== 'billProviders' && config.key !== 'rewardRules')
          const entries = await Promise.all(rawEndpoints.map(async config => {
            const data = await fetchAdminJsonCached<unknown>(config.get)
            return [config.key, JSON.stringify(data, null, 2)] as const
          }))
          if (!active) return
          setDrafts(current => {
            const next = { ...current }
            for (const [key, value] of entries) next[key] = value
            return next
          })
        }
        return
      }

      if (section === 'users') {
        const [kyc, loadedUsers, loadedAuditLogs] = await Promise.all([
          fetchAdminJsonCached<typeof kycItems>('/api/admin/kyc'),
          fetchAdminJsonCached<User[]>('/api/admin/users'),
          fetchAdminJsonCached<AuditLog[]>('/api/admin/audit-logs?limit=40'),
        ])

        if (!active) return
        setKycItems(Array.isArray(kyc) ? kyc : [])
        setUsers(Array.isArray(loadedUsers) ? loadedUsers : [])
        setAuditLogs(Array.isArray(loadedAuditLogs) ? loadedAuditLogs : [])
        return
      }

      if (section === 'operations') {
        const [loadedProviderEvents, loadedProviderDiagnosticsReport, loadedTransactions, loadedDepositIntents, loadedPayoutRequests, loadedCryptoOrders] = await Promise.all([
          fetchAdminJsonCached<ProviderEvent[]>('/api/admin/provider-events?limit=30'),
          fetchAdminJsonCached<ProviderDiagnosticsReport>('/api/admin/provider-events/report'),
          fetchAdminJsonCached<Array<{ userId: string; transaction: Transaction }>>('/api/admin/transactions?limit=30'),
          fetchAdminJsonCached<DepositIntent[]>('/api/admin/deposit-intents?limit=20'),
          fetchAdminJsonCached<PayoutRequest[]>('/api/admin/payout-requests?limit=20'),
          fetchAdminJsonCached<CryptoOrder[]>('/api/admin/crypto-orders?status=pending&limit=20'),
        ])

        if (!active) return
        setProviderEvents(Array.isArray(loadedProviderEvents) ? loadedProviderEvents : [])
        setProviderDiagnosticsReport(loadedProviderDiagnosticsReport ?? null)
        setTransactions(Array.isArray(loadedTransactions) ? loadedTransactions : [])
        setDepositIntents(Array.isArray(loadedDepositIntents) ? loadedDepositIntents : [])
        setPayoutRequests(Array.isArray(loadedPayoutRequests) ? loadedPayoutRequests : [])
        setCryptoOrders(Array.isArray(loadedCryptoOrders) ? loadedCryptoOrders : [])

        // Load crypto deposit events (the admin crypto trxn list) for the deposits page and index
        try {
          setRefreshingCryptoDepositEvents(true)
          const params = new URLSearchParams({ limit: '80' })
          if (cryptoDepositStatusFilter !== 'all') params.set('status', cryptoDepositStatusFilter)
          if (cryptoDepositSweepFilter !== 'all') params.set('sweepStatus', cryptoDepositSweepFilter)
          if (cryptoDepositPairFilter) params.set('pairId', cryptoDepositPairFilter)
          const res = await fetchAdminJsonCached<any>(`/api/admin/crypto-deposits?${params.toString()}`)
          if (!active) return
          const events = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : [])
          setCryptoDepositEvents(events)
          const gasStats = Array.isArray(res?.recentGasStats) ? res.recentGasStats : []
          setRecentSweepGasStats(gasStats)
        } catch {
          setCryptoDepositEvents([])
          setRecentSweepGasStats([])
        } finally {
          setRefreshingCryptoDepositEvents(false)
        }

        return
      }

      if (section === 'health') {
        const [loadedProviderDiagnosticsReport, loadedFlutterwaveHealth, loadedFlutterwaveBillsHealth, loadedBaseExecutorHealth, loadedZeroExHealth, loadedCryptoMarketHealth, loadedBaseTreasuryBalances] = await Promise.all([
          fetchAdminJsonCached<ProviderDiagnosticsReport>('/api/admin/provider-events/report'),
          fetchAdminJsonCached<FlutterwaveHealth>('/api/admin/flutterwave/health'),
          fetchAdminJsonCached<FlutterwaveBillsHealth>('/api/admin/flutterwave/bills-health'),
          fetchAdminJsonCached<BaseExecutorHealth>('/api/admin/base/health'),
          fetchAdminJsonCached<ZeroExHealth>('/api/admin/zerox/health'),
          fetchAdminJsonCached<CryptoMarketHealth>('/api/admin/crypto-market/health'),
          fetchAdminJsonCached<BaseTreasuryBalances>('/api/admin/base/treasury'),
        ])

        if (!active) return
        setProviderDiagnosticsReport(loadedProviderDiagnosticsReport ?? null)
        setFlutterwaveHealth(loadedFlutterwaveHealth ?? null)
        setFlutterwaveBillsHealth(loadedFlutterwaveBillsHealth ?? null)
        setBaseExecutorHealth(loadedBaseExecutorHealth ?? null)
        setZeroExHealth(loadedZeroExHealth ?? null)
        setCryptoMarketHealth(loadedCryptoMarketHealth ?? null)
        setBaseTreasuryBalances(loadedBaseTreasuryBalances ?? null)
      }
    })()
      .catch((error: unknown) => {
        if (!active) return
        if (typeof error === 'object' && error !== null && 'status' in error && ((((error as { status?: number }).status ?? 0) === 401) || (((error as { status?: number }).status ?? 0) === 403))) {
          setAuthorized(false)
          return
        }
        showToast(error instanceof Error ? error.message : 'Failed to load admin workspace.', 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [section, showToast, submodule])

  async function saveConfig(key: AdminKey) {
    const config = ADMIN_ENDPOINTS.find(item => item.key === key)
    if (!config) return
    try {
      const parsed = JSON.parse(drafts[key])
      if (!Array.isArray(parsed)) throw new Error('Payload must be a JSON array.')
      setSaving(key)
      const response = await fetch(config.patch, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [config.bodyKey]: parsed }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Save failed.')
      primeAdminFetchCache(config.get, payload.data)
      setDrafts(current => ({ ...current, [key]: JSON.stringify(payload.data, null, 2) }))
      showToast(`${config.title} updated.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Save failed.', 'error')
    } finally {
      setSaving(null)
    }
  }

  /**
   * Replaces the working copy *and* the saved baseline together. Use this for anything that came
   * from the server — a load, a market refresh, or a successful persist — so that "unsaved" always
   * means "differs from what the server confirmed" and can never drift.
   */
  function adoptPersistedCryptoPricing(assets: CryptoAsset[]) {
    setCryptoPricing(assets)
    setSavedCryptoPricing(assets)
  }

  async function persistCryptoPricing(assets: CryptoAsset[]) {
    const normalizedAssets = assets.map(normalizeCryptoAssetForPersist)
    const response = await fetch('/api/admin/crypto-assets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ assets: normalizedAssets }),
    })
    const payload = await response.json()
    if (!response.ok || payload.success === false) throw new Error(payload.error || 'Crypto pricing update failed.')
    const persistedAssets = Array.isArray(payload.data) ? payload.data as CryptoAsset[] : normalizedAssets
    primeAdminFetchCache('/api/admin/crypto-assets', persistedAssets)
    return persistedAssets
  }

  function normalizeCryptoAssetForPersist(asset: CryptoAsset): CryptoAsset {
    const executionRail = asset.executionRail || undefined
    const normalized: CryptoAsset = {
      ...asset,
      symbol: asset.symbol.trim().toUpperCase(),
      name: asset.name.trim(),
      icon: asset.icon.trim(),
      marketSourceId: asset.marketSourceId.trim(),
      executionRail,
      routedToChain: asset.routedToChain?.trim() || undefined,
      routedToToken: asset.routedToToken?.trim() || undefined,
      routedDecimals: parseOptionalNumber(asset.routedDecimals),
      routedAddressFamily: asset.routedAddressFamily || undefined,
      minimumBuyNgn: parseOptionalNumber(asset.minimumBuyNgn),
      maxQuoteDriftPercent: parseOptionalNumber(asset.maxQuoteDriftPercent),
    }

    if (executionRail === 'routed_treasury') {
      if (!normalized.routedToChain || !/^\d+$/.test(normalized.routedToChain)) throw new Error(`${asset.id}: routed destination chain id is required.`)
      if (!normalized.routedToToken) throw new Error(`${asset.id}: routed destination token is required.`)
      if (!Number.isFinite(normalized.routedDecimals) || (normalized.routedDecimals ?? 0) < 0) throw new Error(`${asset.id}: routed token decimals must be a valid number.`)
      if (!normalized.routedAddressFamily) throw new Error(`${asset.id}: routed address family is required.`)
      if (!Number.isFinite(normalized.minimumBuyNgn) || (normalized.minimumBuyNgn ?? 0) <= 0) throw new Error(`${asset.id}: minimum buy NGN must be set for routed execution.`)
      if (!Number.isFinite(normalized.maxQuoteDriftPercent) || (normalized.maxQuoteDriftPercent ?? 0) <= 0) throw new Error(`${asset.id}: max quote drift percent must be set for routed execution.`)
      return normalized
    }

    return {
      ...normalized,
      routedToChain: undefined,
      routedToToken: undefined,
      routedDecimals: undefined,
      routedAddressFamily: undefined,
      minimumBuyNgn: undefined,
      maxQuoteDriftPercent: undefined,
    }
  }

  async function saveCryptoPricing() {
    try {
      setSavingCryptoPricing(true)
      const persistedAssets = await persistCryptoPricing(cryptoPricing)
      adoptPersistedCryptoPricing(persistedAssets)
      setDrafts(current => ({ ...current, assets: JSON.stringify(persistedAssets, null, 2) }))
      showToast('Crypto pricing updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Crypto pricing update failed.', 'error')
    } finally {
      setSavingCryptoPricing(false)
    }
  }

  /**
   * Saves one pair's edits. Builds the payload from the saved baseline rather than the working copy,
   * so pressing Save in one pair's editor cannot quietly write out a different pair that happens to
   * be sitting mid-edit. Returns whether it succeeded, so the caller can decide to close the editor.
   */
  async function saveCryptoPair(pairId: string) {
    const edited = cryptoPricing.find(asset => asset.id === pairId)
    if (!edited) return false

    try {
      setSavingCryptoPairId(pairId)
      const nextAssets = savedCryptoPricing.some(asset => asset.id === pairId)
        ? savedCryptoPricing.map(asset => asset.id === pairId ? edited : asset)
        : [edited, ...savedCryptoPricing]
      const persistedAssets = await persistCryptoPricing(nextAssets)
      adoptPersistedCryptoPricing(persistedAssets)
      setDrafts(current => ({ ...current, assets: JSON.stringify(persistedAssets, null, 2) }))
      showToast(`${pairId} saved.`)
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : `${pairId} could not be saved.`, 'error')
      return false
    } finally {
      setSavingCryptoPairId(null)
    }
  }

  /** Throws away one pair's unsaved edits, restoring whatever the server last confirmed. */
  function discardCryptoPairEdits(pairId: string) {
    const saved = savedCryptoPricing.find(asset => asset.id === pairId)
    setCryptoPricing(current => saved
      ? current.map(asset => asset.id === pairId ? saved : asset)
      : current.filter(asset => asset.id !== pairId))
  }

  async function uploadCryptoLogo(file: File, target: { draft?: boolean; pairId?: string; symbol?: string }) {
    try {
      const targetId = target.pairId || (target.draft ? 'draft' : 'upload')
      setUploadingCryptoLogoId(targetId)
      const body = new FormData()
      body.set('file', file)
      if (target.pairId) body.set('pairId', target.pairId)
      if (target.symbol) body.set('symbol', target.symbol)
      const response = await fetch('/api/admin/crypto-assets/upload', { method: 'POST', credentials: 'include', body })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Logo upload failed.')
      const uploadedPath = payload.data?.path
      if (typeof uploadedPath !== 'string' || !uploadedPath.trim()) throw new Error('Uploaded logo path is missing.')
      if (target.draft) {
        setNewCryptoAsset(current => ({ ...current, icon: uploadedPath }))
      } else if (target.pairId) {
        const nextAssets = cryptoPricing.map(asset => asset.id === target.pairId ? { ...asset, icon: uploadedPath } : asset)
        setCryptoPricing(nextAssets)
        const persistedAssets = await persistCryptoPricing(nextAssets)
        adoptPersistedCryptoPricing(persistedAssets)
        setDrafts(current => ({ ...current, assets: JSON.stringify(persistedAssets, null, 2) }))
      }
      showToast(target.pairId ? 'Logo uploaded and saved.' : 'Logo uploaded.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Logo upload failed.', 'error')
    } finally {
      setUploadingCryptoLogoId(null)
    }
  }

  /**
   * The profit per dollar this desk actually charges, taken as the most common value across the live
   * catalog, so a new pair starts from house practice instead of the library default. Falls back to
   * the constant while the catalog is still empty.
   */
  function getDefaultMarginNgnPerUsd() {
    const counts = new Map<number, number>()
    for (const asset of cryptoPricing) {
      const margin = asset.buyMarginNgnPerUsd
      if (typeof margin !== 'number' || !Number.isFinite(margin) || margin <= 0) continue
      counts.set(margin, (counts.get(margin) ?? 0) + 1)
    }

    let best = DEFAULT_USD_MARGIN_NGN
    let bestCount = 0
    for (const [margin, count] of counts) {
      if (count > bestCount) {
        best = margin
        bestCount = count
      }
    }
    return best
  }

  /** Seeds the new-pair draft with the house margin. Called when the operator opens the form. */
  function primeNewCryptoAssetDefaults() {
    const margin = getDefaultMarginNgnPerUsd()
    setNewCryptoAsset(current => ({
      ...current,
      buyMarginNgnPerUsd: margin,
      sellMarginNgnPerUsd: margin,
    }))
  }

  function resetContractLookup() {
    setContractLookup(null)
    setContractLookupAddress('')
  }

  /**
   * Fills the new-pair draft from a contract address, replacing the chain id, token address,
   * decimals, symbol, name, price-feed id and logo that were previously typed by hand.
   *
   * A token CoinGecko does not list is force-parked as catalog-only and inactive: with no price feed
   * there is nothing to quote against, so offering it for trading would create orders we cannot
   * price. The operator can still override both under Advanced, deliberately.
   */
  async function lookupCryptoToken(network: CryptoAsset['network'], address: string) {
    const trimmed = address.trim()
    if (!trimmed) {
      showToast('Paste a contract address first.', 'error')
      return
    }

    try {
      setLookingUpContract(true)
      const response = await fetch('/api/admin/crypto-assets/lookup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ network, address: trimmed }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Token lookup failed.')

      const result = payload.data as TokenLookupResult
      setContractLookup(result)
      setNewCryptoAsset(current => ({
        ...current,
        symbol: result.symbol || current.symbol,
        name: result.name || current.name,
        network: result.network,
        icon: result.iconPath || current.icon,
        marketSourceId: result.marketSourceId || current.marketSourceId,
        routedToChain: String(result.chainId),
        routedToToken: result.address,
        routedDecimals: result.decimals == null ? '' : String(result.decimals),
        routedAddressFamily: result.addressFamily,
        executionRail: result.verification === 'verified' ? current.executionRail : '',
        isActive: result.verification === 'verified' ? current.isActive : false,
      }))
      showToast(
        result.verification === 'verified'
          ? `Filled in ${result.symbol || 'the token'} from the chain.`
          : 'Looked up — read the notice on the form before saving.',
        result.verification === 'verified' ? 'success' : 'error',
      )
    } catch (error) {
      setContractLookup(null)
      showToast(error instanceof Error ? error.message : 'Token lookup failed.', 'error')
    } finally {
      setLookingUpContract(false)
    }
  }

  function getDraftMarketPreview() {
    const symbol = newCryptoAsset.symbol.trim().toUpperCase()
    const marketSourceId = newCryptoAsset.marketSourceId.trim() || getDefaultCryptoMarketSourceId(symbol)
    if (!marketSourceId) return { marketRate: 0, marketPriceUsd: 0 }
    const match = cryptoPricing.find(asset => asset.marketSourceId === marketSourceId)
    return {
      marketRate: match?.marketRate ?? 0,
      marketPriceUsd: match?.marketPriceUsd ?? 0,
    }
  }

  /** @deprecated use getDraftMarketPreview — kept for callers that only need mid NGN rate */
  function getDraftMarketRatePreview() {
    return getDraftMarketPreview().marketRate
  }

  function applyNewAssetRoutedProfile(profileId: string) {
    const config = getRoutedProfileConfig(profileId)
    setNewCryptoAsset(current => {
      if (!config) return { ...current, routedProfile: profileId }
      return {
        ...current,
        symbol: config.symbol,
        network: config.network,
        executionRail: 'routed_treasury',
        routedProfile: profileId,
        routedToChain: config.toChain,
        routedToToken: config.toToken,
        routedDecimals: String(config.decimals),
        routedAddressFamily: config.addressFamily,
        minimumBuyNgn: String(config.minimumBuyNgn),
        maxQuoteDriftPercent: String(config.maxQuoteDriftPercent),
      }
    })
  }

  async function createCryptoPair() {
    const symbol = newCryptoAsset.symbol.trim().toUpperCase()
    const name = newCryptoAsset.name.trim()
    const icon = newCryptoAsset.icon.trim() || CRYPTO_LOGO_SUGGESTIONS[symbol] || symbol.slice(0, 1) || '¤'
    const marketSourceId = newCryptoAsset.marketSourceId.trim() || getDefaultCryptoMarketSourceId(symbol)
    const { marketRate: marketRatePreview, marketPriceUsd: marketPriceUsdPreview } = getDraftMarketPreview()
    if (!symbol || !name) return showToast('Symbol and asset name are required.', 'error')
    if (!marketSourceId) return showToast('Live price feed ID is required for new crypto pairs.', 'error')
    const id = buildCryptoPairId(symbol, newCryptoAsset.network)
    if (cryptoPricing.some(item => item.id === id)) return showToast(`${id} already exists. Edit the existing pair instead.`, 'error')

    const buyMargin = Math.max(0, Number(newCryptoAsset.buyMarginNgnPerUsd) || DEFAULT_USD_MARGIN_NGN)
    const sellMargin = Math.max(0, Number(newCryptoAsset.sellMarginNgnPerUsd) || DEFAULT_USD_MARGIN_NGN)
    const asset: CryptoAsset = {
      id: id as CryptoAsset['id'],
      symbol: symbol as CryptoAsset['symbol'],
      name,
      network: newCryptoAsset.network,
      icon,
      marketSourceId,
      marketPriceUsd: marketPriceUsdPreview || undefined,
      marketRate: marketRatePreview,
      buyMarginNgnPerUsd: buyMargin,
      sellMarginNgnPerUsd: sellMargin,
      buyNetworkFeeNgn: parseOptionalNumber(newCryptoAsset.buyNetworkFeeNgn),
      sellNetworkFeeNgn: parseOptionalNumber(newCryptoAsset.sellNetworkFeeNgn),
      buyRate: marketRatePreview > 0 ? computeBuyRate(marketPriceUsdPreview, marketRatePreview, buyMargin) : 0,
      sellRate: marketRatePreview > 0 ? computeSellRate(marketPriceUsdPreview, marketRatePreview, sellMargin) : 0,
      quoteTtlSeconds: newCryptoAsset.quoteTtlSeconds,
      isActive: newCryptoAsset.isActive,
      baseExecutionEnabled: newCryptoAsset.baseExecutionEnabled,
      executionRail: newCryptoAsset.executionRail || undefined,
      routedToChain: newCryptoAsset.routedToChain.trim() || undefined,
      routedToToken: newCryptoAsset.routedToToken.trim() || undefined,
      routedDecimals: parseOptionalNumber(newCryptoAsset.routedDecimals),
      routedAddressFamily: newCryptoAsset.routedAddressFamily || undefined,
      minimumBuyNgn: parseOptionalNumber(newCryptoAsset.minimumBuyNgn),
      maxQuoteDriftPercent: parseOptionalNumber(newCryptoAsset.maxQuoteDriftPercent),
      change24h: 0,
    }

    try {
      setSavingCryptoPricing(true)
      // Built from the saved baseline, not the working copy, so creating a pair cannot also write out
      // an unrelated pair that happens to be sitting mid-edit.
      const nextAssets = [normalizeCryptoAssetForPersist(asset), ...savedCryptoPricing]
      setCryptoPricing(nextAssets)
      const persistedAssets = await persistCryptoPricing(nextAssets)
      adoptPersistedCryptoPricing(persistedAssets)
      setDrafts(current => ({ ...current, assets: JSON.stringify(persistedAssets, null, 2) }))
      setNewCryptoAsset({
        symbol: '',
        name: '',
        network: 'Base',
        icon: '',
        marketSourceId: '',
        buyMarginNgnPerUsd: DEFAULT_USD_MARGIN_NGN,
        sellMarginNgnPerUsd: DEFAULT_USD_MARGIN_NGN,
        buyNetworkFeeNgn: '',
        sellNetworkFeeNgn: '',
        quoteTtlSeconds: 90,
        isActive: true,
        baseExecutionEnabled: false,
        executionRail: '',
        routedProfile: '',
        routedToChain: '',
        routedToToken: '',
        routedDecimals: '',
        routedAddressFamily: '',
        minimumBuyNgn: '',
        maxQuoteDriftPercent: '',
      })
      showToast(`${id} created and saved.`)
    } catch (error) {
      setCryptoPricing(current => current.filter(item => item.id !== id))
      showToast(error instanceof Error ? error.message : 'Crypto pair creation failed.', 'error')
    } finally {
      setSavingCryptoPricing(false)
    }
  }

  function setCryptoPairArchived(pairId: string, archived: boolean) {
    setCryptoPricing(current => current.map(asset => asset.id === pairId ? {
      ...asset,
      isActive: !archived,
      baseExecutionEnabled: archived ? false : asset.baseExecutionEnabled,
    } : asset))
  }

  function normalizeRewardRuleForPersist(rule: RewardRule): RewardRule {
    const normalized: RewardRule = {
      ...rule,
      id: rule.id.trim(),
      name: rule.name.trim(),
      description: rule.description?.trim() || undefined,
      amountNgn: Number(rule.amountNgn),
      dailyPayoutCapNgn: parseOptionalNumber(rule.dailyPayoutCapNgn),
      requiresReferral: rule.requiresReferral === true,
      allowedTransactionTypes: rule.allowedTransactionTypes?.length ? Array.from(new Set(rule.allowedTransactionTypes)) : undefined,
      excludedTransactionTypes: rule.excludedTransactionTypes?.length ? Array.from(new Set(rule.excludedTransactionTypes)) : undefined,
      manualApprovalRequired: rule.manualApprovalRequired === true,
      isActive: rule.isActive !== false,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    }
    if (!normalized.id) throw new Error('Reward rule id is required.')
    if (!normalized.name) throw new Error(`${rule.id || 'reward'}: reward rule name is required.`)
    if (!Number.isFinite(normalized.amountNgn) || normalized.amountNgn <= 0) throw new Error(`${normalized.id}: reward amount must be greater than zero.`)
    if (normalized.dailyPayoutCapNgn != null && (!Number.isFinite(normalized.dailyPayoutCapNgn) || normalized.dailyPayoutCapNgn <= 0)) throw new Error(`${normalized.id}: daily payout cap must be greater than zero when set.`)
    if (normalized.audience === 'inviter') normalized.requiresReferral = true
    if (normalized.triggerEvent === 'user_signup') {
      normalized.allowedTransactionTypes = undefined
      normalized.excludedTransactionTypes = undefined
    }
    return normalized
  }

  async function refreshRewardRuleReport() {
    const reportResponse = await fetch('/api/admin/reward-rules/report?limit=20', { credentials: 'include', cache: 'no-store' })
    const reportPayload = await reportResponse.json()
    if (!reportResponse.ok || reportPayload.success === false) throw new Error(reportPayload.error || 'Failed to refresh reward report.')
    primeAdminFetchCache('/api/admin/reward-rules/report?limit=20', reportPayload.data ?? null)
    setRewardRuleReport(reportPayload.data ?? null)
  }

  function adoptPersistedRewardRules(rules: RewardRule[]) {
    setRewardRules(rules)
    setSavedRewardRules(rules)
  }

  async function persistRewardRules(rules: RewardRule[]) {
    const normalizedRules = rules.map(normalizeRewardRuleForPersist)
    const response = await fetch('/api/admin/reward-rules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ rules: normalizedRules }),
    })
    const payload = await response.json()
    if (!response.ok || payload.success === false) throw new Error(payload.error || 'Reward rule update failed.')
    const persisted = Array.isArray(payload.data) ? payload.data as RewardRule[] : normalizedRules
    primeAdminFetchCache('/api/admin/reward-rules', persisted)
    return persisted
  }

  async function saveRewardRuleCatalog() {
    try {
      setSavingRewardRules(true)
      const persisted = await persistRewardRules(rewardRules)
      adoptPersistedRewardRules(persisted)
      setDrafts(current => ({ ...current, rewardRules: JSON.stringify(persisted, null, 2) }))
      await refreshRewardRuleReport()
      showToast('Reward rules updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Reward rule update failed.', 'error')
    } finally {
      setSavingRewardRules(false)
    }
  }

  /** Saves one rule's edits, built from the baseline so another rule mid-edit is not written out. */
  async function saveRewardRule(ruleId: string) {
    const edited = rewardRules.find(rule => rule.id === ruleId)
    if (!edited) return false

    try {
      setSavingRewardRuleId(ruleId)
      const nextRules = savedRewardRules.some(rule => rule.id === ruleId)
        ? savedRewardRules.map(rule => rule.id === ruleId ? edited : rule)
        : [edited, ...savedRewardRules]
      const persisted = await persistRewardRules(nextRules)
      adoptPersistedRewardRules(persisted)
      setDrafts(current => ({ ...current, rewardRules: JSON.stringify(persisted, null, 2) }))
      await refreshRewardRuleReport()
      showToast(`${ruleId} saved.`)
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : `${ruleId} could not be saved.`, 'error')
      return false
    } finally {
      setSavingRewardRuleId(null)
    }
  }

  /** Throws away one rule's unsaved edits, restoring whatever the server last confirmed. */
  function discardRewardRuleEdits(ruleId: string) {
    const saved = savedRewardRules.find(rule => rule.id === ruleId)
    setRewardRules(current => saved
      ? current.map(rule => rule.id === ruleId ? saved : rule)
      : current.filter(rule => rule.id !== ruleId))
  }

  function toggleRewardTransactionType(current: Transaction['type'][], value: Transaction['type']): Transaction['type'][] {
    return current.includes(value) ? current.filter(item => item !== value) : [...current, value]
  }

  async function createRewardRule() {
    const normalizedId = newRewardRule.id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')
    if (!normalizedId || !newRewardRule.name.trim()) return showToast('Reward rule id and name are required.', 'error')
    if (rewardRules.some(item => item.id === normalizedId)) return showToast(`${normalizedId} already exists. Edit the existing rule instead.`, 'error')
    const draftRule = normalizeRewardRuleForPersist({
      id: normalizedId,
      name: newRewardRule.name,
      description: newRewardRule.description,
      kind: newRewardRule.kind,
      triggerEvent: newRewardRule.triggerEvent,
      audience: newRewardRule.audience,
      amountNgn: newRewardRule.amountNgn,
      requiresReferral: newRewardRule.requiresReferral,
      allowedTransactionTypes: newRewardRule.allowedTransactionTypes as Transaction['type'][],
      excludedTransactionTypes: newRewardRule.excludedTransactionTypes as Transaction['type'][],
      dailyPayoutCapNgn: parseOptionalNumber(newRewardRule.dailyPayoutCapNgn),
      manualApprovalRequired: newRewardRule.manualApprovalRequired,
      isActive: newRewardRule.isActive,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    try {
      setSavingRewardRules(true)
      const persisted = await persistRewardRules([draftRule, ...savedRewardRules])
      adoptPersistedRewardRules(persisted)
      setDrafts(current => ({ ...current, rewardRules: JSON.stringify(persisted, null, 2) }))
      await refreshRewardRuleReport()
      setNewRewardRule({
        id: '',
        name: '',
        description: '',
        kind: 'referral',
        triggerEvent: 'first_successful_transaction',
        audience: 'inviter',
        amountNgn: 200,
        requiresReferral: true,
        allowedTransactionTypes: [],
        excludedTransactionTypes: [],
        dailyPayoutCapNgn: '',
        manualApprovalRequired: false,
        isActive: true,
      })
      showToast(`${draftRule.name} created and saved.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Reward rule creation failed.', 'error')
    } finally {
      setSavingRewardRules(false)
    }
  }

  async function reviewRewardRequest(request: RewardAwardRequest, action: 'approve' | 'reject') {
    try {
      setReviewingRewardRequestId(request.id)
      const response = await fetch(`/api/admin/reward-award-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Reward request update failed.')
      primeAdminFetchCache('/api/admin/reward-rules/report?limit=20', payload.data ?? null)
      setRewardRuleReport(payload.data ?? null)
      showToast(action === 'approve' ? 'Reward request approved.' : 'Reward request rejected.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Reward request update failed.', 'error')
    } finally {
      setReviewingRewardRequestId(null)
    }
  }

  function adoptPersistedBillProviders(providers: BillProvider[]) {
    setBillProviderCatalog(providers)
    setSavedBillProviderCatalog(providers)
  }

  async function persistBillProviders(providers: BillProvider[]) {
    const response = await fetch('/api/admin/bill-providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ providers }),
    })
    const payload = await response.json()
    if (!response.ok || payload.success === false) throw new Error(payload.error || 'Bill provider update failed.')
    const persisted = Array.isArray(payload.data) ? payload.data as BillProvider[] : providers
    primeAdminFetchCache('/api/admin/bill-providers', persisted)
    return persisted
  }

  async function saveBillProviderCatalog() {
    try {
      setSavingBillProviders(true)
      const persisted = await persistBillProviders(billProviderCatalog)
      adoptPersistedBillProviders(persisted)
      setDrafts(current => ({ ...current, billProviders: JSON.stringify(persisted, null, 2) }))
      showToast('Bill providers updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Bill provider update failed.', 'error')
    } finally {
      setSavingBillProviders(false)
    }
  }

  /** Saves one provider's edits, built from the baseline so another mid-edit is not written out. */
  async function saveBillProvider(providerId: string) {
    const edited = billProviderCatalog.find(provider => provider.id === providerId)
    if (!edited) return false

    try {
      setSavingBillProviderId(providerId)
      const nextProviders = savedBillProviderCatalog.some(provider => provider.id === providerId)
        ? savedBillProviderCatalog.map(provider => provider.id === providerId ? edited : provider)
        : [edited, ...savedBillProviderCatalog]
      const persisted = await persistBillProviders(nextProviders)
      adoptPersistedBillProviders(persisted)
      setDrafts(current => ({ ...current, billProviders: JSON.stringify(persisted, null, 2) }))
      showToast(`${providerId} saved.`)
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : `${providerId} could not be saved.`, 'error')
      return false
    } finally {
      setSavingBillProviderId(null)
    }
  }

  /** Throws away one provider's unsaved edits, restoring whatever the server last confirmed. */
  function discardBillProviderEdits(providerId: string) {
    const saved = savedBillProviderCatalog.find(provider => provider.id === providerId)
    setBillProviderCatalog(current => saved
      ? current.map(provider => provider.id === providerId ? saved : provider)
      : current.filter(provider => provider.id !== providerId))
  }

  async function createBillProvider() {
    const id = newBillProvider.id.trim().toLowerCase()
    const name = newBillProvider.name.trim()
    const icon = (newBillProvider.icon.trim() || BILL_ICON_SUGGESTIONS[newBillProvider.type] || '🧾').slice(0, 2)
    if (!id || !name) return showToast('Provider ID and display name are required.', 'error')
    if (billProviderCatalog.some(item => item.id === id)) return showToast(`${id} already exists. Edit the existing provider instead.`, 'error')
    if (!Number.isFinite(newBillProvider.minAmount) || newBillProvider.minAmount <= 0) return showToast('Minimum amount must be greater than zero.', 'error')
    if (!Number.isFinite(newBillProvider.maxAmount) || newBillProvider.maxAmount < newBillProvider.minAmount) return showToast('Maximum amount must be greater than or equal to the minimum amount.', 'error')

    const provider: BillProvider = {
      id,
      name,
      icon,
      type: newBillProvider.type,
      accountLabel: newBillProvider.accountLabel.trim() || undefined,
      accountPlaceholder: newBillProvider.accountPlaceholder.trim() || undefined,
      helperText: newBillProvider.helperText.trim() || undefined,
      minAmount: newBillProvider.minAmount,
      maxAmount: newBillProvider.maxAmount,
      requiresNetwork: newBillProvider.requiresNetwork,
      requiresAccount: newBillProvider.requiresAccount,
      isActive: newBillProvider.isActive,
    }

    try {
      setSavingBillProviders(true)
      const persisted = await persistBillProviders([provider, ...savedBillProviderCatalog])
      adoptPersistedBillProviders(persisted)
      setDrafts(current => ({ ...current, billProviders: JSON.stringify(persisted, null, 2) }))
      setNewBillProvider({
        id: '',
        name: '',
        icon: '',
        type: 'airtime',
        accountLabel: 'Phone Number',
        accountPlaceholder: '0803 000 0000',
        helperText: '',
        minAmount: 100,
        maxAmount: 50000,
        requiresNetwork: true,
        requiresAccount: true,
        isActive: true,
      })
      showToast(`${name} created and saved.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Bill provider creation failed.', 'error')
    } finally {
      setSavingBillProviders(false)
    }
  }

  function setBillProviderArchived(providerId: string, archived: boolean) {
    setBillProviderCatalog(current => current.map(item => item.id === providerId ? { ...item, isActive: !archived } : item))
  }

  async function resolveCryptoOrder(orderId: string, status: 'fulfilled' | 'failed' | 'expired') {
    setResolvingCryptoOrderId(orderId)
    try {
      const response = await fetch(`/api/admin/crypto-orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Crypto order update failed.')
      const ordersResponse = await fetch('/api/admin/crypto-orders?status=pending&limit=20', { credentials: 'include', cache: 'no-store' })
      const ordersPayload = await ordersResponse.json()
      if (ordersResponse.ok && ordersPayload.success !== false && Array.isArray(ordersPayload.data)) setCryptoOrders(ordersPayload.data)
      showToast(`Crypto order ${status}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Crypto order update failed.', 'error')
    } finally {
      setResolvingCryptoOrderId(null)
    }
  }

  async function updateCryptoExecution(orderId: string, executionStatus: 'awaiting_swap' | 'broadcasted' | 'settled' | 'failed') {
    setUpdatingCryptoExecutionId(orderId)
    try {
      const response = await fetch(`/api/admin/crypto-orders/${encodeURIComponent(orderId)}/execution`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ executionStatus, executionReference: executionStatus === 'broadcasted' ? `base_swap_${Date.now()}` : undefined }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Crypto execution update failed.')
      const ordersResponse = await fetch('/api/admin/crypto-orders?status=pending&limit=20', { credentials: 'include', cache: 'no-store' })
      const ordersPayload = await ordersResponse.json()
      if (ordersResponse.ok && ordersPayload.success !== false && Array.isArray(ordersPayload.data)) setCryptoOrders(ordersPayload.data)
      if (referenceCase?.cryptoOrder?.id === orderId && referenceCase.reference) await inspectReference(referenceCase.reference)
      showToast(`Crypto execution marked ${executionStatus}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Crypto execution update failed.', 'error')
    } finally {
      setUpdatingCryptoExecutionId(null)
    }
  }

  async function broadcastCryptoOrder(orderId: string) {
    setBroadcastingCryptoOrderId(orderId)
    try {
      const response = await fetch(`/api/admin/crypto-orders/${encodeURIComponent(orderId)}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'delivery' }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Base broadcast failed.')
      const ordersResponse = await fetch('/api/admin/crypto-orders?status=pending&limit=20', { credentials: 'include', cache: 'no-store' })
      const ordersPayload = await ordersResponse.json()
      if (ordersResponse.ok && ordersPayload.success !== false && Array.isArray(ordersPayload.data)) setCryptoOrders(ordersPayload.data)
      if (referenceCase?.cryptoOrder?.id === orderId && referenceCase.reference) await inspectReference(referenceCase.reference)
      showToast('Base delivery transaction broadcasted.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Base broadcast failed.', 'error')
    } finally {
      setBroadcastingCryptoOrderId(null)
    }
  }

  async function executeZeroExSwap(orderId: string) {
    setBroadcastingCryptoOrderId(orderId)
    try {
      const response = await fetch(`/api/admin/crypto-orders/${encodeURIComponent(orderId)}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'zerox_swap' }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || '0x swap execution failed.')
      const ordersResponse = await fetch('/api/admin/crypto-orders?status=pending&limit=20', { credentials: 'include', cache: 'no-store' })
      const ordersPayload = await ordersResponse.json()
      if (ordersResponse.ok && ordersPayload.success !== false && Array.isArray(ordersPayload.data)) setCryptoOrders(ordersPayload.data)
      if (referenceCase?.cryptoOrder?.id === orderId && referenceCase.reference) await inspectReference(referenceCase.reference)
      showToast('0x swap transaction broadcasted.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '0x swap execution failed.', 'error')
    } finally {
      setBroadcastingCryptoOrderId(null)
    }
  }

  async function syncBaseReceipt(orderId: string) {
    setSyncingBaseReceiptOrderId(orderId)
    try {
      const response = await fetch(`/api/admin/crypto-orders/${encodeURIComponent(orderId)}/receipt-sync`, { method: 'POST', credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Base receipt sync failed.')
      const ordersResponse = await fetch('/api/admin/crypto-orders?status=pending&limit=20', { credentials: 'include', cache: 'no-store' })
      const ordersPayload = await ordersResponse.json()
      if (ordersResponse.ok && ordersPayload.success !== false && Array.isArray(ordersPayload.data)) setCryptoOrders(ordersPayload.data)
      if (referenceCase?.cryptoOrder?.id === orderId && referenceCase.reference) await inspectReference(referenceCase.reference)
      showToast(payload.data?.settled ? 'Base receipt settled the crypto order.' : 'Base receipt is still pending.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Base receipt sync failed.', 'error')
    } finally {
      setSyncingBaseReceiptOrderId(null)
    }
  }

  async function syncAllBaseReceipts() {
    setSyncingAllBaseReceipts(true)
    try {
      const response = await fetch('/api/admin/crypto-orders/base-sync-pending', { method: 'POST', credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Base batch sync failed.')
      const ordersResponse = await fetch('/api/admin/crypto-orders?status=pending&limit=20', { credentials: 'include', cache: 'no-store' })
      const ordersPayload = await ordersResponse.json()
      if (ordersResponse.ok && ordersPayload.success !== false && Array.isArray(ordersPayload.data)) setCryptoOrders(ordersPayload.data)
      if (referenceCase?.reference) await inspectReference(referenceCase.reference)
      showToast(`Base receipt scan complete. Success: ${payload.data?.success ?? 0}, failed: ${payload.data?.failed ?? 0}, pending: ${payload.data?.pending ?? 0}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Base batch sync failed.', 'error')
    } finally {
      setSyncingAllBaseReceipts(false)
    }
  }

  async function syncCryptoOrder(orderId: string) {
    setSyncingCryptoOrderId(orderId)
    try {
      const response = await fetch(`/api/admin/crypto-orders/${encodeURIComponent(orderId)}/sync`, { method: 'POST', credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Crypto order sync failed.')
      const ordersResponse = await fetch('/api/admin/crypto-orders?status=pending&limit=20', { credentials: 'include', cache: 'no-store' })
      const ordersPayload = await ordersResponse.json()
      if (ordersResponse.ok && ordersPayload.success !== false && Array.isArray(ordersPayload.data)) setCryptoOrders(ordersPayload.data)
      if (referenceCase?.cryptoOrder?.id === orderId && referenceCase.reference) await inspectReference(referenceCase.reference)
      showToast('Crypto order synced.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Crypto order sync failed.', 'error')
    } finally {
      setSyncingCryptoOrderId(null)
    }
  }

  async function reviewKyc(submissionId: string, status: 'approved' | 'rejected') {
    setReviewingId(submissionId)
    try {
      const response = await fetch('/api/admin/kyc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ submissionId, status, notes: reviewNotes[submissionId] ?? '' }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'KYC review failed.')
      setKycItems(current => current.map(item => item.id === submissionId ? payload.data : item))
      const usersResponse = await fetch('/api/admin/users', { credentials: 'include', cache: 'no-store' })
      const usersPayload = await usersResponse.json()
      if (usersResponse.ok && usersPayload.success !== false && Array.isArray(usersPayload.data)) setUsers(usersPayload.data)
      const logsResponse = await fetch('/api/admin/audit-logs?limit=40', { credentials: 'include', cache: 'no-store' })
      const logsPayload = await logsResponse.json()
      if (logsResponse.ok && logsPayload.success !== false && Array.isArray(logsPayload.data)) setAuditLogs(logsPayload.data)
      showToast(`KYC submission ${status}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'KYC review failed.', 'error')
    } finally {
      setReviewingId(null)
    }
  }

  async function updateUserStatus(targetUserId: string, status: 'active' | 'deactivated') {
    setUpdatingUserId(targetUserId)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(targetUserId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status, reason: `Admin ${user?.email ?? 'system'} set account status to ${status}.` }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Account status update failed.')
      setUsers(current => current.map(item => item.id === targetUserId ? payload.data : item))
      const logsResponse = await fetch('/api/admin/audit-logs?limit=40', { credentials: 'include', cache: 'no-store' })
      const logsPayload = await logsResponse.json()
      if (logsResponse.ok && logsPayload.success !== false && Array.isArray(logsPayload.data)) setAuditLogs(logsPayload.data)
      showToast(`Account ${status === 'active' ? 'reactivated' : 'deactivated'}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Account status update failed.', 'error')
    } finally {
      setUpdatingUserId(null)
    }
  }

  async function inspectLedger(transactionId: string) {
    setSelectedTransactionId(transactionId)
    try {
      const response = await fetch(`/api/admin/transactions/${encodeURIComponent(transactionId)}/ledger`, { credentials: 'include', cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load ledger trace.')
      setLedgerTrace(payload.data)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load ledger trace.', 'error')
    }
  }

  async function reloadSettlementQueues(reference = settlementSearch, status = settlementStatusFilter, provider = settlementProviderFilter) {
    setRefreshingSettlementQueues(true)
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (reference.trim()) params.set('reference', reference.trim())
      if (status !== 'all') params.set('status', status)
      if (provider.trim()) params.set('provider', provider.trim())
      const query = `?${params.toString()}`
      const [depositResponse, payoutResponse] = await Promise.all([
        fetch(`/api/admin/deposit-intents${query}`, { credentials: 'include', cache: 'no-store' }),
        fetch(`/api/admin/payout-requests${query}`, { credentials: 'include', cache: 'no-store' }),
      ])
      const [depositPayload, payoutPayload] = await Promise.all([depositResponse.json(), payoutResponse.json()])
      if (depositResponse.ok && depositPayload.success !== false && Array.isArray(depositPayload.data)) setDepositIntents(depositPayload.data)
      if (payoutResponse.ok && payoutPayload.success !== false && Array.isArray(payoutPayload.data)) setPayoutRequests(payoutPayload.data)
    } finally {
      setRefreshingSettlementQueues(false)
    }
  }

  async function reloadProviderEvents(status = providerEventStatusFilter, provider = providerEventProviderFilter, reference = settlementSearch) {
    setRefreshingProviderEvents(true)
    try {
      const params = new URLSearchParams({ limit: '30' })
      if (status !== 'all') params.set('status', status)
      if (provider.trim()) params.set('provider', provider.trim())
      if (reference.trim()) params.set('reference', reference.trim())
      const response = await fetch(`/api/admin/provider-events?${params.toString()}`, { credentials: 'include', cache: 'no-store' })
      const payload = await response.json()
      if (response.ok && payload.success !== false && Array.isArray(payload.data)) setProviderEvents(payload.data)
    } finally {
      setRefreshingProviderEvents(false)
    }
  }

  async function reloadProviderDiagnosticsReport() {
    setRefreshingProviderDiagnostics(true)
    try {
      const response = await fetch('/api/admin/provider-events/report', { credentials: 'include', cache: 'no-store' })
      const payload = await response.json()
      if (response.ok && payload.success !== false) setProviderDiagnosticsReport(payload.data ?? null)
    } finally {
      setRefreshingProviderDiagnostics(false)
    }
  }

  async function inspectReference(reference: string) {
    const trimmed = reference.trim()
    if (!trimmed) {
      setReferenceCase(null)
      return
    }
    setLoadingReferenceCase(trimmed)
    try {
      const response = await fetch(`/api/admin/references/${encodeURIComponent(trimmed)}`, { credentials: 'include', cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load reference case.')
      setReferenceCase(payload.data)
    } catch (error) {
      setReferenceCase(null)
      showToast(error instanceof Error ? error.message : 'Failed to load reference case.', 'error')
    } finally {
      setLoadingReferenceCase(null)
    }
  }

  async function resolveSettlement(reference: string, status: 'success' | 'failed') {
    setResolvingReference(reference)
    try {
      const response = await fetch('/api/admin/settlements/manual', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reference, status }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Manual settlement failed.')
      await reloadSettlementQueues()
      await reloadProviderEvents()
      await reloadProviderDiagnosticsReport()
      if (referenceCase?.reference === reference) await inspectReference(reference)
      showToast(`Settlement ${status === 'success' ? 'resolved' : 'failed'} for ${reference}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Manual settlement failed.', 'error')
    } finally {
      setResolvingReference(null)
    }
  }

  async function requeueSettlement(reference: string) {
    setRequeueingReference(reference)
    try {
      const response = await fetch('/api/admin/settlements/requeue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reference }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Settlement requeue failed.')
      await reloadSettlementQueues()
      await reloadProviderDiagnosticsReport()
      if (referenceCase?.reference === reference) await inspectReference(reference)
      showToast(`Settlement record requeued for ${reference}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Settlement requeue failed.', 'error')
    } finally {
      setRequeueingReference(null)
    }
  }

  async function syncAllPendingPayouts() {
    setSyncingAllPayouts(true)
    try {
      const response = await fetch('/api/admin/payout-requests/sync-pending', { method: 'POST', credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Batch payout sync failed.')
      await reloadSettlementQueues()
      await reloadProviderEvents()
      await reloadProviderDiagnosticsReport()
      if (referenceCase?.reference) await inspectReference(referenceCase.reference)
      showToast(`Checked ${payload.data.checked} payout(s): ${payload.data.synced} settled, ${payload.data.pending} still pending, ${payload.data.failed} failed.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Batch payout sync failed.', 'error')
    } finally {
      setSyncingAllPayouts(false)
    }
  }

  async function requeueEvent(eventId: string) {
    setRequeueingEventId(eventId)
    try {
      const response = await fetch(`/api/admin/provider-events/${encodeURIComponent(eventId)}/requeue`, { method: 'PATCH', credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Provider event requeue failed.')
      await reloadProviderEvents()
      await reloadProviderDiagnosticsReport()
      if (referenceCase?.providerEvents.some(item => item.externalEventId === eventId)) await inspectReference(referenceCase.reference)
      showToast(`Provider event ${eventId} requeued.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Provider event requeue failed.', 'error')
    } finally {
      setRequeueingEventId(null)
    }
  }

  async function runWebhookAcceptanceTest() {
    setRunningWebhookTest(true)
    try {
      const parsed = JSON.parse(webhookTestPayload)
      const response = await fetch('/api/admin/flutterwave/webhook-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ payload: parsed }),
      })
      const payload = await response.json()
      setWebhookTestResult({ status: response.status, body: payload })
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Webhook acceptance test failed.')
      await Promise.all([reloadSettlementQueues(), reloadProviderEvents(), reloadProviderDiagnosticsReport()])
      showToast('Webhook acceptance test processed.')
    } catch (error) {
      setWebhookTestResult(current => current ?? { status: 0, body: { error: error instanceof Error ? error.message : 'Webhook acceptance test failed.' } })
      showToast(error instanceof Error ? error.message : 'Webhook acceptance test failed.', 'error')
    } finally {
      setRunningWebhookTest(false)
    }
  }

  async function refreshCryptoMarketSnapshotsNow() {
    setRefreshingCryptoMarket(true)
    try {
      const response = await fetch('/api/admin/crypto-market/refresh', { method: 'POST', credentials: 'include' })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Crypto market refresh failed.')
      setCryptoMarketHealth(payload.data?.health ?? null)
      if (Array.isArray(payload.data?.assets)) {
        adoptPersistedCryptoPricing(payload.data.assets)
        await refreshCryptoAssets(payload.data.assets)
      } else {
        await refreshCryptoAssets()
      }
      showToast('Crypto market snapshots refreshed.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Crypto market refresh failed.', 'error')
    } finally {
      setRefreshingCryptoMarket(false)
    }
  }

  const visibleCryptoPricing = cryptoPricing.filter(item => cryptoCatalogFilter === 'active' ? item.isActive !== false : cryptoCatalogFilter === 'archived' ? item.isActive === false : true)
  const dirtyCryptoPairIds = dirtyIdsBetween(cryptoPricing, savedCryptoPricing)
  const dirtyCryptoPairIdSet = new Set<string>(dirtyCryptoPairIds)
  const hasUnsavedCryptoEdits = dirtyCryptoPairIds.length > 0
  const dirtyRewardRuleIds = dirtyIdsBetween(rewardRules, savedRewardRules)
  const dirtyRewardRuleIdSet = new Set<string>(dirtyRewardRuleIds)
  const hasUnsavedRewardEdits = dirtyRewardRuleIds.length > 0
  const dirtyBillProviderIds = dirtyIdsBetween(billProviderCatalog, savedBillProviderCatalog)
  const dirtyBillProviderIdSet = new Set<string>(dirtyBillProviderIds)
  const hasUnsavedBillEdits = dirtyBillProviderIds.length > 0
  const hasUnsavedCatalogEdits = hasUnsavedCryptoEdits || hasUnsavedRewardEdits || hasUnsavedBillEdits

  // Last line of defence: an accidental refresh or tab close while an editor still holds unsaved
  // edits. The browser owns the wording — all we can do is ask it to confirm.
  useEffect(() => {
    if (!hasUnsavedCatalogEdits) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedCatalogEdits])
  const draftMarketPreview = getDraftMarketPreview()
  const draftMarketRatePreview = draftMarketPreview.marketRate
  const draftMarketPriceUsdPreview = draftMarketPreview.marketPriceUsd
  const visibleBillProviders = billProviderCatalog.filter(item => billCatalogFilter === 'active' ? item.isActive !== false : billCatalogFilter === 'archived' ? item.isActive === false : true)
  const filteredKycItems = kycFundingFilter === 'funding_only' ? kycItems.filter(item => item.documentType === 'bvn' || item.documentType === 'nin') : kycItems
  const flutterwaveIssueEvents = providerEvents.filter(item => item.provider.toLowerCase().includes('flutterwave') && (item.status.toLowerCase() === 'failed' || !item.processedAt || item.externalEventId.startsWith('init:'))).slice(0, 8)
  const flutterwaveIssuePayouts = payoutRequests.filter(item => item.provider.toLowerCase().includes('flutterwave') || item.provider.toLowerCase().includes('bank_')).filter(item => item.status === 'failed' || item.providerStatus === 'FAILED' || item.providerStatus === 'TOKEN_ERROR' || item.providerStatus === 'REQUEST_ERROR').slice(0, 8)
  const flutterwaveIssueDeposits = depositIntents.filter(item => item.provider.toLowerCase().includes('flutterwave')).filter(item => item.status === 'failed' || item.providerStatus === 'failed' || item.providerStatus === 'NOT_CONFIGURED' || item.providerStatus === 'REQUEST_ERROR').slice(0, 8)
  const flutterwaveDepositEvents = providerEvents.filter(item => item.provider.toLowerCase().includes('flutterwave') && (item.payload?.event === 'charge.completed' || item.reference.startsWith('static_va_'))).filter(item => item.status.toLowerCase() === 'failed' || !item.processedAt).slice(0, 8)

  return {
    user,
    loading,
    authorized,
    ADMIN_ENDPOINTS,
    CRYPTO_NETWORK_OPTIONS,
    CRYPTO_EXECUTION_RAIL_OPTIONS,
    ROUTED_ADDRESS_FAMILY_OPTIONS,
    ROUTED_PROFILE_OPTIONS,
    BILL_PROVIDER_TYPES,
    REWARD_KIND_OPTIONS,
    REWARD_TRIGGER_OPTIONS,
    REWARD_AUDIENCE_OPTIONS,
    REWARD_TRANSACTION_TYPE_OPTIONS,
    CRYPTO_LOGO_SUGGESTIONS,
    BILL_ICON_SUGGESTIONS,
    renderPricingSourceLabel,
    renderPriceFreshness,
    parseOptionalNumber,
    findRoutedProfileForAsset,
    getRoutedProfileConfig,
    saving,
    savingCryptoPricing,
    users,
    auditLogs,
    providerEvents,
    depositIntents,
    payoutRequests,
    cryptoOrders,
    cryptoPricing,
    setCryptoPricing,
    cryptoCatalogFilter,
    setCryptoCatalogFilter,
    billProviderCatalog,
    setBillProviderCatalog,
    rewardRules,
    setRewardRules,
    rewardRuleReport,
    providerDiagnosticsReport,
    refreshingProviderDiagnostics,
    refreshingSettlementQueues,
    refreshingProviderEvents,
    billCatalogFilter,
    setBillCatalogFilter,
    savingBillProviders,
    savingRewardRules,
    reviewingRewardRequestId,
    customRoutedProfileIds,
    setCustomRoutedProfileIds,
    newBillProvider,
    setNewBillProvider,
    newRewardRule,
    setNewRewardRule,
    newCryptoAsset,
    setNewCryptoAsset,
    referenceCase,
    flutterwaveHealth,
    flutterwaveBillsHealth,
    baseExecutorHealth,
    zeroExHealth,
    cryptoMarketHealth,
    baseTreasuryBalances,
    refreshingCryptoMarket,
    transactions,
    selectedTransactionId,
    ledgerTrace,
    kycItems,
    reviewingId,
    updatingUserId,
    resolvingReference,
    requeueingReference,
    resolvingCryptoOrderId,
    updatingCryptoExecutionId,
    broadcastingCryptoOrderId,
    syncingBaseReceiptOrderId,
    syncingAllBaseReceipts,
    syncingCryptoOrderId,
    uploadingCryptoLogoId,
    loadingReferenceCase,
    syncingAllPayouts,
    requeueingEventId,
    reviewNotes,
    setReviewNotes,
    kycFundingFilter,
    setKycFundingFilter,
    settlementSearch,
    setSettlementSearch,
    settlementStatusFilter,
    setSettlementStatusFilter,
    settlementProviderFilter,
    setSettlementProviderFilter,
    providerEventStatusFilter,
    setProviderEventStatusFilter,
    providerEventProviderFilter,
    setProviderEventProviderFilter,
    webhookTestPayload,
    setWebhookTestPayload,
    runningWebhookTest,
    webhookTestResult,
    drafts,
    setDrafts,
    saveConfig,
    saveCryptoPricing,
    saveCryptoPair,
    savingCryptoPairId,
    discardCryptoPairEdits,
    dirtyCryptoPairIds,
    dirtyCryptoPairIdSet,
    hasUnsavedCryptoEdits,
    uploadCryptoLogo,
    contractLookupAddress,
    setContractLookupAddress,
    lookingUpContract,
    contractLookup,
    lookupCryptoToken,
    resetContractLookup,
    primeNewCryptoAssetDefaults,
    applyNewAssetRoutedProfile,
    createCryptoPair,
    setCryptoPairArchived,
    draftMarketRatePreview,
    draftMarketPriceUsdPreview,
    visibleCryptoPricing,
    toggleRewardTransactionType,
    createRewardRule,
    reviewRewardRequest,
    saveRewardRuleCatalog,
    saveRewardRule,
    savingRewardRuleId,
    discardRewardRuleEdits,
    dirtyRewardRuleIds,
    dirtyRewardRuleIdSet,
    hasUnsavedRewardEdits,
    createBillProvider,
    setBillProviderArchived,
    visibleBillProviders,
    saveBillProviderCatalog,
    saveBillProvider,
    savingBillProviderId,
    discardBillProviderEdits,
    dirtyBillProviderIds,
    dirtyBillProviderIdSet,
    hasUnsavedBillEdits,
    resolveCryptoOrder,
    updateCryptoExecution,
    broadcastCryptoOrder,
    executeZeroExSwap,
    syncBaseReceipt,
    syncAllBaseReceipts,
    syncCryptoOrder,
    reviewKyc,
    updateUserStatus,
    filteredKycItems,
    inspectLedger,
    reloadSettlementQueues,
    reloadProviderEvents,
    reloadProviderDiagnosticsReport,
    inspectReference,
    resolveSettlement,
    requeueSettlement,
    syncAllPendingPayouts,
    requeueEvent,
    runWebhookAcceptanceTest,
    refreshCryptoMarketSnapshotsNow,
    flutterwaveIssueEvents,
    flutterwaveIssuePayouts,
    flutterwaveIssueDeposits,
    flutterwaveDepositEvents,
    cryptoDepositEvents,
    recentSweepGasStats,
    reloadCryptoDepositEvents: async (overrides?: { status?: string; sweepStatus?: string; pairId?: string }) => {
      setRefreshingCryptoDepositEvents(true)
      try {
        const params = new URLSearchParams({ limit: '80' })
        const status = overrides?.status ?? (cryptoDepositStatusFilter !== 'all' ? cryptoDepositStatusFilter : undefined)
        const sweep = overrides?.sweepStatus ?? (cryptoDepositSweepFilter !== 'all' ? cryptoDepositSweepFilter : undefined)
        const pair = overrides?.pairId ?? (cryptoDepositPairFilter || undefined)
        if (status) params.set('status', status)
        if (sweep) params.set('sweepStatus', sweep)
        if (pair) params.set('pairId', pair)
        const res = await fetchAdminJson<any>(`/api/admin/crypto-deposits?${params.toString()}`)
        const events = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : [])
        setCryptoDepositEvents(events)
        const gasStats = Array.isArray(res?.recentGasStats) ? res.recentGasStats : []
        setRecentSweepGasStats(gasStats)
      } catch {
        // ignore
      } finally {
        setRefreshingCryptoDepositEvents(false)
      }
    },
    triggerCryptoDepositSync: async () => {
      await fetch('/api/admin/crypto-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ intent: 'sync' }),
      })
    },
    forceScanCryptoDepositAddress: async (address: string, pairId?: string) => {
      const res = await fetch('/api/admin/crypto-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ intent: 'force-scan', address, pairId }),
      })
      return res.json()
    },
    resweepCryptoDepositEvent: async (externalEventId: string) => {
      const res = await fetch('/api/admin/crypto-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ intent: 'resweep', externalEventId }),
      })
      const payload = await res.json()
      return payload
    },
    cryptoDepositStatusFilter,
    setCryptoDepositStatusFilter,
    cryptoDepositSweepFilter,
    setCryptoDepositSweepFilter,
    cryptoDepositPairFilter,
    setCryptoDepositPairFilter,
    cryptoDepositSearch,
    setCryptoDepositSearch,
    refreshingCryptoDepositEvents,
  }
}

export type AdminWorkspaceState = ReturnType<typeof useAdminWorkspace>
