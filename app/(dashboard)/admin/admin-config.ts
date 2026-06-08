'use client'

import { ROUTED_TREASURY_PAIR_CONFIG } from '@/lib/routed-assets'
import type { AuditLog, BillProvider, CryptoAsset, CryptoOrder, DepositIntent, LedgerEntry, PayoutRequest, ProviderEvent, RewardRule, Transaction } from '@/types'

export const ADMIN_ENDPOINTS = [
  { key: 'merchants', title: 'P2P Merchants', get: '/api/admin/p2p-merchants', patch: '/api/admin/p2p-merchants', bodyKey: 'merchants' },
  { key: 'assets', title: 'Crypto Assets', get: '/api/admin/crypto-assets', patch: '/api/admin/crypto-assets', bodyKey: 'assets' },
  { key: 'rewardRules', title: 'Reward Rules', get: '/api/admin/reward-rules', patch: '/api/admin/reward-rules', bodyKey: 'rules' },
  { key: 'billProviders', title: 'Bill Providers', get: '/api/admin/bill-providers', patch: '/api/admin/bill-providers', bodyKey: 'providers' },
  { key: 'networkProviders', title: 'Network Providers', get: '/api/admin/network-providers', patch: '/api/admin/network-providers', bodyKey: 'providers' },
] as const

export type AdminKey = (typeof ADMIN_ENDPOINTS)[number]['key']

export type ReferenceCase = {
  reference: string
  transaction: { userId: string; transaction: Transaction } | null
  cryptoOrder: CryptoOrder | null
  depositIntent: DepositIntent | null
  payoutRequest: PayoutRequest | null
  providerEvents: ProviderEvent[]
  ledgerEntries: LedgerEntry[]
  auditLogs: AuditLog[]
}

export const ADMIN_SECTIONS = [
  { id: 'operations', label: 'Operations' },
  { id: 'health', label: 'Health' },
  { id: 'users', label: 'Users' },
  { id: 'catalogs', label: 'Catalogs' },
] as const

export type AdminSection = (typeof ADMIN_SECTIONS)[number]['id']
export type AdminSubmodule =
  | 'assets'
  | 'rewards'
  | 'bills'
  | 'raw'
  | 'kyc'
  | 'accounts'
  | 'audit'
  | 'orders'
  | 'settlements'
  | 'events'
  | 'support'
  | 'rails'
  | 'providers'
  | 'market'
  | 'crypto-deposits'
export type CryptoCatalogFilter = 'all' | 'active' | 'archived'
export type BillCatalogFilter = 'all' | 'active' | 'archived'

