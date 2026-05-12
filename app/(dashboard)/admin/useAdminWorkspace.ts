'use client'

import { useEffect, useState } from 'react'
import { refreshCryptoAssets } from '@/lib/client/catalogs'
import { computeBuyRate, computeSellRate, getDefaultCryptoMarketSourceId } from '@/lib/crypto-market'
import { buildCryptoPairId } from '@/lib/routed-assets'
import { useAppStore } from '@/store'
import type { AuditLog, BillProvider, CryptoAsset, CryptoOrder, DepositIntent, LedgerEntry, PayoutRequest, ProviderDiagnosticsReport, ProviderEvent, RewardAwardRequest, RewardRule, RewardRuleReport, Transaction, User } from '@/types'
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
    cngn: string
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

type TransakHealth = {
  criticalChecks: AdminCriticalCheck[]
  env: string
  configured: boolean
  apiKeyConfigured: boolean
  apiSecretConfigured: boolean
  referrerDomainConfigured: boolean
  redirectUrlConfigured: boolean
  warnings: string[]
}

type CngnHealth = {
  criticalChecks: AdminCriticalCheck[]
  baseUrl: string
  merchantEnabled: boolean
  apiKeyConfigured: boolean
  encryptionKeyConfigured: boolean
  privateKeyConfigured: boolean
  sodiumAvailable: boolean
  webhookUrlConfigured: boolean
  warnings: string[]
}