export const ADMIN_MODULE_TREE = [
  {
    label: 'Administration',
    items: [
      { href: '/admin', label: 'Overview', description: 'Admin index and module summary' },
    ],
  },
  {
    label: 'Catalogs',
    items: [
      { href: '/admin/catalogs', label: 'Catalogs', description: 'Module overview' },
      { href: '/admin/catalogs/assets', label: 'Crypto Assets', description: 'Asset pricing, execution, pair creation' },
      { href: '/admin/catalogs/rewards', label: 'Reward Rules', description: 'Rules, awards, review queue' },
      { href: '/admin/catalogs/bills', label: 'Bill Providers', description: 'Bill services and provider catalog' },
      { href: '/admin/catalogs/raw', label: 'Raw Catalog Data', description: 'Low-level JSON editors for remaining catalogs' },
    ],
  },
  {
    label: 'Users',
    items: [
      { href: '/admin/users', label: 'Users', description: 'Module overview' },
      { href: '/admin/users/kyc', label: 'KYC Queue', description: 'Review KYC submissions' },
      { href: '/admin/users/accounts', label: 'Accounts', description: 'User account access control' },
      { href: '/admin/users/audit', label: 'Audit Trail', description: 'Audit activity and operator trace' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/operations', label: 'Operations', description: 'Module overview' },
      { href: '/admin/operations/orders', label: 'Crypto Orders', description: 'Order execution and receipt syncs' },
      { href: '/admin/operations/settlements', label: 'Settlements', description: 'Deposit and payout settlement actions' },
      { href: '/admin/operations/events', label: 'Provider Events', description: 'Provider event review and requeue tools' },
      { href: '/admin/operations/crypto-deposits', label: 'Crypto Deposits', description: 'User crypto deposit events, scanner detection, sweep status, and force scan tools' },
      { href: '/admin/operations/support', label: 'Support Tools', description: 'Webhook tests, ledger traces, reference support' },
    ],
  },
  {
    label: 'Health',
    items: [
      { href: '/admin/health', label: 'Health', description: 'Module overview' },
      { href: '/admin/health/rails', label: 'Rails', description: 'Base executor, treasury, and 0x rail checks' },
      { href: '/admin/health/providers', label: 'Providers', description: 'Flutterwave and provider-side health' },
      { href: '/admin/health/market', label: 'Market', description: 'Crypto market freshness and cache health' },
    ],
  },
] as const

export const CRYPTO_NETWORK_OPTIONS: CryptoAsset['network'][] = ['Base', 'BSC', 'Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Linea', 'Solana', 'Sui', 'TON', 'NEAR']
export const CRYPTO_EXECUTION_RAIL_OPTIONS: Array<{ value: NonNullable<CryptoAsset['executionRail']> | ''; label: string }> = [
  { value: '', label: 'Catalog Only' },
  { value: 'routed_treasury', label: 'Routed Treasury' },
  { value: 'base_treasury', label: 'Base Treasury' },
  { value: 'sui_treasury', label: 'SUI Treasury' },
  { value: 'ton_treasury', label: 'TON Treasury' },
  { value: 'near_intents', label: 'NEAR Intents' },
]
export const ROUTED_ADDRESS_FAMILY_OPTIONS: Array<NonNullable<CryptoAsset['routedAddressFamily']>> = ['evm', 'solana']
export const ROUTED_PROFILE_OPTIONS = Object.values(ROUTED_TREASURY_PAIR_CONFIG).map(config => ({
  value: config.pairId,
  label: `${config.symbol} on ${config.network}`,
  config,
}))
export const BILL_PROVIDER_TYPES: BillProvider['type'][] = ['airtime', 'data', 'electric', 'cable', 'education', 'gas', 'insurance', 'water']
export const REWARD_KIND_OPTIONS: RewardRule['kind'][] = ['referral', 'bonus']
export const REWARD_TRIGGER_OPTIONS: RewardRule['triggerEvent'][] = ['user_signup', 'first_successful_transaction']
export const REWARD_AUDIENCE_OPTIONS: RewardRule['audience'][] = ['actor', 'inviter']
export const REWARD_TRANSACTION_TYPE_OPTIONS: Transaction['type'][] = [
  'deposit',
  'withdrawal',
  'transfer_in',
  'transfer_out',
  'airtime',
  'data',
  'electric',
  'cable',
  'education',
  'gas',
  'insurance',
  'water',
  'crypto_buy',
  'crypto_sell',
  'p2p_deposit',
  'p2p_withdrawal',
]
export const CRYPTO_LOGO_SUGGESTIONS: Record<string, string> = {
  USDT: '/crypto-assets/usdt.png',
  USDC: '/crypto-assets/usdc.png',
  ETH: '/crypto-assets/eth.png',
  POL: '',
  SOL: '/crypto-assets/sol.png',
  SUI: '/crypto-assets/sui.svg',
  BNB: '/crypto-assets/bnb.png',
  TON: '/crypto-assets/ton.svg',
  NEAR: '/crypto-assets/near.svg',
}
export const BILL_ICON_SUGGESTIONS: Record<BillProvider['type'], string> = {
  airtime: '📱',
  data: '🌐',
  electric: '⚡',
  cable: '📺',
  education: '🎓',
  gas: '⛽',
  insurance: '🏥',
  water: '🚰',
}

export function renderPricingSourceLabel(source?: CryptoAsset['pricingSource']) {
  return source === 'live' ? 'Live Price' : source === 'backup' ? 'Cached Price' : 'Price Unavailable'
}

export function renderPriceFreshness(updatedAt?: string | null) {
  return updatedAt
    ? `Updated ${new Date(updatedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : 'No cached timestamp'
}

export function parseOptionalNumber(value?: string | number | null) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function findRoutedProfileForAsset(asset: Pick<CryptoAsset, 'id' | 'symbol' | 'network' | 'executionRail' | 'routedToChain' | 'routedToToken' | 'routedDecimals' | 'routedAddressFamily' | 'minimumBuyNgn' | 'maxQuoteDriftPercent'>) {
  if (asset.executionRail !== 'routed_treasury') return ''

  const matched = ROUTED_PROFILE_OPTIONS.find(option => (
    option.config.network === asset.network
    && option.config.symbol === asset.symbol
    && option.config.toChain === (asset.routedToChain ?? '')
    && option.config.toToken === (asset.routedToToken ?? '')
    && option.config.decimals === asset.routedDecimals
    && option.config.addressFamily === asset.routedAddressFamily
    && option.config.minimumBuyNgn === asset.minimumBuyNgn
    && option.config.maxQuoteDriftPercent === asset.maxQuoteDriftPercent
  ))

  return matched?.value ?? 'custom'
}

export function getRoutedProfileConfig(profileId: string) {
  return ROUTED_PROFILE_OPTIONS.find(option => option.value === profileId)?.config ?? null
}