export function useAdminWorkspace() {
  const { showToast, user } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(true)
  const [showLegacyRailsHealth, setShowLegacyRailsHealth] = useState(false)
  const [saving, setSaving] = useState<AdminKey | null>(null)
  const [savingCryptoPricing, setSavingCryptoPricing] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [providerEvents, setProviderEvents] = useState<ProviderEvent[]>([])
  const [depositIntents, setDepositIntents] = useState<DepositIntent[]>([])
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([])
  const [cryptoOrders, setCryptoOrders] = useState<CryptoOrder[]>([])
  const [cryptoPricing, setCryptoPricing] = useState<CryptoAsset[]>([])
  const [cryptoCatalogFilter, setCryptoCatalogFilter] = useState<CryptoCatalogFilter>('all')
  const [billProviderCatalog, setBillProviderCatalog] = useState<BillProvider[]>([])
  const [rewardRules, setRewardRules] = useState<RewardRule[]>([])
  const [rewardRuleReport, setRewardRuleReport] = useState<RewardRuleReport | null>(null)
  const [providerDiagnosticsReport, setProviderDiagnosticsReport] = useState<ProviderDiagnosticsReport | null>(null)
  const [refreshingProviderDiagnostics, setRefreshingProviderDiagnostics] = useState(false)
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
    allowedTransactionTypes: string[]
    excludedTransactionTypes: string[]
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
    buySpreadBps: number
    sellSpreadBps: number
    quoteTtlSeconds: number
    isActive: boolean
    transakEnabled: boolean
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
    buySpreadBps: 180,
    sellSpreadBps: 180,
    quoteTtlSeconds: 90,
    isActive: true,
    transakEnabled: false,
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
  const [transakHealth, setTransakHealth] = useState<TransakHealth | null>(null)
  const [baseExecutorHealth, setBaseExecutorHealth] = useState<BaseExecutorHealth | null>(null)
  const [zeroExHealth, setZeroExHealth] = useState<ZeroExHealth | null>(null)
  const [cryptoMarketHealth, setCryptoMarketHealth] = useState<CryptoMarketHealth | null>(null)
  const [baseTreasuryBalances, setBaseTreasuryBalances] = useState<BaseTreasuryBalances | null>(null)
  const [cngnHealth, setCngnHealth] = useState<CngnHealth | null>(null)
  const [refreshingCryptoMarket, setRefreshingCryptoMarket] = useState(false)
  const [runningCngnAction, setRunningCngnAction] = useState<'balance' | 'create_virtual_account' | null>(null)
  const [cngnTestResult, setCngnTestResult] = useState<string | null>(null)
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
    merchants: '[]',
    assets: '[]',
    rewardRules: '[]',
    billProviders: '[]',
    networkProviders: '[]',
  })

  useEffect(() => {
    let active = true

    void Promise.all([
      Promise.all(ADMIN_ENDPOINTS.map(async config => {
        const response = await fetch(config.get, { credentials: 'include', cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Failed to load admin catalog.')
        }
        return [config.key, JSON.stringify(payload.data, null, 2)] as const
      })),
      fetch('/api/admin/kyc', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load KYC queue.')
        return payload.data
      }),
      fetch('/api/admin/users', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load users.')
        return payload.data
      }),
      fetch('/api/admin/audit-logs?limit=40', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load audit logs.')
        return payload.data
      }),
      fetch('/api/admin/provider-events?limit=30', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load provider events.')
        return payload.data
      }),
      fetch('/api/admin/provider-events/report', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load provider diagnostics.')
        return payload.data
      }),
      fetch('/api/admin/transactions?limit=30', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load transactions.')
        return payload.data
      }),
      fetch('/api/admin/deposit-intents?limit=20', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load deposit intents.')
        return payload.data
      }),
      fetch('/api/admin/payout-requests?limit=20', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load payout requests.')
        return payload.data
      }),
      fetch('/api/admin/flutterwave/health', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load Flutterwave health.')
        return payload.data
      }),
      fetch('/api/admin/flutterwave/bills-health', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load Flutterwave bills health.')
        return payload.data
      }),
      fetch('/api/admin/transak/health', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load Transak health.')
        return payload.data
      }),
      fetch('/api/admin/base/health', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load Base executor health.')
        return payload.data
      }),
      fetch('/api/admin/zerox/health', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load 0x health.')
        return payload.data
      }),
      fetch('/api/admin/crypto-market/health', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load crypto market health.')
        return payload.data
      }),
      fetch('/api/admin/base/treasury', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load Base treasury balances.')
        return payload.data
      }),
      fetch('/api/admin/cngn/health', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load cNGN health.')
        return payload.data
      }),
      fetch('/api/admin/crypto-assets', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load crypto pricing.')
        return payload.data
      }),
      fetch('/api/admin/crypto-orders?status=pending&limit=20', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load crypto orders.')
        return payload.data
      }),
      fetch('/api/admin/reward-rules/report?limit=20', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Failed to load reward report.')
        return payload.data
      }),
    ])
      .then(([entries, kyc, loadedUsers, loadedAuditLogs, loadedProviderEvents, loadedProviderDiagnosticsReport, loadedTransactions, loadedDepositIntents, loadedPayoutRequests, loadedFlutterwaveHealth, loadedFlutterwaveBillsHealth, loadedTransakHealth, loadedBaseExecutorHealth, loadedZeroExHealth, loadedCryptoMarketHealth, loadedBaseTreasuryBalances, loadedCngnHealth, loadedCryptoPricing, loadedCryptoOrders, loadedRewardRuleReport]) => {
        if (!active) return
        setDrafts(current => {
          const next = { ...current }
          for (const [key, value] of entries) next[key] = value
          return next
        })
        setKycItems(Array.isArray(kyc) ? kyc : [])
        setUsers(Array.isArray(loadedUsers) ? loadedUsers : [])
        setAuditLogs(Array.isArray(loadedAuditLogs) ? loadedAuditLogs : [])
        setProviderEvents(Array.isArray(loadedProviderEvents) ? loadedProviderEvents : [])
        setProviderDiagnosticsReport(loadedProviderDiagnosticsReport ?? null)
        setTransactions(Array.isArray(loadedTransactions) ? loadedTransactions : [])
        setDepositIntents(Array.isArray(loadedDepositIntents) ? loadedDepositIntents : [])
        setPayoutRequests(Array.isArray(loadedPayoutRequests) ? loadedPayoutRequests : [])
        setFlutterwaveHealth(loadedFlutterwaveHealth ?? null)
        setFlutterwaveBillsHealth(loadedFlutterwaveBillsHealth ?? null)
        setTransakHealth(loadedTransakHealth ?? null)
        setBaseExecutorHealth(loadedBaseExecutorHealth ?? null)
        setZeroExHealth(loadedZeroExHealth ?? null)
        setCryptoMarketHealth(loadedCryptoMarketHealth ?? null)
        setBaseTreasuryBalances(loadedBaseTreasuryBalances ?? null)
        setCngnHealth(loadedCngnHealth ?? null)
        setCryptoPricing(Array.isArray(loadedCryptoPricing) ? loadedCryptoPricing : [])
        try {
          const parsedRewardRules = JSON.parse(entries.find(([key]) => key === 'rewardRules')?.[1] ?? '[]')
          setRewardRules(Array.isArray(parsedRewardRules) ? parsedRewardRules : [])
        } catch {
          setRewardRules([])
        }
        try {
          const parsedBillProviders = JSON.parse(entries.find(([key]) => key === 'billProviders')?.[1] ?? '[]')
          setBillProviderCatalog(Array.isArray(parsedBillProviders) ? parsedBillProviders : [])
        } catch {
          setBillProviderCatalog([])
        }
        setCryptoOrders(Array.isArray(loadedCryptoOrders) ? loadedCryptoOrders : [])
        setRewardRuleReport(loadedRewardRuleReport ?? null)
      })
      .catch(() => {
        if (active) setAuthorized(false)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

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
      setDrafts(current => ({ ...current, [key]: JSON.stringify(payload.data, null, 2) }))
      showToast(`${config.title} updated.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Save failed.', 'error')
    } finally {
      setSaving(null)
    }
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
    return Array.isArray(payload.data) ? payload.data as CryptoAsset[] : normalizedAssets
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
      setCryptoPricing(persistedAssets)
      setDrafts(current => ({ ...current, assets: JSON.stringify(persistedAssets, null, 2) }))
      showToast('Crypto pricing updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Crypto pricing update failed.', 'error')
    } finally {
      setSavingCryptoPricing(false)
    }
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
        setCryptoPricing(persistedAssets)
        setDrafts(current => ({ ...current, assets: JSON.stringify(persistedAssets, null, 2) }))
      }
      showToast(target.pairId ? 'Logo uploaded and saved.' : 'Logo uploaded.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Logo upload failed.', 'error')
    } finally {
      setUploadingCryptoLogoId(null)
    }
  }

  function getDraftMarketRatePreview() {
    const symbol = newCryptoAsset.symbol.trim().toUpperCase()
    const marketSourceId = newCryptoAsset.marketSourceId.trim() || getDefaultCryptoMarketSourceId(symbol)
    if (!marketSourceId) return 0
    return cryptoPricing.find(asset => asset.marketSourceId === marketSourceId)?.marketRate ?? 0
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

  async function addCryptoAssetDraft() {
    const symbol = newCryptoAsset.symbol.trim().toUpperCase()
    const name = newCryptoAsset.name.trim()
    const icon = newCryptoAsset.icon.trim() || CRYPTO_LOGO_SUGGESTIONS[symbol] || symbol.slice(0, 1) || '¤'
    const marketSourceId = newCryptoAsset.marketSourceId.trim() || getDefaultCryptoMarketSourceId(symbol)
    const marketRatePreview = getDraftMarketRatePreview()
    if (!symbol || !name) return showToast('Symbol and asset name are required.', 'error')
    if (!marketSourceId) return showToast('Live price feed ID is required for new crypto pairs.', 'error')
    const id = buildCryptoPairId(symbol, newCryptoAsset.network)
    if (cryptoPricing.some(item => item.id === id)) return showToast(`${id} already exists. Edit the existing pair instead.`, 'error')

    const asset: CryptoAsset = {
      id: id as CryptoAsset['id'],
      symbol: symbol as CryptoAsset['symbol'],
      name,
      network: newCryptoAsset.network,
      icon,
      marketSourceId,
      marketRate: marketRatePreview,
      buySpreadBps: newCryptoAsset.buySpreadBps,
      sellSpreadBps: newCryptoAsset.sellSpreadBps,
      buyRate: marketRatePreview > 0 ? computeBuyRate(marketRatePreview, newCryptoAsset.buySpreadBps) : 0,
      sellRate: marketRatePreview > 0 ? computeSellRate(marketRatePreview, newCryptoAsset.sellSpreadBps) : 0,
      quoteTtlSeconds: newCryptoAsset.quoteTtlSeconds,
      isActive: newCryptoAsset.isActive,
      transakEnabled: newCryptoAsset.transakEnabled,
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
      const nextAssets = [normalizeCryptoAssetForPersist(asset), ...cryptoPricing]
      setCryptoPricing(nextAssets)
      const persistedAssets = await persistCryptoPricing(nextAssets)
      setCryptoPricing(persistedAssets)
      setDrafts(current => ({ ...current, assets: JSON.stringify(persistedAssets, null, 2) }))
      setNewCryptoAsset({
        symbol: '',
        name: '',
        network: 'Base',
        icon: '',
        marketSourceId: '',
        buySpreadBps: 180,
        sellSpreadBps: 180,
        quoteTtlSeconds: 90,
        isActive: true,
        transakEnabled: false,
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
      transakEnabled: archived ? false : asset.transakEnabled,
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
    setRewardRuleReport(reportPayload.data ?? null)
  }

  async function saveRewardRuleCatalog() {
    try {
      setSavingRewardRules(true)
      const normalizedRules = rewardRules.map(normalizeRewardRuleForPersist)
      const response = await fetch('/api/admin/reward-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rules: normalizedRules }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Reward rule update failed.')
      setRewardRules(Array.isArray(payload.data) ? payload.data : [])
      setDrafts(current => ({ ...current, rewardRules: JSON.stringify(payload.data, null, 2) }))
      await refreshRewardRuleReport()
      showToast('Reward rules updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Reward rule update failed.', 'error')
    } finally {
      setSavingRewardRules(false)
    }
  }

  function toggleRewardTransactionType(current: string[], value: Transaction['type']) {
    return current.includes(value) ? current.filter(item => item !== value) : [...current, value]
  }

  function addRewardRuleDraft() {
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
    setRewardRules(current => [draftRule, ...current])
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
    showToast(`${draftRule.name} added to the draft list. Save reward rules to persist it.`)
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
      setRewardRuleReport(payload.data ?? null)
      showToast(action === 'approve' ? 'Reward request approved.' : 'Reward request rejected.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Reward request update failed.', 'error')
    } finally {
      setReviewingRewardRequestId(null)
    }
  }

  async function saveBillProviderCatalog() {
    try {
      setSavingBillProviders(true)
      const response = await fetch('/api/admin/bill-providers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ providers: billProviderCatalog }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Bill provider update failed.')
      setBillProviderCatalog(Array.isArray(payload.data) ? payload.data : [])
      setDrafts(current => ({ ...current, billProviders: JSON.stringify(payload.data, null, 2) }))
      showToast('Bill providers updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Bill provider update failed.', 'error')
    } finally {
      setSavingBillProviders(false)
    }
  }

  function addBillProviderDraft() {
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

    setBillProviderCatalog(current => [provider, ...current])
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
    showToast(`${name} added to the draft list. Save bill providers to persist it.`)
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
      showToast('Crypto order synced from Transak.')
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
  }

  async function reloadProviderEvents(status = providerEventStatusFilter, provider = providerEventProviderFilter, reference = settlementSearch) {
    const params = new URLSearchParams({ limit: '30' })
    if (status !== 'all') params.set('status', status)
    if (provider.trim()) params.set('provider', provider.trim())
    if (reference.trim()) params.set('reference', reference.trim())
    const response = await fetch(`/api/admin/provider-events?${params.toString()}`, { credentials: 'include', cache: 'no-store' })
    const payload = await response.json()
    if (response.ok && payload.success !== false && Array.isArray(payload.data)) setProviderEvents(payload.data)
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

  async function runCngnTest(action: 'balance' | 'create_virtual_account') {
    setRunningCngnAction(action)
    try {
      const response = await fetch('/api/admin/cngn/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      })
      const payload = await response.json()
      setCngnTestResult(JSON.stringify(payload, null, 2))
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'cNGN test failed.')
      showToast(action === 'balance' ? 'Loaded cNGN balances.' : 'Created cNGN virtual account.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'cNGN test failed.', 'error')
    } finally {
      setRunningCngnAction(null)
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
        setCryptoPricing(payload.data.assets)
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
  const draftMarketRatePreview = getDraftMarketRatePreview()
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
    showLegacyRailsHealth,
    setShowLegacyRailsHealth,
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
    transakHealth,
    baseExecutorHealth,
    zeroExHealth,
    cryptoMarketHealth,
    baseTreasuryBalances,
    cngnHealth,
    refreshingCryptoMarket,
    runningCngnAction,
    cngnTestResult,
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
    uploadCryptoLogo,
    applyNewAssetRoutedProfile,
    addCryptoAssetDraft,
    setCryptoPairArchived,
    draftMarketRatePreview,
    visibleCryptoPricing,
    toggleRewardTransactionType,
    addRewardRuleDraft,
    reviewRewardRequest,
    saveRewardRuleCatalog,
    addBillProviderDraft,
    setBillProviderArchived,
    visibleBillProviders,
    saveBillProviderCatalog,
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
    runCngnTest,
    refreshCryptoMarketSnapshotsNow,
    flutterwaveIssueEvents,
    flutterwaveIssuePayouts,
    flutterwaveIssueDeposits,
    flutterwaveDepositEvents,
  }
}

export type AdminWorkspaceState = ReturnType<typeof useAdminWorkspace>
