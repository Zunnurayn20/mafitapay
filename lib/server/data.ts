import { existsSync } from 'node:fs'
import { access, mkdir, readFile } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import path from 'node:path'
import {
  BILL_PROVIDERS,
  CRYPTO_ASSETS,
  MOCK_TRANSACTIONS,
  MOCK_USER,
  MOCK_WALLET,
  NETWORK_PROVIDERS,
} from '../constants'
import { getCryptoNetworkFeeNgn, getDefaultNetworkFeeNgn, getEffectiveQuoteTtlSeconds } from '../crypto-rules'
import { getExecutionRailForAsset } from '../crypto-execution'
import { computeBuyRate, computeSellRate, DEFAULT_USD_MARGIN_NGN, getDefaultCryptoMarketSourceId } from '../crypto-market'
import { getRoutedTreasuryPairConfigForAsset, isRoutedTreasuryPairId } from '../routed-assets'
import { generateRef } from '../utils'
import { isAdminEmail } from '../admin-access'
import { hydrateCryptoAssetPricing, isCryptoMarketSnapshotFresh } from './crypto-market'
import { isPostgresEnabled, queryPostgres, queryPostgresClient, withPostgresTransaction } from './postgres'
import type { AuditLog, BankDirectoryEntry, Beneficiary, BeneficiaryVerification, BillProvider, CryptoAsset, CryptoDepositAddress, CryptoDepositEvent, CexDepositIntent, CryptoOrder, CryptoPairId, CryptoQuote, DepositIntent, KycSubmission, LedgerEntry, NetworkProvider, PayoutRequest, ProviderDiagnosticsReport, ProviderEvent, ProviderHealthSummary, ReferralEntry, ReferralOverview, RewardAwardRecord, RewardAwardRequest, RewardRule, RewardRuleReport, RewardRuleSummary, Transaction, User, Wallet } from '../../types'
import {
  settleDirectCryptoDeposit,
  settleCryptoSellDeposit,
} from './crypto-deposit-scanner'
import crypto from 'node:crypto'

type SqliteStatement = {
  run: (...args: unknown[]) => { changes?: number }
  get: (...args: unknown[]) => unknown
  all: (...args: unknown[]) => unknown[]
}

type DatabaseSync = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
}

type DatabaseSyncConstructor = new (path: string) => DatabaseSync

export interface StoredUser extends User {
  passwordHash: string
  passwordSalt: string
}

export interface SessionRecord {
  token: string
  userId: string
  expiresAt: string
  createdAt: string
  userAgent?: string
  ipAddress?: string
}

export interface PasswordResetTokenRecord {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  createdAt: string
  usedAt?: string
  userAgent?: string
  ipAddress?: string
}

export interface EmailVerificationTokenRecord {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  createdAt: string
  usedAt?: string
  userAgent?: string
  ipAddress?: string
}

interface AuthRateLimitRecord {
  id: string
  action: string
  scope: string
  createdAt: string
}

export interface NotificationRecord {
  id: string
  userId: string
  title: string
  message: string
  type: 'success' | 'error' | 'info'
  read: boolean
  createdAt: string
}

export interface PushTokenRecord {
  id: string
  userId: string
  token: string
  platform: 'android' | 'ios' | 'web'
  createdAt: string
  lastSeenAt: string
}

export interface SecuritySettingsRecord {
  userId: string
  transactionPinEnabled: boolean
  hasTransactionPin: boolean
  transactionPinLockedUntil?: string
  twoFactorEnabled: boolean
  biometricEnabled: boolean
  hasBiometricCredential: boolean
  biometricCredentialCount: number
  biometricCredentialLabel?: string
  biometricLastVerifiedAt?: string
  createdAt: string
  updatedAt: string
}

export interface BiometricCredentialRecord {
  id: string
  userId: string
  credentialId: string
  publicKey: string
  counter: number
  transports: string[]
  deviceType?: string
  backedUp: boolean
  label?: string
  createdAt: string
  lastUsedAt?: string
}

interface WalletMutationInput {
  userId: string
  asset?: 'NGN' | 'RESERVE'
  balanceDelta?: number
  lockedBalanceDelta?: number
  minimumAvailableBalance?: number
  transaction: Transaction
}

type CryptoAssetRefreshState = {
  promise?: Promise<CryptoAsset[]>
  liveOnly?: boolean
}

type CryptoMarketSchedulerState = {
  interval?: NodeJS.Timeout
  kickPromise?: Promise<CryptoAsset[]>
}

const CRYPTO_MARKET_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_CRYPTO_MARKET === '1'
const MAX_SESSIONS_PER_USER = 5
const PASSWORD_RESET_TTL_MINUTES = 30
const EMAIL_VERIFICATION_TTL_HOURS = 24
const AUTH_RATE_LIMIT_RETENTION_HOURS = 48
const TRANSACTION_PIN_LENGTH = 4
const TRANSACTION_PIN_MAX_FAILED_ATTEMPTS = 5
const TRANSACTION_PIN_LOCK_MINUTES = 15
const WEBAUTHN_CHALLENGE_TTL_MINUTES = 10
const BIOMETRIC_APPROVAL_TTL_MINUTES = 5
const DEFAULT_REWARD_RULES: RewardRule[] = [
  {
    id: 'reward_referral_inviter_first_success',
    name: 'Referral Reward',
    description: 'Pays the inviter when a referred user completes their first successful non-reward transaction.',
    kind: 'referral',
    triggerEvent: 'first_successful_transaction',
    audience: 'inviter',
    amountNgn: 200,
    requiresReferral: true,
    excludedTransactionTypes: ['referral_bonus', 'reward_bonus'],
    isActive: true,
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
  },
]

function isReferralRewardEligibleTransaction(transaction: Pick<Transaction, 'id' | 'type' | 'status'>) {
  return transaction.status === 'success'
    && transaction.type !== 'referral_bonus'
    && transaction.type !== 'reward_bonus'
    && transaction.type !== 'admin_credit'
    && transaction.type !== 'admin_debit'
}

function readReferralBonusMetadata(metadata: Record<string, unknown> | undefined) {
  return {
    referredUserId: typeof metadata?.referredUserId === 'string' ? metadata.referredUserId : '',
    triggerTransactionId: typeof metadata?.triggerTransactionId === 'string' ? metadata.triggerTransactionId : '',
    role: typeof metadata?.role === 'string' ? metadata.role : '',
  }
}

function normalizeRewardTransactionTypes(value: unknown): Transaction['type'][] | undefined {
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter((item): item is Transaction['type'] => typeof item === 'string' && item.trim().length > 0)
  return filtered.length > 0 ? filtered : undefined
}

function getConfigurableAssetExecutionRail(asset: Pick<CryptoAsset, 'id' | 'executionRail'>): CryptoAsset['executionRail'] | undefined {
  const executionRail = getExecutionRailForAsset(asset)
  if (
    executionRail === 'base_treasury'
    || executionRail === 'routed_treasury'
    || executionRail === 'sui_treasury'
    || executionRail === 'ton_treasury'
    || executionRail === 'near_intents'
  ) {
    return executionRail
  }
  return undefined
}

function assertSupportedAssetExecutionRail(asset: CryptoAsset, executionRail: CryptoAsset['executionRail'] | undefined) {
  if (!executionRail) return

  if (executionRail === 'base_treasury' && asset.id !== 'USDC_BASE' && asset.id !== 'ETH_BASE') {
    throw new Error(`${asset.id} cannot use the base treasury rail.`)
  }
  if (executionRail === 'sui_treasury' && asset.id !== 'SUI_SUI') {
    throw new Error(`${asset.id} cannot use the SUI treasury rail.`)
  }
  if (executionRail === 'ton_treasury' && asset.id !== 'TON_TON') {
    throw new Error(`${asset.id} cannot use the TON treasury rail.`)
  }
  if (executionRail === 'near_intents' && asset.id !== 'NEAR_NEAR') {
    throw new Error(`${asset.id} cannot use the NEAR Intents rail.`)
  }
  if (executionRail === 'routed_treasury') {
    void getRoutedTreasuryPairConfigForAsset(asset)
  }
}

export interface AppDatabase {
  users: StoredUser[]
  wallets: Record<string, Wallet>
  transactions: Record<string, Transaction[]>
  sessions: SessionRecord[]
  notifications: Record<string, NotificationRecord[]>
}

interface LegacySessionRecord {
  token?: string
  userId?: string
  expiresAt?: string
  createdAt?: string
  userAgent?: string
  ipAddress?: string
}

interface PartialAppDatabase {
  users?: StoredUser[]
  wallets?: Record<string, Wallet>
  transactions?: Record<string, Transaction[]>
  sessions?: LegacySessionRecord[]
  notifications?: Record<string, NotificationRecord[]>
}

type UserRow = StoredUser

type WalletRow = {
  user_id: string
  balance: number
  locked_balance: number
  currency: Wallet['currency']
  virtual_accounts: string
}

type CryptoDepositAddressRow = {
  id: string
  user_id: string
  address_family: CryptoDepositAddress['addressFamily']
  network_label: string
  address: string
  encrypted_secret: string
  key_version: string
  derivation_path: string | null
  is_active: number | null
  created_at: string
  updated_at: string
}

type CryptoDepositEventRow = {
  id: string
  external_event_id: string
  user_id: string
  address_id: string | null
  address_family: string | null
  pair_id: string
  network: string | null
  asset_symbol: string
  amount_crypto: number
  amount_units: string
  tx_hash: string | null
  block_number: string | null
  log_index: number | null
  status: string
  sweep_status: string | null
  sweep_tx_hash: string | null
  sweep_error: string | null
  swept_at: string | null
  crypto_order_id: string | null
  transaction_id: string | null
  payload: string | null
  created_at: string
  updated_at: string
  source?: string | null
  cex_exchange?: string | null
  cex_uid?: string | null
  cex_tx_id?: string | null
  memo?: string | null
}

type TransactionRow = {
  id: string
  user_id: string
  type: Transaction['type']
  status: Transaction['status']
  amount: number
  fee: number
  description: string
  reference: string
  recipient: string | null
  narration: string | null
  created_at: string
  icon: string | null
  metadata: string | null
}

type SessionRow = {
  token: string
  user_id: string
  expires_at: string
  created_at: string
  user_agent: string | null
  ip_address: string | null
}

type NotificationRow = {
  id: string
  user_id: string
  title: string
  message: string
  type: NotificationRecord['type']
  read: number
  created_at: string
}

type PushTokenRow = {
  id: string
  user_id: string
  token: string
  platform: PushTokenRecord['platform']
  created_at: string
  last_seen_at: string
}

type RewardRuleRow = {
  id: string
  name: string
  description: string | null
  kind: RewardRule['kind']
  trigger_event: RewardRule['triggerEvent']
  audience: RewardRule['audience']
  amount_ngn: number
  requires_referral: number
  allowed_transaction_types: string | null
  excluded_transaction_types: string | null
  daily_payout_cap_ngn: number | null
  manual_approval_required: number
  is_active: number
  created_at: string
  updated_at: string
}

type RewardAwardRequestRow = {
  id: string
  reward_rule_id: string
  reward_rule_name: string
  reward_kind: RewardRule['kind']
  reward_type: RewardAwardRecord['rewardType']
  trigger_event: RewardRule['triggerEvent']
  audience: RewardRule['audience']
  beneficiary_user_id: string
  source_user_id: string
  trigger_transaction_id: string | null
  amount_ngn: number
  status: RewardAwardRequest['status']
  status_reason: string | null
  reviewed_at: string | null
  reviewed_by_user_id: string | null
  created_at: string
  updated_at: string
}

type SecuritySettingsRow = {
  user_id: string
  transaction_pin_enabled: number
  transaction_pin_hash: string | null
  transaction_pin_salt: string | null
  transaction_pin_failed_attempts: number
  transaction_pin_locked_until: string | null
  two_factor_enabled: number
  biometric_enabled: number
  created_at: string
  updated_at: string
}

type BiometricCredentialRow = {
  id: string
  user_id: string
  credential_id: string
  public_key: string
  counter: number
  transports: string | null
  device_type: string | null
  backed_up: number
  label: string | null
  created_at: string
  last_used_at: string | null
}

type WebAuthnChallengeRow = {
  id: string
  user_id: string
  purpose: string
  challenge: string
  rp_id: string
  origin: string
  expires_at: string
  created_at: string
  used_at: string | null
}

type BiometricApprovalRow = {
  token: string
  user_id: string
  expires_at: string
  created_at: string
  used_at: string | null
}

type CryptoPairRow = {
  id: string
  symbol: string
  name: string
  network: string
  icon: string
  market_source_id: string | null
  market_price_source: string | null
  market_price_usd: number | null
  market_price_updated_at: string | null
  market_rate: number
  buy_rate: number
  sell_rate: number
  buy_spread_bps: number
  sell_spread_bps: number
  buy_margin_ngn_per_usd: number | null
  sell_margin_ngn_per_usd: number | null
  buy_network_fee_ngn: number | null
  sell_network_fee_ngn: number | null
  quote_ttl_seconds: number
  is_active: number
  base_execution_enabled: number
  execution_rail: string | null
  routed_to_chain: string | null
  routed_to_token: string | null
  routed_decimals: number | null
  routed_address_family: string | null
  minimum_buy_ngn: number | null
  max_quote_drift_percent: number | null
  change_24h: number
  created_at: string
  updated_at: string
}

type CryptoQuoteRow = {
  id: string
  user_id: string
  pair_id: string
  side: 'buy' | 'sell'
  amount_ngn: number
  crypto_amount: number
  unit_rate: number
  network_fee_ngn: number | null
  provider_payload: string | null
  expires_at: string
  used_at: string | null
  created_at: string
}

type CryptoOrderRow = {
  id: string
  user_id: string
  transaction_id: string
  quote_id: string
  pair_id: string
  side: 'buy' | 'sell'
  amount_ngn: number
  crypto_amount: number
  unit_rate: number
  destination_type: 'wallet' | 'exchange'
  destination_label: string | null
  wallet_address: string | null
  exchange: string | null
  provider: string | null
  provider_order_id: string | null
  provider_status: string | null
  provider_reference: string | null
  provider_payload: string | null
  execution_rail: 'base_legacy' | 'base_treasury' | 'bsc_treasury' | 'routed_treasury' | 'sui_treasury' | 'ton_treasury' | 'near_intents' | null
  execution_status: 'awaiting_swap' | 'broadcasted' | 'settled' | 'failed' | null
  execution_reference: string | null
  destination_tx_hash: string | null
  expires_at: string | null
  fulfilled_at: string | null
  webhook_received_at: string | null
  status: 'pending' | 'fulfilled' | 'failed' | 'expired'
  created_at: string
  updated_at: string
}

type BillProviderRow = {
  id: string
  name: string
  icon: string
  type: string
  account_label: string | null
  account_placeholder: string | null
  helper_text: string | null
  min_amount: number | null
  max_amount: number | null
  requires_network: number | null
  requires_account: number | null
  is_active: number | null
  created_at: string
  updated_at: string
}

type NetworkProviderRow = {
  name: string
  icon: string
  created_at: string
  updated_at: string
}

type BankDirectoryRow = {
  code: string
  name: string
  country: string
  provider: string
  is_active: number | null
  payload: string | null
  created_at: string
  updated_at: string
}

type KycSubmissionRow = {
  id: string
  user_id: string
  document_type: string
  document_number: string
  document_url: string
  document_name: string | null
  mime_type: string | null
  file_size: number | null
  status: string
  notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

type KycSensitiveIdentityRow = {
  submission_id: string
  user_id: string
  document_type: 'nin' | 'bvn'
  encrypted_document_number: string
  key_version: string
  created_at: string
  updated_at: string
}

type AuditLogRow = {
  id: string
  user_id: string | null
  actor_user_id: string | null
  action: string
  entity_type: string
  entity_id: string
  metadata: string | null
  created_at: string
}

type LedgerEntryRow = {
  id: string
  user_id: string
  transaction_id: string | null
  asset: 'NGN' | 'RESERVE'
  account: 'available' | 'locked'
  direction: 'credit' | 'debit'
  amount: number
  description: string | null
  created_at: string
}

type AssetBalanceKey = 'NGN' | 'RESERVE'
type AssetBalanceSummary = Record<AssetBalanceKey, { available: number; locked: number }>

type ProviderEventRow = {
  id: string
  external_event_id: string
  provider: string
  reference: string
  status: string
  payload: string | null
  processed_at: string | null
  retry_count: number | null
  failure_reason: string | null
  created_at: string
}

type DepositIntentRow = {
  id: string
  user_id: string
  transaction_id: string
  reference: string
  gross_amount: number
  net_amount: number
  fee: number
  funding_method: string
  provider: string
  provider_reference: string | null
  provider_status: string | null
  account_number: string | null
  bank_name: string | null
  account_name: string | null
  expires_at: string | null
  note: string | null
  status: 'pending' | 'success' | 'failed'
  retry_count: number | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

type PayoutRequestRow = {
  id: string
  user_id: string
  transaction_id: string
  reference: string
  amount: number
  provider: string
  merchant_id: string | null
  beneficiary: string | null
  provider_reference: string | null
  provider_status: string | null
  last_sync_at: string | null
  last_sync_status: string | null
  status: 'pending' | 'success' | 'failed'
  retry_count: number | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

type BeneficiaryRow = {
  id: string
  user_id: string
  kind: 'bank' | 'internal'
  label: string
  bank_code: string | null
  bank_name: string | null
  account_number: string | null
  account_name: string | null
  internal_user_id: string | null
  handle: string | null
  verified_at: string | null
  is_default: number | null
  verification_provider: string | null
  verification_status: 'pending' | 'verified' | 'rejected' | null
  verification_reference: string | null
  verification_checked_at: string | null
  verification_reason: string | null
  last_used_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

type BeneficiaryVerificationRow = {
  id: string
  beneficiary_id: string
  user_id: string
  kind: 'bank' | 'internal'
  provider: string
  status: 'pending' | 'verified' | 'rejected'
  reference: string | null
  bank_code: string | null
  account_number: string | null
  account_name: string | null
  bank_name: string | null
  handle: string | null
  error_code: string | null
  payload: string | null
  reason: string | null
  checked_at: string
  created_at: string
}

const DATA_DIR = path.join(process.cwd(), 'data')
const SQLITE_FILE = path.join(DATA_DIR, 'app.db')
const LEGACY_JSON_FILE = path.join(DATA_DIR, 'app.json')

let dbReady: Promise<void> | null = null
let databaseConstructor: DatabaseSyncConstructor | null = null

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function hashTransactionPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 64).toString('hex')
}

function hashPasswordResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function hashEmailVerificationToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function createPasswordRecord(password: string) {
  const passwordSalt = randomBytes(16).toString('hex')
  return {
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
  }
}

function assertValidTransactionPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error(`Transaction PIN must be exactly ${TRANSACTION_PIN_LENGTH} digits.`)
  }
}

function createTransactionPinRecord(pin: string) {
  assertValidTransactionPin(pin)
  const transactionPinSalt = randomBytes(16).toString('hex')
  return {
    transactionPinSalt,
    transactionPinHash: hashTransactionPin(pin, transactionPinSalt),
  }
}

function defaultDb(): AppDatabase {
  const { passwordHash, passwordSalt } = createPasswordRecord('password')

  return {
    users: [
      {
        ...MOCK_USER,
        passwordHash,
        passwordSalt,
      },
    ],
    wallets: {
      [MOCK_USER.id]: MOCK_WALLET,
    },
    transactions: {
      [MOCK_USER.id]: MOCK_TRANSACTIONS as Transaction[],
    },
    sessions: [],
    notifications: {
      [MOCK_USER.id]: [
        {
          id: `n_${randomBytes(6).toString('hex')}`,
          userId: MOCK_USER.id,
          title: 'Deposit received',
          message: 'Deposit of ₦25,000 received',
          type: 'success',
          read: false,
          createdAt: '2025-06-11T10:23:00Z',
        },
        {
          id: `n_${randomBytes(6).toString('hex')}`,
          userId: MOCK_USER.id,
          title: 'Crypto order placed',
          message: 'USDT buy order placed — 15.43 USDT',
          type: 'info',
          read: false,
          createdAt: '2025-06-11T08:00:00Z',
        },
      ],
    },
  }
}

function normalizeSession(session: LegacySessionRecord): SessionRecord | null {
  if (!session.token || !session.userId || !session.expiresAt) {
    return null
  }

  return {
    token: session.token,
    userId: session.userId,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt ?? new Date().toISOString(),
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
  }
}

function normalizeDb(raw: string): AppDatabase {
  const parsed = JSON.parse(raw) as PartialAppDatabase
  const fallback = defaultDb()

  const users = (Array.isArray(parsed.users) ? parsed.users : fallback.users).map(user => ({
    ...user,
    accountStatus: user.accountStatus ?? 'active',
  }))
  const wallets =
    parsed.wallets && typeof parsed.wallets === 'object' ? { ...parsed.wallets } : { ...fallback.wallets }
  const transactions =
    parsed.transactions && typeof parsed.transactions === 'object'
      ? { ...parsed.transactions }
      : { ...fallback.transactions }
  const notifications =
    parsed.notifications && typeof parsed.notifications === 'object'
      ? { ...parsed.notifications }
      : { ...fallback.notifications }
  const sessions = Array.isArray(parsed.sessions)
    ? parsed.sessions.map(normalizeSession).filter((item): item is SessionRecord => item !== null)
    : []

  for (const [index, user] of users.entries()) {
    if (!wallets[user.id]) {
      wallets[user.id] = fallback.wallets[user.id] ?? {
        balance: 0,
        lockedBalance: 0,
        reserveBalance: 0,
        reserveLockedBalance: 0,
        currency: 'NGN',
        virtualAccounts: [buildVirtualAccount(user.name, index + 1)],
      }
    }

    if (!transactions[user.id]) {
      transactions[user.id] = fallback.transactions[user.id] ?? []
    }

    if (!notifications[user.id]) {
      notifications[user.id] = fallback.notifications[user.id] ?? []
    }
  }

  return {
    users,
    wallets,
    transactions,
    sessions,
    notifications,
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    token: row.token,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    userAgent: row.user_agent ?? undefined,
    ipAddress: row.ip_address ?? undefined,
  }
}

function mapTransactionRow(row: TransactionRow): Transaction {
  return {
    id: row.id,
    type: row.type as Transaction['type'],
    status: row.status as Transaction['status'],
    amount: Number(row.amount),
    fee: Number(row.fee),
    description: row.description,
    reference: row.reference,
    recipient: row.recipient ?? undefined,
    narration: row.narration ?? undefined,
    createdAt: row.created_at,
    icon: row.icon ?? undefined,
    metadata: parseJson(row.metadata, undefined as Transaction['metadata']),
  }
}

function mapNotificationRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message,
    type: row.type,
    read: Boolean(row.read),
    createdAt: row.created_at,
  }
}

function mapPushTokenRow(row: PushTokenRow): PushTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    platform: row.platform,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

function mapRewardRuleRow(row: RewardRuleRow): RewardRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    kind: row.kind,
    triggerEvent: row.trigger_event,
    audience: row.audience,
    amountNgn: Number(row.amount_ngn),
    requiresReferral: Boolean(row.requires_referral),
    allowedTransactionTypes: normalizeRewardTransactionTypes(parseJson(row.allowed_transaction_types, undefined as unknown)),
    excludedTransactionTypes: normalizeRewardTransactionTypes(parseJson(row.excluded_transaction_types, undefined as unknown)),
    dailyPayoutCapNgn: row.daily_payout_cap_ngn == null ? undefined : Number(row.daily_payout_cap_ngn),
    manualApprovalRequired: Boolean(row.manual_approval_required),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRewardAwardRequestRow(
  row: RewardAwardRequestRow,
  userNameById: Map<string, string>
): RewardAwardRequest {
  return {
    id: row.id,
    rewardRuleId: row.reward_rule_id,
    rewardRuleName: row.reward_rule_name,
    rewardType: row.reward_type,
    rewardKind: row.reward_kind,
    triggerEvent: row.trigger_event,
    audience: row.audience,
    beneficiaryUserId: row.beneficiary_user_id,
    beneficiaryName: userNameById.get(row.beneficiary_user_id) ?? row.beneficiary_user_id,
    sourceUserId: row.source_user_id,
    sourceUserName: userNameById.get(row.source_user_id) ?? row.source_user_id,
    triggerTransactionId: row.trigger_transaction_id ?? undefined,
    amountNgn: Number(row.amount_ngn),
    status: row.status,
    statusReason: row.status_reason ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedByUserId: row.reviewed_by_user_id ?? undefined,
    reviewedByName: row.reviewed_by_user_id ? (userNameById.get(row.reviewed_by_user_id) ?? row.reviewed_by_user_id) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSecuritySettingsRow(row: SecuritySettingsRow): SecuritySettingsRecord {
  const hasTransactionPin = Boolean(row.transaction_pin_hash && row.transaction_pin_salt)
  return {
    userId: row.user_id,
    transactionPinEnabled: Boolean(row.transaction_pin_enabled) && hasTransactionPin,
    hasTransactionPin,
    transactionPinLockedUntil: row.transaction_pin_locked_until ?? undefined,
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    biometricEnabled: Boolean(row.biometric_enabled),
    hasBiometricCredential: false,
    biometricCredentialCount: 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBiometricCredentialRow(row: BiometricCredentialRow): BiometricCredentialRecord {
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: Number(row.counter ?? 0),
    transports: row.transports ? JSON.parse(row.transports) as string[] : [],
    deviceType: row.device_type ?? undefined,
    backedUp: Boolean(row.backed_up),
    label: row.label ?? undefined,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? undefined,
  }
}

function mapCryptoPairRow(row: CryptoPairRow): CryptoAsset {
  return {
    id: row.id as CryptoAsset['id'],
    symbol: row.symbol as CryptoAsset['symbol'],
    name: row.name,
    network: row.network as CryptoAsset['network'],
    icon: resolveCryptoAssetIcon(row.icon),
    marketSourceId: row.market_source_id ?? getDefaultCryptoMarketSourceId(row.symbol),
    marketSnapshotSource: (row.market_price_source as CryptoAsset['marketSnapshotSource'] | null) ?? 'seed',
    marketPriceUsd: row.market_price_usd == null ? undefined : Number(row.market_price_usd),
    marketPriceUpdatedAt: row.market_price_updated_at ?? undefined,
    marketRate: Number(row.market_rate),
    buyRate: Number(row.buy_rate),
    sellRate: Number(row.sell_rate),
    // Prefer ₦-per-USD margin. Legacy bps rows without the new columns fall back to default (50).
    buyMarginNgnPerUsd: row.buy_margin_ngn_per_usd != null && Number.isFinite(Number(row.buy_margin_ngn_per_usd))
      ? Math.max(0, Number(row.buy_margin_ngn_per_usd))
      : DEFAULT_USD_MARGIN_NGN,
    sellMarginNgnPerUsd: row.sell_margin_ngn_per_usd != null && Number.isFinite(Number(row.sell_margin_ngn_per_usd))
      ? Math.max(0, Number(row.sell_margin_ngn_per_usd))
      : DEFAULT_USD_MARGIN_NGN,
    buyNetworkFeeNgn: row.buy_network_fee_ngn == null ? undefined : Number(row.buy_network_fee_ngn),
    sellNetworkFeeNgn: row.sell_network_fee_ngn == null ? undefined : Number(row.sell_network_fee_ngn),
    quoteTtlSeconds: Number(row.quote_ttl_seconds),
    isActive: Boolean(row.is_active),
    baseExecutionEnabled: Boolean(row.base_execution_enabled),
    executionRail:
      row.execution_rail === 'base_treasury'
        ? 'base_treasury'
        : row.execution_rail === 'routed_treasury'
          ? 'routed_treasury'
          : row.execution_rail === 'sui_treasury'
            ? 'sui_treasury'
            : row.execution_rail === 'ton_treasury'
              ? 'ton_treasury'
              : row.execution_rail === 'near_intents'
                ? 'near_intents'
                : undefined,
    routedToChain: row.routed_to_chain ?? undefined,
    routedToToken: row.routed_to_token ?? undefined,
    routedDecimals: row.routed_decimals == null ? undefined : Number(row.routed_decimals),
    routedAddressFamily:
      row.routed_address_family === 'evm'
        ? 'evm'
        : row.routed_address_family === 'solana'
          ? 'solana'
          : undefined,
    minimumBuyNgn: row.minimum_buy_ngn == null ? undefined : Number(row.minimum_buy_ngn),
    maxQuoteDriftPercent: row.max_quote_drift_percent == null ? undefined : Number(row.max_quote_drift_percent),
    change24h: Number(row.change_24h),
  }
}

function resolveCryptoAssetIcon(icon: string) {
  // ETH token uses eth.png everywhere; Base chain mark is base.png (network picker only).
  const explicitReplacements: Record<string, string> = {
    '/crypto-assets/eth-base.png': '/crypto-assets/eth.png',
    '/crypto-assets/ton.svg': '/crypto-assets/ton.png',
    '/crypto-assets/sui.svg': '/crypto-assets/sui.png',
    '/crypto-assets/near.svg': '/crypto-assets/near.png',
    // Admin uploads that were byte-identical to the named chain marks, kept so a database
    // still holding the uploaded path resolves after the duplicate files were removed.
    '/crypto-assets/eth-d9a54208.png': '/crypto-assets/eth-arb.png',
    '/crypto-assets/eth-5cfef420.png': '/crypto-assets/eth-op.png',
  }

  const explicit = explicitReplacements[icon]
  if (explicit) {
    const explicitPublicPath = path.join(process.cwd(), 'public', explicit.replace(/^\/+/, ''))
    if (existsSync(explicitPublicPath)) return explicit
  }

  if (!icon.startsWith('/crypto-assets/')) return icon
  if (!icon.endsWith('.svg')) return icon

  const parsed = path.parse(icon)
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const candidatePublicPath = path.join(process.cwd(), 'public', parsed.dir.replace(/^\/+/, ''), `${parsed.name}${ext}`)
    if (existsSync(candidatePublicPath)) {
      return `${parsed.dir}/${parsed.name}${ext}`
    }
  }

  return icon
}

function mapCryptoQuoteRow(row: CryptoQuoteRow): CryptoQuote {
  return {
    id: row.id,
    userId: row.user_id,
    pairId: row.pair_id as CryptoQuote['pairId'],
    side: row.side,
    amountNgn: Number(row.amount_ngn),
    cryptoAmount: Number(row.crypto_amount),
    unitRate: Number(row.unit_rate),
    networkFeeNgn: row.network_fee_ngn == null ? 0 : Number(row.network_fee_ngn),
    providerPayload: parseJson(row.provider_payload, undefined),
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? undefined,
    createdAt: row.created_at,
  }
}

function mapCryptoOrderRow(row: CryptoOrderRow): CryptoOrder {
  return {
    id: row.id,
    userId: row.user_id,
    transactionId: row.transaction_id,
    quoteId: row.quote_id,
    pairId: row.pair_id as CryptoOrder['pairId'],
    side: row.side,
    amountNgn: Number(row.amount_ngn),
    cryptoAmount: Number(row.crypto_amount),
    unitRate: Number(row.unit_rate),
    destinationType: row.destination_type,
    destinationLabel: row.destination_label ?? undefined,
    walletAddress: row.wallet_address ?? undefined,
    exchange: row.exchange ?? undefined,
    provider:
      row.provider === '0x'
        ? '0x'
        : row.provider === 'lifi'
            ? 'lifi'
            : row.provider === 'ston'
              ? 'ston'
              : row.provider === 'near_intents'
                ? 'near_intents'
                : undefined,
    providerOrderId: row.provider_order_id ?? undefined,
    providerStatus: row.provider_status ?? undefined,
    providerReference: row.provider_reference ?? undefined,
    providerPayload: parseJson(row.provider_payload, undefined),
    executionRail:
      row.execution_rail === 'base_legacy'
        ? 'base_legacy'
        : row.execution_rail === 'base_treasury'
          ? 'base_treasury'
          : row.execution_rail === 'bsc_treasury'
            ? 'bsc_treasury'
            : row.execution_rail === 'routed_treasury'
              ? 'routed_treasury'
              : row.execution_rail === 'sui_treasury'
                ? 'sui_treasury'
                : row.execution_rail === 'ton_treasury'
                  ? 'ton_treasury'
                  : row.execution_rail === 'near_intents'
                    ? 'near_intents'
                    : undefined,
    executionStatus: row.execution_status ?? undefined,
    executionReference: row.execution_reference ?? undefined,
    destinationTxHash: row.destination_tx_hash ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    fulfilledAt: row.fulfilled_at ?? undefined,
    webhookReceivedAt: row.webhook_received_at ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function persistCryptoMarketSnapshots(assets: CryptoAsset[]) {
  if (assets.length === 0) return

  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await withPostgresTransaction(async client => {
      for (const asset of assets) {
        const marketPriceUsd = Number(asset.marketPriceUsd)
        const marketRate = Number(asset.marketRate)
        const buyRate = Number(asset.buyRate)
        const sellRate = Number(asset.sellRate)
        const change24h = Number(asset.change24h)

        if (!Number.isFinite(marketPriceUsd) || marketPriceUsd <= 0) continue
        if (!Number.isFinite(marketRate) || marketRate <= 0) continue
        if (!Number.isFinite(buyRate) || !Number.isFinite(sellRate)) continue

        await queryPostgresClient(client, `
          UPDATE crypto_pairs
          SET market_price_source = ?, market_price_usd = ?, market_price_updated_at = ?,
              market_rate = ?, buy_rate = ?, sell_rate = ?, change_24h = ?, updated_at = ?
          WHERE id = ?
        `, [
          asset.marketSnapshotSource ?? asset.pricingSource ?? 'seed', marketPriceUsd,
          asset.marketPriceUpdatedAt ?? null, marketRate, buyRate, sellRate,
          Number.isFinite(change24h) ? change24h : 0, now, asset.id,
        ])
      }
    })
    return
  }
  const db = getDb()
  const now = new Date().toISOString()
  const statement = db.prepare(`
    UPDATE crypto_pairs
    SET
      market_price_source = ?,
      market_price_usd = ?,
      market_price_updated_at = ?,
      market_rate = ?,
      buy_rate = ?,
      sell_rate = ?,
      change_24h = ?,
      updated_at = ?
    WHERE id = ?
  `)

  db.exec('BEGIN')
  try {
    for (const asset of assets) {
      const marketPriceUsd = Number(asset.marketPriceUsd)
      const marketRate = Number(asset.marketRate)
      const buyRate = Number(asset.buyRate)
      const sellRate = Number(asset.sellRate)
      const change24h = Number(asset.change24h)

      if (!Number.isFinite(marketPriceUsd) || marketPriceUsd <= 0) continue
      if (!Number.isFinite(marketRate) || marketRate <= 0) continue
      if (!Number.isFinite(buyRate) || !Number.isFinite(sellRate)) continue

      statement.run(
        asset.marketSnapshotSource ?? asset.pricingSource ?? 'seed',
        marketPriceUsd,
        asset.marketPriceUpdatedAt ?? null,
        marketRate,
        buyRate,
        sellRate,
        Number.isFinite(change24h) ? change24h : 0,
        now,
        asset.id
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function getCryptoAssetRefreshState() {
  const globalState = globalThis as typeof globalThis & {
    __mafitapayCryptoAssetRefreshState?: CryptoAssetRefreshState
  }

  if (!globalState.__mafitapayCryptoAssetRefreshState) {
    globalState.__mafitapayCryptoAssetRefreshState = {}
  }

  return globalState.__mafitapayCryptoAssetRefreshState
}

function getCryptoMarketSchedulerState() {
  const globalState = globalThis as typeof globalThis & {
    __mafitapayCryptoMarketSchedulerState?: CryptoMarketSchedulerState
  }

  if (!globalState.__mafitapayCryptoMarketSchedulerState) {
    globalState.__mafitapayCryptoMarketSchedulerState = {}
  }

  return globalState.__mafitapayCryptoMarketSchedulerState
}

async function refreshCryptoAssetsSingleFlight(persistedAssets: CryptoAsset[], options?: { liveOnly?: boolean }) {
  const state = getCryptoAssetRefreshState()
  const liveOnly = options?.liveOnly === true

  if (state.promise) {
    if (!liveOnly || Boolean(state.liveOnly)) {
      if (CRYPTO_MARKET_LOGGING_ENABLED) {
        console.log('[crypto-assets] refresh.join', JSON.stringify({ liveOnly, inFlightLiveOnly: Boolean(state.liveOnly) }))
      }
      return await state.promise
    }

    if (CRYPTO_MARKET_LOGGING_ENABLED) {
      console.log('[crypto-assets] refresh.escalate', JSON.stringify({ liveOnly: true, inFlightLiveOnly: Boolean(state.liveOnly) }))
    }
    try {
      await state.promise
    } catch {}
  }

  const promise = (async () => {
    const assets = await hydrateCryptoAssetPricing(persistedAssets, { liveOnly })
    await persistCryptoMarketSnapshots(assets)
    return assets.sort((a, b) => a.marketRate - b.marketRate)
  })()

  state.promise = promise
  state.liveOnly = liveOnly

  try {
    return await promise
  } finally {
    if (state.promise === promise) {
      state.promise = undefined
      state.liveOnly = undefined
    }
  }
}

function mapPersistedCryptoSnapshot(asset: CryptoAsset): CryptoAsset {
  const snapshotIsFresh = isCryptoMarketSnapshotFresh(asset.marketPriceUpdatedAt)
  const source = asset.marketSnapshotSource ?? 'seed'

  return {
    ...asset,
    pricingSource: source === 'live'
      ? (snapshotIsFresh ? 'live' : 'backup')
      : source === 'backup'
        ? 'backup'
        : 'safe',
  }
}

function mapCryptoDepositAddressRow(row: CryptoDepositAddressRow): CryptoDepositAddress {
  return {
    id: row.id,
    userId: row.user_id,
    addressFamily: row.address_family,
    networkLabel: row.network_label,
    address: row.address,
    derivationPath: row.derivation_path ?? undefined,
    isActive: row.is_active !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCryptoDepositEventRow(row: CryptoDepositEventRow): CryptoDepositEvent {
  return {
    id: row.id,
    externalEventId: row.external_event_id,
    userId: row.user_id,
    addressId: row.address_id ?? undefined,
    addressFamily: (row.address_family as CryptoDepositEvent['addressFamily']) ?? undefined,
    pairId: row.pair_id as CryptoDepositEvent['pairId'],
    network: row.network ?? undefined,
    assetSymbol: row.asset_symbol,
    amountCrypto: Number(row.amount_crypto),
    amountUnits: row.amount_units,
    txHash: row.tx_hash ?? undefined,
    blockNumber: row.block_number ?? undefined,
    logIndex: row.log_index ?? undefined,
    status: row.status === 'matched' || row.status === 'ignored' ? row.status : 'unmatched',
    sweepStatus: row.sweep_status === 'sweeping' || row.sweep_status === 'swept' || row.sweep_status === 'failed' || row.sweep_status === 'skipped'
      ? row.sweep_status
      : 'pending',
    sweepTxHash: row.sweep_tx_hash ?? undefined,
    sweepError: row.sweep_error ?? undefined,
    sweptAt: row.swept_at ?? undefined,
    cryptoOrderId: row.crypto_order_id ?? undefined,
    transactionId: row.transaction_id ?? undefined,
    payload: parseJson(row.payload, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: (row.source as CryptoDepositEvent['source']) ?? 'onchain',
    cexExchange: row.cex_exchange ?? undefined,
    cexUid: row.cex_uid ?? undefined,
    cexTxId: row.cex_tx_id ?? undefined,
    memo: row.memo ?? undefined,
  }
}

type CexDepositIntentRow = {
  id: string
  user_id: string
  reference: string
  exchange: string
  pair_id: string
  expected_amount_crypto: number
  cex_uid: string
  memo?: string | null
  status: string
  matched_event_id?: string | null
  expires_at?: string | null
  note?: string | null
  created_at: string
  updated_at: string
}

function mapCexDepositIntentRow(row: CexDepositIntentRow): CexDepositIntent {
  return {
    id: row.id,
    userId: row.user_id,
    reference: row.reference,
    exchange: row.exchange as CexDepositIntent['exchange'],
    pairId: row.pair_id as CexDepositIntent['pairId'],
    expectedAmountCrypto: Number(row.expected_amount_crypto),
    cexUid: row.cex_uid,
    memo: row.memo ?? undefined,
    status: (row.status as CexDepositIntent['status']) || 'pending',
    matchedEventId: row.matched_event_id ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBillProviderRow(row: BillProviderRow): BillProvider {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    type: row.type as BillProvider['type'],
    accountLabel: row.account_label ?? undefined,
    accountPlaceholder: row.account_placeholder ?? undefined,
    helperText: row.helper_text ?? undefined,
    minAmount: row.min_amount != null ? Number(row.min_amount) : undefined,
    maxAmount: row.max_amount != null ? Number(row.max_amount) : undefined,
    requiresNetwork: row.requires_network != null ? Boolean(row.requires_network) : undefined,
    requiresAccount: row.requires_account != null ? Boolean(row.requires_account) : undefined,
    isActive: row.is_active != null ? Boolean(row.is_active) : undefined,
  }
}

function mapNetworkProviderRow(row: NetworkProviderRow): NetworkProvider {
  return {
    name: row.name,
    icon: row.icon,
  }
}

function resolveNetworkProviderIcon(name: string, icon: string) {
  const normalized = name.trim().toLowerCase()
  if (normalized.includes('mtn')) return '/network-providers/mtn.svg'
  if (normalized.includes('airtel')) return '/network-providers/airtel.svg'
  if (normalized.includes('glo')) return '/network-providers/glo.svg'
  if (normalized.includes('9mobile') || normalized.includes('etisalat')) return '/network-providers/9mobile.svg'
  return icon
}

function mapBankDirectoryRow(row: BankDirectoryRow): BankDirectoryEntry {
  return {
    code: row.code,
    name: row.name,
    country: row.country,
    provider: row.provider,
    isActive: row.is_active !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapKycSubmissionRow(row: KycSubmissionRow): KycSubmission {
  return {
    id: row.id,
    userId: row.user_id,
    documentType: row.document_type as KycSubmission['documentType'],
    documentNumber: row.document_number,
    documentUrl: row.document_url,
    documentName: row.document_name ?? undefined,
    mimeType: row.mime_type ?? undefined,
    fileSize: row.file_size != null ? Number(row.file_size) : undefined,
    status: row.status as KycSubmission['status'],
    notes: row.notes ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAuditLogRow(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    actorUserId: row.actor_user_id ?? undefined,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: parseJson(row.metadata, {} as Record<string, unknown>),
    createdAt: row.created_at,
  }
}

function mapLedgerEntryRow(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    transactionId: row.transaction_id ?? undefined,
    asset: row.asset,
    account: row.account,
    direction: row.direction,
    amount: Number(row.amount),
    description: row.description ?? undefined,
    createdAt: row.created_at,
  }
}

function mapProviderEventRow(row: ProviderEventRow): ProviderEvent {
  return {
    id: row.id,
    externalEventId: row.external_event_id,
    provider: row.provider,
    reference: row.reference,
    status: row.status,
    payload: parseJson(row.payload, undefined as ProviderEvent['payload']),
    processedAt: row.processed_at ?? undefined,
    retryCount: row.retry_count != null ? Number(row.retry_count) : undefined,
    failureReason: row.failure_reason ?? undefined,
    createdAt: row.created_at,
  }
}

function mapDepositIntentRow(row: DepositIntentRow): DepositIntent {
  return {
    id: row.id,
    userId: row.user_id,
    transactionId: row.transaction_id,
    reference: row.reference,
    grossAmount: Number(row.gross_amount),
    netAmount: Number(row.net_amount),
    fee: Number(row.fee),
    fundingMethod: row.funding_method,
    provider: row.provider,
    providerReference: row.provider_reference ?? undefined,
    providerStatus: row.provider_status ?? undefined,
    accountNumber: row.account_number ?? undefined,
    bankName: row.bank_name ?? undefined,
    accountName: row.account_name ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    note: row.note ?? undefined,
    status: row.status,
    retryCount: row.retry_count != null ? Number(row.retry_count) : undefined,
    failureReason: row.failure_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapPayoutRequestRow(row: PayoutRequestRow): PayoutRequest {
  return {
    id: row.id,
    userId: row.user_id,
    transactionId: row.transaction_id,
    reference: row.reference,
    amount: Number(row.amount),
    provider: row.provider,
    merchantId: row.merchant_id ?? undefined,
    beneficiary: row.beneficiary ?? undefined,
    providerReference: row.provider_reference ?? undefined,
    providerStatus: row.provider_status ?? undefined,
    lastSyncAt: row.last_sync_at ?? undefined,
    lastSyncStatus: row.last_sync_status ?? undefined,
    status: row.status,
    retryCount: row.retry_count != null ? Number(row.retry_count) : undefined,
    failureReason: row.failure_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBeneficiaryRow(row: BeneficiaryRow): Beneficiary {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    label: row.label,
    bankCode: row.bank_code ?? undefined,
    bankName: row.bank_name ?? undefined,
    accountNumber: row.account_number ?? undefined,
    accountName: row.account_name ?? undefined,
    internalUserId: row.internal_user_id ?? undefined,
    handle: row.handle ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
    isDefault: row.is_default === 1,
    verificationProvider: row.verification_provider ?? undefined,
    verificationStatus: row.verification_status ?? undefined,
    verificationReference: row.verification_reference ?? undefined,
    verificationCheckedAt: row.verification_checked_at ?? undefined,
    verificationReason: row.verification_reason ?? undefined,
    lastUsedAt: row.last_used_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBeneficiaryVerificationRow(row: BeneficiaryVerificationRow): BeneficiaryVerification {
  return {
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    userId: row.user_id,
    kind: row.kind,
    provider: row.provider,
    status: row.status,
    reference: row.reference ?? undefined,
    bankCode: row.bank_code ?? undefined,
    accountNumber: row.account_number ?? undefined,
    accountName: row.account_name ?? undefined,
    bankName: row.bank_name ?? undefined,
    handle: row.handle ?? undefined,
    errorCode: row.error_code ?? undefined,
    payload: parseJson(row.payload, undefined),
    reason: row.reason ?? undefined,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
  }
}

function emptyAssetBalances(): AssetBalanceSummary {
  return {
    NGN: { available: 0, locked: 0 },
    RESERVE: { available: 0, locked: 0 },
  }
}

function buildWalletFromRow(row: WalletRow, balances?: AssetBalanceSummary): Wallet {
  return {
    balance: balances ? balances.NGN.available : Number(row.balance),
    lockedBalance: balances ? balances.NGN.locked : Number(row.locked_balance),
    reserveBalance: balances ? balances.RESERVE.available : 0,
    reserveLockedBalance: balances ? balances.RESERVE.locked : 0,
    currency: row.currency,
    virtualAccounts: parseJson(row.virtual_accounts, [] as Wallet['virtualAccounts']),
  }
}

function calculateWalletBalances(db: DatabaseSync, userId: string) {
  const rows = db.prepare(`
    SELECT COALESCE(asset, 'NGN') AS asset,
      account,
      COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance
    FROM ledger_entries
    WHERE user_id = ?
    GROUP BY asset, account
  `).all(userId) as Array<{ asset: string; account: 'available' | 'locked'; balance: number }>

  const balances = emptyAssetBalances()

  for (const row of rows) {
    const asset: AssetBalanceKey = row.asset === 'RESERVE' ? 'RESERVE' : 'NGN'
    if (row.account === 'available') balances[asset].available = Number(row.balance)
    if (row.account === 'locked') balances[asset].locked = Number(row.balance)
  }

  return balances
}

function syncWalletSnapshot(db: DatabaseSync, userId: string, balances: AssetBalanceSummary) {
  db.prepare('UPDATE wallets SET balance = ?, locked_balance = ? WHERE user_id = ?')
    .run(balances.NGN.available, balances.NGN.locked, userId)
}

function getDb(): DatabaseSync {
  const globalDb = globalThis as typeof globalThis & { __mafitapayDb?: DatabaseSync }

  if (!databaseConstructor) {
    const sqliteModule = process.getBuiltinModule?.('node:sqlite') as
      | { DatabaseSync: DatabaseSyncConstructor }
      | undefined

    if (!sqliteModule?.DatabaseSync) {
      throw new Error('node:sqlite is unavailable in this runtime.')
    }

    databaseConstructor = sqliteModule.DatabaseSync
  }

  if (!globalDb.__mafitapayDb) {
    globalDb.__mafitapayDb = new databaseConstructor(SQLITE_FILE)
    globalDb.__mafitapayDb.exec('PRAGMA journal_mode = WAL;')
    globalDb.__mafitapayDb.exec('PRAGMA foreign_keys = ON;')
  }

  return globalDb.__mafitapayDb
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      handle TEXT NOT NULL,
      referralCode TEXT NOT NULL,
      referredByUserId TEXT,
      referredByReferralCode TEXT,
      referredAt TEXT,
      accountStatus TEXT NOT NULL DEFAULT 'active',
      kycStatus TEXT NOT NULL,
      tier TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      passwordSalt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance REAL NOT NULL,
      locked_balance REAL NOT NULL,
      currency TEXT NOT NULL,
      virtual_accounts TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL,
      description TEXT NOT NULL,
      reference TEXT NOT NULL,
      recipient TEXT,
      narration TEXT,
      created_at TEXT NOT NULL,
      icon TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_created_at
      ON transactions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_created_at
      ON sessions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created_at
      ON password_reset_tokens(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_created_at
      ON email_verification_tokens(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS auth_rate_limit_attempts (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_rate_limit_attempts_action_scope_created_at
      ON auth_rate_limit_attempts(action, scope, created_at DESC);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
      ON notifications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(user_id, token)
    );

    CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id
      ON push_tokens(user_id);

    CREATE TABLE IF NOT EXISTS reward_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL,
      trigger_event TEXT NOT NULL,
      audience TEXT NOT NULL,
      amount_ngn REAL NOT NULL,
      requires_referral INTEGER NOT NULL DEFAULT 0,
      allowed_transaction_types TEXT,
      excluded_transaction_types TEXT,
      daily_payout_cap_ngn REAL,
      manual_approval_required INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reward_award_requests (
      id TEXT PRIMARY KEY,
      reward_rule_id TEXT NOT NULL,
      reward_rule_name TEXT NOT NULL,
      reward_kind TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      trigger_event TEXT NOT NULL,
      audience TEXT NOT NULL,
      beneficiary_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trigger_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
      amount_ngn REAL NOT NULL,
      status TEXT NOT NULL,
      status_reason TEXT,
      reviewed_at TEXT,
      reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reward_award_requests_status_created_at
      ON reward_award_requests(status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_reward_award_requests_rule_source
      ON reward_award_requests(reward_rule_id, source_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS security_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      transaction_pin_enabled INTEGER NOT NULL DEFAULT 0,
      transaction_pin_hash TEXT,
      transaction_pin_salt TEXT,
      transaction_pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
      transaction_pin_locked_until TEXT,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      biometric_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS biometric_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_biometric_credentials_user_created_at
      ON biometric_credentials(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      challenge TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_purpose_created_at
      ON webauthn_challenges(user_id, purpose, created_at DESC);

    CREATE TABLE IF NOT EXISTS biometric_approvals (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_biometric_approvals_user_created_at
      ON biometric_approvals(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS p2p_merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      initial TEXT NOT NULL,
      bank TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_name TEXT NOT NULL,
      completion_rate REAL NOT NULL,
      total_trades INTEGER NOT NULL,
      min_amount REAL NOT NULL,
      max_amount REAL NOT NULL,
      available_balance REAL NOT NULL,
      is_online INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crypto_pairs (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      network TEXT NOT NULL,
      icon TEXT NOT NULL,
      market_source_id TEXT,
      market_price_source TEXT,
      market_price_usd REAL,
      market_price_updated_at TEXT,
      market_rate REAL NOT NULL,
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      buy_spread_bps INTEGER NOT NULL DEFAULT 0,
      sell_spread_bps INTEGER NOT NULL DEFAULT 0,
      buy_margin_ngn_per_usd REAL,
      sell_margin_ngn_per_usd REAL,
      buy_network_fee_ngn REAL,
      sell_network_fee_ngn REAL,
      quote_ttl_seconds INTEGER NOT NULL DEFAULT 90,
      is_active INTEGER NOT NULL DEFAULT 1,
      base_execution_enabled INTEGER NOT NULL DEFAULT 0,
      execution_rail TEXT,
      routed_to_chain TEXT,
      routed_to_token TEXT,
      routed_decimals INTEGER,
      routed_address_family TEXT,
      minimum_buy_ngn REAL,
      max_quote_drift_percent REAL,
      change_24h REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crypto_quotes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pair_id TEXT NOT NULL REFERENCES crypto_pairs(id) ON DELETE CASCADE,
      side TEXT NOT NULL,
      amount_ngn REAL NOT NULL,
      crypto_amount REAL NOT NULL,
      unit_rate REAL NOT NULL,
      network_fee_ngn REAL NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_crypto_quotes_user_created_at
      ON crypto_quotes(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS crypto_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      quote_id TEXT NOT NULL REFERENCES crypto_quotes(id) ON DELETE CASCADE,
      pair_id TEXT NOT NULL REFERENCES crypto_pairs(id) ON DELETE CASCADE,
      side TEXT NOT NULL,
      amount_ngn REAL NOT NULL,
      crypto_amount REAL NOT NULL,
      unit_rate REAL NOT NULL,
      destination_type TEXT NOT NULL,
      destination_label TEXT,
      wallet_address TEXT,
      exchange TEXT,
      provider TEXT,
      provider_order_id TEXT,
      provider_status TEXT,
      provider_reference TEXT,
      provider_payload TEXT,
      execution_rail TEXT,
      execution_status TEXT,
      execution_reference TEXT,
      destination_tx_hash TEXT,
      expires_at TEXT,
      fulfilled_at TEXT,
      webhook_received_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_crypto_orders_user_created_at
      ON crypto_orders(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS crypto_deposit_addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      address_family TEXT NOT NULL,
      network_label TEXT NOT NULL,
      address TEXT NOT NULL,
      encrypted_secret TEXT NOT NULL,
      key_version TEXT NOT NULL,
      derivation_path TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, address_family)
    );

    CREATE INDEX IF NOT EXISTS idx_crypto_deposit_addresses_address
      ON crypto_deposit_addresses(address_family, address);

    CREATE TABLE IF NOT EXISTS crypto_deposit_events (
      id TEXT PRIMARY KEY,
      external_event_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- address_id is only for on-chain (wallet) deposits. For CEX internal transfers (e.g. Binance)
      -- this will be NULL. We use source + cex_* fields instead.
      address_id TEXT REFERENCES crypto_deposit_addresses(id) ON DELETE CASCADE,
      address_family TEXT,
      pair_id TEXT NOT NULL,
      network TEXT,
      asset_symbol TEXT NOT NULL,
      amount_crypto REAL NOT NULL,
      amount_units TEXT NOT NULL,
      tx_hash TEXT,
      block_number TEXT,
      log_index INTEGER,
      status TEXT NOT NULL,
      -- For CEX deposits we keep sweep_* fields for future manual sweep tracking, but they are not auto-managed.
      sweep_status TEXT NOT NULL DEFAULT 'pending',
      sweep_tx_hash TEXT,
      sweep_error TEXT,
      swept_at TEXT,
      crypto_order_id TEXT,
      transaction_id TEXT,
      -- New for CEX support (starting with Binance)
      source TEXT NOT NULL DEFAULT 'onchain',           -- 'onchain' | 'binance_internal'
      cex_exchange TEXT,                                -- 'binance'
      cex_uid TEXT,                                     -- our platform UID on the exchange
      cex_tx_id TEXT,                                   -- Binance tranId / internal transfer id
      memo TEXT,                                        -- the reference/memo the user was instructed to include
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_crypto_deposit_events_user_created_at
      ON crypto_deposit_events(user_id, created_at DESC);

    -- CEX deposit intents (for Binance internal transfers etc.). Users initiate these
    -- to get a reference/memo to include when sending from the exchange.
    CREATE TABLE IF NOT EXISTS cex_deposit_intents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reference TEXT NOT NULL UNIQUE,               -- code the user puts in Binance "Remark/Memo"
      exchange TEXT NOT NULL,                       -- 'binance'
      pair_id TEXT NOT NULL,
      expected_amount_crypto REAL NOT NULL,
      cex_uid TEXT NOT NULL,                        -- our platform's UID on the exchange
      memo TEXT,
      status TEXT NOT NULL,                         -- 'pending' | 'matched' | 'expired' | 'cancelled'
      matched_event_id TEXT REFERENCES crypto_deposit_events(id),
      expires_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cex_deposit_intents_user_created_at
      ON cex_deposit_intents(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_cex_deposit_intents_reference
      ON cex_deposit_intents(reference);

    -- Persisted incremental scan state for the on-chain deposit scanner (so restarts don't cause
    -- large historical re-scans or delays in picking up recent deposits).
    CREATE TABLE IF NOT EXISTS scanner_state (
      key TEXT PRIMARY KEY,
      block_number TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bill_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      type TEXT NOT NULL,
      account_label TEXT,
      account_placeholder TEXT,
      helper_text TEXT,
      min_amount REAL,
      max_amount REAL,
      requires_network INTEGER NOT NULL DEFAULT 0,
      requires_account INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profit_margins (
      key TEXT PRIMARY KEY,
      value_ngn REAL NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    -- Data-plan pricing rules (online-data-sub model). Empty strings stand in for
    -- NULL so the unique index is reliable on SQLite (NULLs are not unique there).
    CREATE TABLE IF NOT EXISTS pricing_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '',
      network TEXT NOT NULL DEFAULT '',
      plan_type TEXT NOT NULL DEFAULT '',
      variation_code TEXT NOT NULL DEFAULT '',
      margin_bps INTEGER NOT NULL DEFAULT 0,
      margin_kobo INTEGER NOT NULL DEFAULT 0,
      min_margin_kobo INTEGER NOT NULL DEFAULT 0,
      max_margin_kobo INTEGER,
      round_to_kobo INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_rules_target
      ON pricing_rules(scope, vendor, network, plan_type, variation_code);

    CREATE INDEX IF NOT EXISTS idx_pricing_rules_active_scope
      ON pricing_rules(active, scope);

    CREATE TABLE IF NOT EXISTS network_providers (
      name TEXT PRIMARY KEY,
      icon TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bank_directory (
      code TEXT NOT NULL,
      country TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      payload TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (code, country, provider)
    );

    CREATE INDEX IF NOT EXISTS idx_bank_directory_country_name
      ON bank_directory(country, name ASC);

    CREATE TABLE IF NOT EXISTS kyc_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      document_number TEXT NOT NULL,
      document_url TEXT NOT NULL,
      document_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      status TEXT NOT NULL,
      notes TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user_created_at
      ON kyc_submissions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS kyc_sensitive_identities (
      submission_id TEXT PRIMARY KEY REFERENCES kyc_submissions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      encrypted_document_number TEXT NOT NULL,
      key_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kyc_sensitive_identities_user_created_at
      ON kyc_sensitive_identities(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
      ON audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
      asset TEXT NOT NULL DEFAULT 'NGN',
      account TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_created_at
      ON ledger_entries(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction
      ON ledger_entries(transaction_id);

    CREATE TABLE IF NOT EXISTS provider_events (
      id TEXT PRIMARY KEY,
      external_event_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      reference TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT,
      processed_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_provider_events_created_at
      ON provider_events(created_at DESC);

    CREATE TABLE IF NOT EXISTS deposit_intents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      reference TEXT NOT NULL UNIQUE,
      gross_amount REAL NOT NULL,
      net_amount REAL NOT NULL,
      fee REAL NOT NULL,
      funding_method TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_reference TEXT,
      provider_status TEXT,
      account_number TEXT,
      bank_name TEXT,
      account_name TEXT,
      expires_at TEXT,
      note TEXT,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_deposit_intents_user_created_at
      ON deposit_intents(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS payout_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      reference TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL,
      provider TEXT NOT NULL,
      merchant_id TEXT,
      beneficiary TEXT,
      provider_reference TEXT,
      provider_status TEXT,
      last_sync_at TEXT,
      last_sync_status TEXT,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payout_requests_user_created_at
      ON payout_requests(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS beneficiaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      bank_code TEXT,
      bank_name TEXT,
      account_number TEXT,
      account_name TEXT,
      internal_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      handle TEXT,
      verified_at TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      verification_provider TEXT,
      verification_status TEXT,
      verification_reference TEXT,
      verification_checked_at TEXT,
      verification_reason TEXT,
      last_used_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_beneficiaries_user_updated_at
      ON beneficiaries(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS beneficiary_verifications (
      id TEXT PRIMARY KEY,
      beneficiary_id TEXT NOT NULL REFERENCES beneficiaries(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      reference TEXT,
      bank_code TEXT,
      account_number TEXT,
      account_name TEXT,
      bank_name TEXT,
      handle TEXT,
      error_code TEXT,
      payload TEXT,
      reason TEXT,
      checked_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_beneficiary_verifications_beneficiary_created_at
      ON beneficiary_verifications(beneficiary_id, created_at DESC);
  `)
}

function hasColumn(db: DatabaseSync, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some(row => row.name === column)
}

function getSensitiveDataKey() {
  const raw = process.env.MAFITAPAY_SENSITIVE_DATA_KEY?.trim() || ''
  if (!raw) return null

  const base64Candidate = raw.replace(/\s+/g, '')
  try {
    const asBase64 = Buffer.from(base64Candidate, 'base64')
    if (asBase64.length === 32 && asBase64.toString('base64').replace(/=+$/, '') === base64Candidate.replace(/=+$/, '')) {
      return asBase64
    }
  } catch {}

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }

  const utf8 = Buffer.from(raw, 'utf8')
  if (utf8.length === 32) return utf8
  return null
}

export function getSensitiveIdentityConfigState() {
  const key = getSensitiveDataKey()
  return {
    configured: Boolean(key),
    algorithm: 'aes-256-gcm',
    keyVersion: 'v1',
  }
}

function encryptSensitiveValue(value: string) {
  const key = getSensitiveDataKey()
  if (!key) throw new Error('MAFITAPAY_SENSITIVE_DATA_KEY must be configured to store BVN/NIN securely.')

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    payload: Buffer.concat([iv, authTag, ciphertext]).toString('base64'),
    keyVersion: 'v1',
  }
}

function decryptSensitiveValue(payload: string) {
  const key = getSensitiveDataKey()
  if (!key) throw new Error('MAFITAPAY_SENSITIVE_DATA_KEY must be configured to read BVN/NIN securely.')

  const decoded = Buffer.from(payload, 'base64')
  const iv = decoded.subarray(0, 12)
  const authTag = decoded.subarray(12, 28)
  const ciphertext = decoded.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function migrateSchema(db: DatabaseSync) {
  ensureColumn(db, 'users', 'accountStatus', "TEXT NOT NULL DEFAULT 'active'")
  ensureColumn(db, 'users', 'referredByUserId', 'TEXT')
  ensureColumn(db, 'users', 'referredByReferralCode', 'TEXT')
  ensureColumn(db, 'users', 'referredAt', 'TEXT')
  ensureColumn(db, 'kyc_submissions', 'document_name', 'TEXT')
  ensureColumn(db, 'kyc_submissions', 'mime_type', 'TEXT')
  ensureColumn(db, 'kyc_submissions', 'file_size', 'INTEGER')
  ensureColumn(db, 'provider_events', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'provider_events', 'failure_reason', 'TEXT')
  ensureColumn(db, 'deposit_intents', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'deposit_intents', 'failure_reason', 'TEXT')
  ensureColumn(db, 'deposit_intents', 'provider_status', 'TEXT')
  ensureColumn(db, 'deposit_intents', 'account_number', 'TEXT')
  ensureColumn(db, 'deposit_intents', 'bank_name', 'TEXT')
  ensureColumn(db, 'deposit_intents', 'account_name', 'TEXT')
  ensureColumn(db, 'deposit_intents', 'expires_at', 'TEXT')
  ensureColumn(db, 'deposit_intents', 'note', 'TEXT')
  ensureColumn(db, 'payout_requests', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'payout_requests', 'failure_reason', 'TEXT')
  ensureColumn(db, 'payout_requests', 'provider_status', 'TEXT')
  ensureColumn(db, 'payout_requests', 'last_sync_at', 'TEXT')
  ensureColumn(db, 'payout_requests', 'last_sync_status', 'TEXT')
  ensureColumn(db, 'beneficiaries', 'is_default', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'beneficiaries', 'bank_code', 'TEXT')
  ensureColumn(db, 'beneficiaries', 'verification_provider', 'TEXT')
  ensureColumn(db, 'beneficiaries', 'verification_status', 'TEXT')
  ensureColumn(db, 'beneficiaries', 'verification_reference', 'TEXT')
  ensureColumn(db, 'beneficiaries', 'verification_checked_at', 'TEXT')
  ensureColumn(db, 'beneficiaries', 'verification_reason', 'TEXT')
  ensureColumn(db, 'beneficiaries', 'archived_at', 'TEXT')
  ensureColumn(db, 'beneficiary_verifications', 'bank_code', 'TEXT')
  ensureColumn(db, 'beneficiary_verifications', 'error_code', 'TEXT')
  ensureColumn(db, 'beneficiary_verifications', 'payload', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'provider', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'provider_order_id', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'provider_status', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'provider_reference', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'provider_payload', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'expires_at', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'fulfilled_at', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'webhook_received_at', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'execution_rail', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'execution_status', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'execution_reference', 'TEXT')
  ensureColumn(db, 'crypto_orders', 'destination_tx_hash', 'TEXT')
  // Null means "use pair/network default" so existing rows pick up gas recovery without a manual admin pass.
  ensureColumn(db, 'crypto_pairs', 'buy_network_fee_ngn', 'REAL')
  ensureColumn(db, 'crypto_pairs', 'sell_network_fee_ngn', 'REAL')
  // ₦ profit per $1 of asset value (replaces bps spread as the live pricing model).
  ensureColumn(db, 'crypto_pairs', 'buy_margin_ngn_per_usd', 'REAL')
  ensureColumn(db, 'crypto_pairs', 'sell_margin_ngn_per_usd', 'REAL')
  ensureColumn(db, 'crypto_quotes', 'network_fee_ngn', 'REAL NOT NULL DEFAULT 0')

  // Seed pair-specific fees only where never configured (NULL). Explicit 0 stays free.
  for (const asset of CRYPTO_ASSETS) {
    const buyFee = getDefaultNetworkFeeNgn(asset.network, 'buy', asset.id)
    const sellFee = getDefaultNetworkFeeNgn(asset.network, 'sell', asset.id)
    const buyMargin = asset.buyMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN
    const sellMargin = asset.sellMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN
    db.prepare(`
      UPDATE crypto_pairs
      SET buy_network_fee_ngn = COALESCE(buy_network_fee_ngn, ?),
          sell_network_fee_ngn = COALESCE(sell_network_fee_ngn, ?),
          buy_margin_ngn_per_usd = COALESCE(buy_margin_ngn_per_usd, ?),
          sell_margin_ngn_per_usd = COALESCE(sell_margin_ngn_per_usd, ?)
      WHERE id = ?
    `).run(buyFee, sellFee, buyMargin, sellMargin, asset.id)
  }
  ensureColumn(db, 'crypto_deposit_events', 'sweep_status', "TEXT NOT NULL DEFAULT 'pending'")
  ensureColumn(db, 'crypto_deposit_events', 'sweep_tx_hash', 'TEXT')
  ensureColumn(db, 'crypto_deposit_events', 'sweep_error', 'TEXT')
  ensureColumn(db, 'crypto_deposit_events', 'swept_at', 'TEXT')
  ensureColumn(db, 'crypto_deposit_events', 'source', "TEXT NOT NULL DEFAULT 'onchain'")
  ensureColumn(db, 'crypto_deposit_events', 'cex_exchange', 'TEXT')
  ensureColumn(db, 'crypto_deposit_events', 'cex_uid', 'TEXT')
  ensureColumn(db, 'crypto_deposit_events', 'cex_tx_id', 'TEXT')
  ensureColumn(db, 'crypto_deposit_events', 'memo', 'TEXT')

  ensureColumn(db, 'cex_deposit_intents', 'memo', 'TEXT')
  ensureColumn(db, 'cex_deposit_intents', 'matched_event_id', 'TEXT')
  ensureColumn(db, 'cex_deposit_intents', 'expires_at', 'TEXT')
  ensureColumn(db, 'cex_deposit_intents', 'note', 'TEXT')

  // Migration: make address_id nullable for cex/binance_internal deposits (existing DBs had NOT NULL)
  // This must succeed without leaving open transactions, otherwise market snapshots and other DB ops will fail with "cannot start a transaction within a transaction".
  try {
    const colInfo = db.prepare(`PRAGMA table_info(crypto_deposit_events)`).all() as any[];
    const addrCol = colInfo.find((c: any) => c.name === 'address_id');
    if (addrCol && addrCol.notnull === 1) {
      console.log('[db migration] Making address_id nullable in crypto_deposit_events for CEX support...');
      // Backfill legacy NULLs first (sweep_status etc were added via ensureColumn and old rows may have NULLs)
      db.prepare(`UPDATE crypto_deposit_events SET sweep_status = COALESCE(sweep_status, 'pending') WHERE sweep_status IS NULL`).run();
      db.prepare(`UPDATE crypto_deposit_events SET source = COALESCE(source, 'onchain') WHERE source IS NULL`).run();
      // Drop any leftover from previous partial migration
      db.exec(`DROP TABLE IF EXISTS crypto_deposit_events_new;`);
      db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN TRANSACTION;
        CREATE TABLE crypto_deposit_events_new AS SELECT * FROM crypto_deposit_events;
        DROP TABLE crypto_deposit_events;
        CREATE TABLE crypto_deposit_events (
          id TEXT PRIMARY KEY,
          external_event_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          address_id TEXT REFERENCES crypto_deposit_addresses(id) ON DELETE CASCADE,
          address_family TEXT,
          pair_id TEXT NOT NULL,
          network TEXT,
          asset_symbol TEXT NOT NULL,
          amount_crypto REAL NOT NULL,
          amount_units TEXT NOT NULL,
          tx_hash TEXT,
          block_number TEXT,
          log_index INTEGER,
          status TEXT NOT NULL,
          sweep_status TEXT NOT NULL DEFAULT 'pending',
          sweep_tx_hash TEXT,
          sweep_error TEXT,
          swept_at TEXT,
          crypto_order_id TEXT,
          transaction_id TEXT,
          payload TEXT,
          source TEXT NOT NULL DEFAULT 'onchain',
          cex_exchange TEXT,
          cex_uid TEXT,
          cex_tx_id TEXT,
          memo TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO crypto_deposit_events (
          id, external_event_id, user_id, address_id, address_family, pair_id, network, asset_symbol,
          amount_crypto, amount_units, tx_hash, block_number, log_index, status,
          sweep_status, sweep_tx_hash, sweep_error, swept_at, crypto_order_id, transaction_id, payload,
          source, cex_exchange, cex_uid, cex_tx_id, memo, created_at, updated_at
        ) SELECT 
          id, external_event_id, user_id, address_id, address_family, pair_id, network, asset_symbol,
          amount_crypto, amount_units, tx_hash, block_number, log_index, status,
          COALESCE(sweep_status, 'pending'), sweep_tx_hash, sweep_error, swept_at, crypto_order_id, transaction_id, payload,
          COALESCE(source, 'onchain'), cex_exchange, cex_uid, cex_tx_id, memo, created_at, updated_at
        FROM crypto_deposit_events_new;
        DROP TABLE crypto_deposit_events_new;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
      // Recreate index
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_crypto_deposit_events_user_created_at
          ON crypto_deposit_events(user_id, created_at DESC);
      `);
      console.log('[db migration] address_id is now nullable.');
    }
  } catch (e) {
    try { db.exec('ROLLBACK; PRAGMA foreign_keys = ON;'); } catch {}
    console.error('[db migration] Failed to make address_id nullable (cex support may fail on insert):', e);
  }
  ensureColumn(db, 'crypto_quotes', 'provider_payload', 'TEXT')
  ensureColumn(db, 'security_settings', 'transaction_pin_hash', 'TEXT')
  ensureColumn(db, 'security_settings', 'transaction_pin_salt', 'TEXT')
  ensureColumn(db, 'security_settings', 'transaction_pin_failed_attempts', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'security_settings', 'transaction_pin_locked_until', 'TEXT')
  ensureColumn(db, 'reward_rules', 'daily_payout_cap_ngn', 'REAL')
  ensureColumn(db, 'reward_rules', 'manual_approval_required', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'crypto_pairs', 'base_execution_enabled', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'crypto_pairs', 'execution_rail', 'TEXT')
  ensureColumn(db, 'crypto_pairs', 'routed_to_chain', 'TEXT')
  ensureColumn(db, 'crypto_pairs', 'routed_to_token', 'TEXT')
  ensureColumn(db, 'crypto_pairs', 'routed_decimals', 'INTEGER')
  ensureColumn(db, 'crypto_pairs', 'routed_address_family', 'TEXT')
  ensureColumn(db, 'crypto_pairs', 'minimum_buy_ngn', 'REAL')
  ensureColumn(db, 'crypto_pairs', 'max_quote_drift_percent', 'REAL')
  ensureColumn(db, 'crypto_pairs', 'market_source_id', 'TEXT')
  ensureColumn(db, 'crypto_pairs', 'market_price_source', 'TEXT')
  ensureColumn(db, 'crypto_pairs', 'market_price_usd', 'REAL')
  ensureColumn(db, 'crypto_pairs', 'market_price_updated_at', 'TEXT')
  db.prepare(`
    UPDATE crypto_pairs
    SET market_price_source = COALESCE(market_price_source, 'seed')
  `).run()
  db.prepare(`
    UPDATE crypto_pairs
    SET quote_ttl_seconds = 30
    WHERE quote_ttl_seconds IS NULL OR quote_ttl_seconds > 30 OR quote_ttl_seconds < 10
  `).run()
  ensureColumn(db, 'bill_providers', 'account_label', 'TEXT')
  ensureColumn(db, 'bill_providers', 'account_placeholder', 'TEXT')
  ensureColumn(db, 'bill_providers', 'helper_text', 'TEXT')
  ensureColumn(db, 'bill_providers', 'min_amount', 'REAL')
  ensureColumn(db, 'bill_providers', 'max_amount', 'REAL')
  ensureColumn(db, 'bill_providers', 'requires_network', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'bill_providers', 'requires_account', 'INTEGER NOT NULL DEFAULT 1')
  ensureColumn(db, 'bill_providers', 'is_active', 'INTEGER NOT NULL DEFAULT 1')
  ensureColumn(db, 'ledger_entries', 'asset', "TEXT NOT NULL DEFAULT 'NGN'")
  backfillCryptoCatalogExpansions(db)
  backfillBillProviderCatalog(db)
  backfillSensitiveKycIdentities(db)
  seedRewardRules(db)
}

function seedRewardRules(db: DatabaseSync) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM reward_rules').get() as { count?: number } | undefined
  if (Number(row?.count ?? 0) > 0) return

  const statement = db.prepare(`
    INSERT INTO reward_rules (
      id, name, description, kind, trigger_event, audience, amount_ngn, requires_referral,
      allowed_transaction_types, excluded_transaction_types, daily_payout_cap_ngn, manual_approval_required,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const rule of DEFAULT_REWARD_RULES) {
    statement.run(
      rule.id,
      rule.name,
      rule.description ?? null,
      rule.kind,
      rule.triggerEvent,
      rule.audience,
      rule.amountNgn,
      rule.requiresReferral === true ? 1 : 0,
      rule.allowedTransactionTypes ? JSON.stringify(rule.allowedTransactionTypes) : null,
      rule.excludedTransactionTypes ? JSON.stringify(rule.excludedTransactionTypes) : null,
      rule.dailyPayoutCapNgn ?? null,
      rule.manualApprovalRequired === true ? 1 : 0,
      rule.isActive === false ? 0 : 1,
      rule.createdAt,
      rule.updatedAt
    )
  }
}

function backfillCryptoCatalogExpansions(db: DatabaseSync) {
  const now = new Date().toISOString()
  const upsertAsset = db.prepare(`
    INSERT INTO crypto_pairs (
      id, symbol, name, network, icon, market_source_id, market_price_source, market_price_usd, market_price_updated_at, market_rate, buy_rate, sell_rate, buy_spread_bps, sell_spread_bps, buy_margin_ngn_per_usd, sell_margin_ngn_per_usd, buy_network_fee_ngn, sell_network_fee_ngn, quote_ttl_seconds,
      is_active, base_execution_enabled, execution_rail, routed_to_chain, routed_to_token, routed_decimals, routed_address_family, minimum_buy_ngn, max_quote_drift_percent, change_24h, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      symbol = excluded.symbol,
      name = excluded.name,
      network = excluded.network,
      icon = excluded.icon,
      market_source_id = excluded.market_source_id,
      market_rate = excluded.market_rate,
      buy_rate = excluded.buy_rate,
      sell_rate = excluded.sell_rate,
      buy_margin_ngn_per_usd = COALESCE(crypto_pairs.buy_margin_ngn_per_usd, excluded.buy_margin_ngn_per_usd),
      sell_margin_ngn_per_usd = COALESCE(crypto_pairs.sell_margin_ngn_per_usd, excluded.sell_margin_ngn_per_usd),
      buy_network_fee_ngn = COALESCE(crypto_pairs.buy_network_fee_ngn, excluded.buy_network_fee_ngn),
      sell_network_fee_ngn = COALESCE(crypto_pairs.sell_network_fee_ngn, excluded.sell_network_fee_ngn),
      quote_ttl_seconds = excluded.quote_ttl_seconds,
      is_active = excluded.is_active,
      base_execution_enabled = excluded.base_execution_enabled,
      execution_rail = COALESCE(crypto_pairs.execution_rail, excluded.execution_rail),
      routed_to_chain = COALESCE(crypto_pairs.routed_to_chain, excluded.routed_to_chain),
      routed_to_token = COALESCE(crypto_pairs.routed_to_token, excluded.routed_to_token),
      routed_decimals = COALESCE(crypto_pairs.routed_decimals, excluded.routed_decimals),
      routed_address_family = COALESCE(crypto_pairs.routed_address_family, excluded.routed_address_family),
      minimum_buy_ngn = COALESCE(crypto_pairs.minimum_buy_ngn, excluded.minimum_buy_ngn),
      max_quote_drift_percent = COALESCE(crypto_pairs.max_quote_drift_percent, excluded.max_quote_drift_percent),
      change_24h = excluded.change_24h,
      updated_at = excluded.updated_at
  `)

  for (const asset of CRYPTO_ASSETS) {
    const executionRail = getConfigurableAssetExecutionRail(asset)
    const routedConfig = isRoutedTreasuryPairId(asset.id) ? getRoutedTreasuryPairConfigForAsset({
      ...asset,
      executionRail,
    }) : null
    const buyMargin = asset.buyMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN
    const sellMargin = asset.sellMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN
    const marketPriceUsd = asset.marketPriceUsd ?? 0
    const buyRate = computeBuyRate(marketPriceUsd, asset.marketRate, buyMargin)
    const sellRate = computeSellRate(marketPriceUsd, asset.marketRate, sellMargin)
    upsertAsset.run(
      asset.id,
      asset.symbol,
      asset.name,
      asset.network,
      asset.icon,
      asset.marketSourceId,
      'seed',
      asset.marketPriceUsd ?? null,
      null,
      asset.marketRate,
      buyRate,
      sellRate,
      buyMargin,
      sellMargin,
      asset.buyNetworkFeeNgn ?? getDefaultNetworkFeeNgn(asset.network, 'buy', asset.id),
      asset.sellNetworkFeeNgn ?? getDefaultNetworkFeeNgn(asset.network, 'sell', asset.id),
      asset.quoteTtlSeconds,
      asset.isActive === false ? 0 : 1,
      asset.baseExecutionEnabled === true ? 1 : 0,
      executionRail ?? null,
      routedConfig?.toChain ?? null,
      routedConfig?.toToken ?? null,
      routedConfig?.decimals ?? null,
      routedConfig?.addressFamily ?? null,
      routedConfig?.minimumBuyNgn ?? null,
      routedConfig?.maxQuoteDriftPercent ?? null,
      asset.change24h,
      now,
      now
    )
  }

  for (const asset of CRYPTO_ASSETS) {
    db.prepare(`
      UPDATE crypto_pairs
      SET market_source_id = COALESCE(market_source_id, ?), market_price_source = COALESCE(market_price_source, 'seed'), market_price_usd = COALESCE(market_price_usd, ?), updated_at = ?
      WHERE id = ?
    `).run(asset.marketSourceId, asset.marketPriceUsd ?? null, now, asset.id)
  }

  db.prepare(`
    UPDATE crypto_pairs
    SET base_execution_enabled = 1, updated_at = ?
    WHERE id IN ('USDT_BSC', 'BNB_BSC', 'USDC_SOLANA', 'SOL_SOLANA', 'TON_TON', 'SUI_SUI', 'NEAR_NEAR')
  `).run(now)

  // ETH token logo is eth.png for every network. Base chain logo is base.png (see crypto-networks).
  db.prepare(`
    UPDATE crypto_pairs
    SET icon = '/crypto-assets/eth.png', updated_at = ?
    WHERE id IN ('ETH_BASE', 'ETH_ETHEREUM')
       OR (symbol = 'ETH' AND (icon IS NULL OR icon = '' OR icon LIKE '%eth-base%' OR icon LIKE '%eth_base%'))
  `).run(now)
}

function backfillBillProviderCatalog(db: DatabaseSync) {
  const update = db.prepare(`
    UPDATE bill_providers
    SET
      name = COALESCE(name, ?),
      icon = COALESCE(icon, ?),
      account_label = COALESCE(account_label, ?),
      account_placeholder = COALESCE(account_placeholder, ?),
      helper_text = COALESCE(helper_text, ?),
      min_amount = COALESCE(min_amount, ?),
      max_amount = COALESCE(max_amount, ?),
      requires_network = CASE
        WHEN account_label IS NULL
          AND account_placeholder IS NULL
          AND helper_text IS NULL
          AND min_amount IS NULL
          AND max_amount IS NULL
        THEN ?
        ELSE requires_network
      END,
      requires_account = CASE
        WHEN account_label IS NULL
          AND account_placeholder IS NULL
          AND helper_text IS NULL
          AND min_amount IS NULL
          AND max_amount IS NULL
        THEN ?
        ELSE requires_account
      END,
      is_active = COALESCE(is_active, ?)
    WHERE id = ?
  `)

  for (const provider of BILL_PROVIDERS) {
    update.run(
      provider.name,
      provider.icon,
      provider.accountLabel ?? null,
      provider.accountPlaceholder ?? null,
      provider.helperText ?? null,
      provider.minAmount ?? null,
      provider.maxAmount ?? null,
      provider.requiresNetwork === true ? 1 : 0,
      provider.requiresAccount === false ? 0 : 1,
      provider.isActive === false ? 0 : 1,
      provider.id
    )
  }
}

function backfillSensitiveKycIdentities(db: DatabaseSync) {
  const key = getSensitiveDataKey()
  if (!key) return

  const rows = db.prepare(`
    SELECT id, user_id, document_type, document_number, created_at, updated_at
    FROM kyc_submissions
    WHERE document_type IN ('bvn', 'nin')
  `).all() as Array<{
    id: string
    user_id: string
    document_type: 'bvn' | 'nin'
    document_number: string
    created_at: string
    updated_at: string
  }>

  for (const row of rows) {
    const existing = db.prepare('SELECT submission_id FROM kyc_sensitive_identities WHERE submission_id = ? LIMIT 1')
      .get(row.id) as { submission_id: string } | undefined

    const digits = row.document_number.trim().replace(/\D/g, '')
    if (!existing && digits) {
      const encrypted = encryptSensitiveValue(digits)
      db.prepare(`
        INSERT INTO kyc_sensitive_identities (
          submission_id, user_id, document_type, encrypted_document_number, key_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.user_id,
        row.document_type,
        encrypted.payload,
        encrypted.keyVersion,
        row.created_at,
        row.updated_at
      )
    }

    const masked = maskDocumentNumber(row.document_type, digits || row.document_number)
    if (row.document_number !== masked) {
      db.prepare('UPDATE kyc_submissions SET document_number = ?, updated_at = ? WHERE id = ?')
        .run(masked, row.updated_at, row.id)
    }
  }
}

function hasAnyLedgerEntries(db: DatabaseSync) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM ledger_entries').get() as { count: number }
  return row.count > 0
}

function seedLedgerFromWalletSnapshots(db: DatabaseSync) {
  if (hasAnyLedgerEntries(db)) return

  const rows = db.prepare('SELECT * FROM wallets').all() as WalletRow[]
  const statement = db.prepare(`
    INSERT INTO ledger_entries (id, user_id, transaction_id, asset, account, direction, amount, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const row of rows) {
    const createdAt = new Date().toISOString()
    if (Number(row.balance) > 0) {
      statement.run(
        `ledger_${randomBytes(6).toString('hex')}`,
        row.user_id,
        null,
        'NGN',
        'available',
        'credit',
        Number(row.balance),
        'Opening available balance',
        createdAt
      )
    }

    if (Number(row.locked_balance) > 0) {
      statement.run(
        `ledger_${randomBytes(6).toString('hex')}`,
        row.user_id,
        null,
        'NGN',
        'locked',
        'credit',
        Number(row.locked_balance),
        'Opening locked balance',
        createdAt
      )
    }
  }
}

function hasAnyUsers(db: DatabaseSync) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  return row.count > 0
}

function hasCatalogRows(
  db: DatabaseSync,
  table: 'crypto_pairs' | 'bill_providers' | 'network_providers'
) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count > 0
}

function seedCatalogTables(db: DatabaseSync) {
  const now = new Date().toISOString()

  if (!hasCatalogRows(db, 'crypto_pairs')) {
    const insertAsset = db.prepare(`
      INSERT INTO crypto_pairs (
        id, symbol, name, network, icon, market_source_id, market_price_source, market_price_usd, market_price_updated_at, market_rate, buy_rate, sell_rate, buy_spread_bps, sell_spread_bps, buy_margin_ngn_per_usd, sell_margin_ngn_per_usd, buy_network_fee_ngn, sell_network_fee_ngn, quote_ttl_seconds, is_active, base_execution_enabled, execution_rail, routed_to_chain, routed_to_token, routed_decimals, routed_address_family, minimum_buy_ngn, max_quote_drift_percent, change_24h, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const asset of CRYPTO_ASSETS) {
      const executionRail = getConfigurableAssetExecutionRail(asset)
      const routedConfig = isRoutedTreasuryPairId(asset.id) ? getRoutedTreasuryPairConfigForAsset({
        ...asset,
        executionRail,
      }) : null
      const buyMargin = asset.buyMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN
      const sellMargin = asset.sellMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN
      const marketPriceUsd = asset.marketPriceUsd ?? 0
      insertAsset.run(
        asset.id,
        asset.symbol,
        asset.name,
        asset.network,
        asset.icon,
        asset.marketSourceId,
        'seed',
        asset.marketPriceUsd ?? null,
        null,
        asset.marketRate,
        computeBuyRate(marketPriceUsd, asset.marketRate, buyMargin),
        computeSellRate(marketPriceUsd, asset.marketRate, sellMargin),
        buyMargin,
        sellMargin,
        asset.buyNetworkFeeNgn ?? getDefaultNetworkFeeNgn(asset.network, 'buy', asset.id),
        asset.sellNetworkFeeNgn ?? getDefaultNetworkFeeNgn(asset.network, 'sell', asset.id),
        asset.quoteTtlSeconds,
        asset.isActive === false ? 0 : 1,
        asset.baseExecutionEnabled === true ? 1 : 0,
        executionRail ?? null,
        routedConfig?.toChain ?? null,
        routedConfig?.toToken ?? null,
        routedConfig?.decimals ?? null,
        routedConfig?.addressFamily ?? null,
        routedConfig?.minimumBuyNgn ?? null,
        routedConfig?.maxQuoteDriftPercent ?? null,
        asset.change24h,
        now,
        now
      )
    }
  }

  if (!hasCatalogRows(db, 'bill_providers')) {
    const insertProvider = db.prepare(`
      INSERT INTO bill_providers (
        id, name, icon, type, account_label, account_placeholder, helper_text,
        min_amount, max_amount, requires_network, requires_account, is_active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const provider of BILL_PROVIDERS) {
      insertProvider.run(
        provider.id,
        provider.name,
        provider.icon,
        provider.type,
        provider.accountLabel ?? null,
        provider.accountPlaceholder ?? null,
        provider.helperText ?? null,
        provider.minAmount ?? null,
        provider.maxAmount ?? null,
        provider.requiresNetwork === true ? 1 : 0,
        provider.requiresAccount === false ? 0 : 1,
        provider.isActive === false ? 0 : 1,
        now,
        now
      )
    }
  }

  if (!hasCatalogRows(db, 'network_providers')) {
    const insertNetwork = db.prepare(`
      INSERT INTO network_providers (name, icon, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `)

    for (const provider of NETWORK_PROVIDERS) {
      insertNetwork.run(provider.name, provider.icon, now, now)
    }
  }
}

function writeSnapshotSync(db: DatabaseSync, snapshot: AppDatabase) {
  db.exec('BEGIN')

  try {
    db.exec(`
      DELETE FROM notifications;
      DELETE FROM sessions;
      DELETE FROM transactions;
      DELETE FROM wallets;
      DELETE FROM users;
    `)

    const insertUser = db.prepare(`
      INSERT INTO users (
        id, name, email, phone, handle, referralCode, referredByUserId, referredByReferralCode, referredAt, accountStatus, kycStatus, tier, createdAt, passwordHash, passwordSalt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertWallet = db.prepare(`
      INSERT INTO wallets (user_id, balance, locked_balance, currency, virtual_accounts)
      VALUES (?, ?, ?, ?, ?)
    `)

    const insertTransaction = db.prepare(`
      INSERT INTO transactions (
        id, user_id, type, status, amount, fee, description, reference, recipient, narration, created_at, icon, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertSession = db.prepare(`
      INSERT INTO sessions (token, user_id, expires_at, created_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertNotification = db.prepare(`
      INSERT INTO notifications (id, user_id, title, message, type, read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const insertSecuritySettings = db.prepare(`
      INSERT INTO security_settings (
        user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const user of snapshot.users) {
      insertUser.run(
        user.id,
        user.name,
        user.email,
        user.phone,
        user.handle,
        user.referralCode,
        user.referredByUserId ?? null,
        user.referredByReferralCode ?? null,
        user.referredAt ?? null,
        user.accountStatus ?? 'active',
        user.kycStatus,
        user.tier,
        user.createdAt,
        user.passwordHash,
        user.passwordSalt
      )

      const wallet = snapshot.wallets[user.id]
      if (wallet) {
        insertWallet.run(
          user.id,
          wallet.balance,
          wallet.lockedBalance,
          wallet.currency,
          JSON.stringify(wallet.virtualAccounts)
        )
      }

      for (const transaction of snapshot.transactions[user.id] ?? []) {
        insertTransaction.run(
          transaction.id,
          user.id,
          transaction.type,
          transaction.status,
          transaction.amount,
          transaction.fee,
          transaction.description,
          transaction.reference,
          transaction.recipient ?? null,
          transaction.narration ?? null,
          transaction.createdAt,
          transaction.icon ?? null,
          transaction.metadata ? JSON.stringify(transaction.metadata) : null
        )
      }

      for (const notification of snapshot.notifications[user.id] ?? []) {
        insertNotification.run(
          notification.id,
          user.id,
          notification.title,
          notification.message,
          notification.type,
          notification.read ? 1 : 0,
          notification.createdAt
        )
      }

      insertSecuritySettings.run(user.id, 0, null, null, 0, null, 0, 1, user.createdAt, user.createdAt)
    }

    for (const session of snapshot.sessions) {
      insertSession.run(
        session.token,
        session.userId,
        session.expiresAt,
        session.createdAt,
        session.userAgent ?? null,
        session.ipAddress ?? null
      )
    }

    seedLedgerFromWalletSnapshots(db)

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function readSnapshotSync(db: DatabaseSync): AppDatabase {
  const users = db.prepare('SELECT * FROM users ORDER BY createdAt ASC').all() as UserRow[]
  const walletRows = db.prepare('SELECT * FROM wallets').all() as WalletRow[]
  const transactionRows = db
    .prepare('SELECT * FROM transactions ORDER BY created_at DESC')
    .all() as TransactionRow[]
  const sessionRows = db
    .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
    .all() as SessionRow[]
  const notificationRows = db
    .prepare('SELECT * FROM notifications ORDER BY created_at DESC')
    .all() as NotificationRow[]

  const wallets: Record<string, Wallet> = {}
  for (const row of walletRows) {
    wallets[row.user_id] = {
      balance: Number(row.balance),
      lockedBalance: Number(row.locked_balance),
      reserveBalance: 0,
      reserveLockedBalance: 0,
      currency: row.currency,
      virtualAccounts: parseJson(row.virtual_accounts, [] as Wallet['virtualAccounts']),
    }
  }

  const transactions: Record<string, Transaction[]> = {}
  for (const row of transactionRows) {
    const entry: Transaction = {
      id: row.id,
      type: row.type,
      status: row.status,
      amount: Number(row.amount),
      fee: Number(row.fee),
      description: row.description,
      reference: row.reference,
      recipient: row.recipient ?? undefined,
      narration: row.narration ?? undefined,
      createdAt: row.created_at,
      icon: row.icon ?? undefined,
      metadata: parseJson(row.metadata, undefined as Transaction['metadata']),
    }

    transactions[row.user_id] = [...(transactions[row.user_id] ?? []), entry]
  }

  const sessions = sessionRows.map((row): SessionRecord => ({
    token: row.token,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    userAgent: row.user_agent ?? undefined,
    ipAddress: row.ip_address ?? undefined,
  }))

  const notifications: Record<string, NotificationRecord[]> = {}
  for (const row of notificationRows) {
    const entry = mapNotificationRow(row)

    notifications[row.user_id] = [...(notifications[row.user_id] ?? []), entry]
  }

  for (const user of users) {
    wallets[user.id] ??= {
      balance: 0,
      lockedBalance: 0,
      reserveBalance: 0,
      reserveLockedBalance: 0,
      currency: 'NGN',
      virtualAccounts: [],
    }
    transactions[user.id] ??= []
    notifications[user.id] ??= []
  }

  return {
    users,
    wallets,
    transactions,
    sessions,
    notifications,
  }
}

async function loadSeedSnapshot(): Promise<AppDatabase> {
  try {
    await access(LEGACY_JSON_FILE)
    const raw = await readFile(LEGACY_JSON_FILE, 'utf8')
    return normalizeDb(raw)
  } catch {
    return defaultDb()
  }
}

async function ensureDbReady() {
  if (!dbReady) {
    dbReady = (async () => {
      await mkdir(DATA_DIR, { recursive: true })
      const db = getDb()
      initSchema(db)
      migrateSchema(db)

      if (!hasAnyUsers(db)) {
        writeSnapshotSync(db, await loadSeedSnapshot())
      }

      seedCatalogTables(db)
      seedLedgerFromWalletSnapshots(db)
    })()
  }

  await dbReady
}

export async function readDb(): Promise<AppDatabase> {
  await ensureDbReady()
  return readSnapshotSync(getDb())
}

export async function writeDb(db: AppDatabase) {
  await ensureDbReady()
  writeSnapshotSync(getDb(), db)
}

export async function getUserById(userId: string): Promise<StoredUser | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [userId])
    return result.rows[0] ?? null
  }
  const row = getDb().prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(userId) as UserRow | undefined
  return row ?? null
}

export async function getUserByEmail(email: string): Promise<StoredUser | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<UserRow>('SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1', [email.trim()])
    return result.rows[0] ?? null
  }
  const row = getDb()
    .prepare('SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1')
    .get(email.trim()) as UserRow | undefined
  return row ?? null
}

export async function getUserByPhone(phone: string): Promise<StoredUser | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<UserRow>('SELECT * FROM users WHERE phone = ? LIMIT 1', [phone.trim()])
    return result.rows[0] ?? null
  }
  const row = getDb()
    .prepare('SELECT * FROM users WHERE phone = ? LIMIT 1')
    .get(phone.trim()) as UserRow | undefined
  return row ?? null
}

export async function getUserByVirtualAccountNumber(accountNumber: string): Promise<StoredUser | null> {
  await ensureDbReady()
  const normalized = accountNumber.trim()
  if (!normalized) return null

  if (isPostgresEnabled()) {
    const wallets = await queryPostgres<Pick<WalletRow, 'user_id' | 'virtual_accounts'>>('SELECT user_id, virtual_accounts FROM wallets')
    for (const wallet of wallets.rows) {
      const accounts = parseJson(wallet.virtual_accounts, [] as Wallet['virtualAccounts'])
      if (!accounts.some(item => typeof item.accountNumber === 'string' && item.accountNumber.trim() === normalized)) continue
      return getUserById(wallet.user_id)
    }
    return null
  }

  const rows = getDb()
    .prepare('SELECT user_id, virtual_accounts FROM wallets')
    .all() as Pick<WalletRow, 'user_id' | 'virtual_accounts'>[]

  for (const row of rows) {
    const virtualAccounts = parseJson(row.virtual_accounts, [] as Wallet['virtualAccounts'])
    const matched = virtualAccounts.some(item => typeof item.accountNumber === 'string' && item.accountNumber.trim() === normalized)
    if (!matched) continue

    const userRow = getDb()
      .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
      .get(row.user_id) as UserRow | undefined
    if (userRow) return userRow
  }

  return null
}

export async function getUserByVirtualAccountReference(reference: string): Promise<StoredUser | null> {
  await ensureDbReady()
  const normalized = reference.trim()
  if (!normalized) return null

  if (isPostgresEnabled()) {
    const wallets = await queryPostgres<Pick<WalletRow, 'user_id' | 'virtual_accounts'>>('SELECT user_id, virtual_accounts FROM wallets')
    for (const wallet of wallets.rows) {
      const accounts = parseJson(wallet.virtual_accounts, [] as Wallet['virtualAccounts'])
      if (!accounts.some(item => typeof item.reference === 'string' && item.reference.trim() === normalized)) continue
      return getUserById(wallet.user_id)
    }
    return null
  }

  const rows = getDb()
    .prepare('SELECT user_id, virtual_accounts FROM wallets')
    .all() as Pick<WalletRow, 'user_id' | 'virtual_accounts'>[]

  for (const row of rows) {
    const virtualAccounts = parseJson(row.virtual_accounts, [] as Wallet['virtualAccounts'])
    const matched = virtualAccounts.some(item => typeof item.reference === 'string' && item.reference.trim() === normalized)
    if (!matched) continue

    const userRow = getDb()
      .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
      .get(row.user_id) as UserRow | undefined
    if (userRow) return userRow
  }

  return null
}

export async function getUserByHandle(handle: string): Promise<StoredUser | null> {
  await ensureDbReady()
  const normalized = handle.trim().replace(/^@/, '')
  if (isPostgresEnabled()) {
    const result = await queryPostgres<UserRow>('SELECT * FROM users WHERE lower(handle) = lower(?) OR lower(handle) = lower(?) LIMIT 1', [`@${normalized}`, normalized])
    return result.rows[0] ?? null
  }
  const row = getDb()
    .prepare('SELECT * FROM users WHERE lower(handle) = lower(?) OR lower(handle) = lower(?) LIMIT 1')
    .get(`@${normalized}`, normalized) as UserRow | undefined
  return row ?? null
}

export async function getUserByReferralCode(referralCode: string): Promise<StoredUser | null> {
  await ensureDbReady()
  const normalized = referralCode.trim().toUpperCase()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<UserRow>('SELECT * FROM users WHERE upper("referralCode") = ? LIMIT 1', [normalized])
    return result.rows[0] ?? null
  }
  const row = getDb()
    .prepare('SELECT * FROM users WHERE upper(referralCode) = ? LIMIT 1')
    .get(normalized) as UserRow | undefined
  return row ?? null
}

export async function listUsers(): Promise<User[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) return (await queryPostgres<UserRow>('SELECT * FROM users ORDER BY "createdAt" DESC')).rows.map(sanitizeUser)
  const rows = getDb()
    .prepare('SELECT * FROM users ORDER BY createdAt DESC')
    .all() as UserRow[]
  return rows.map(sanitizeUser)
}

/**
 * Total NGN the platform owes its users, across every account.
 *
 * Summed in SQL over the whole ledger rather than by walking wallets, because the admin wallet
 * list is capped and a liability derived from a capped list understates what is owed. A coverage
 * figure built on a partial total would read as healthy while short.
 *
 * Includes locked balances: funds mid-payout are still customer money until the payout settles.
 */
export async function getTotalWalletLiability(): Promise<number> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<{ total: string }>(`SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS total FROM ledger_entries WHERE COALESCE(asset, 'NGN') = 'NGN' AND account IN ('available', 'locked')`)
    return Math.round(Number(result.rows[0]?.total ?? 0) * 100) / 100
  }
  const row = getDb()
    .prepare(`
      SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS total
      FROM ledger_entries
      WHERE COALESCE(asset, 'NGN') = 'NGN'
        AND account IN ('available', 'locked')
    `)
    .get() as { total: number } | undefined
  // Kobo-round: ledger sums are floats, so trim the drift before it reaches a coverage figure.
  return Math.round(Number(row?.total ?? 0) * 100) / 100
}

export type ProfitMarginRecord = {
  key: string
  valueNgn: number
  updatedAt: string
  updatedBy?: string
}

/**
 * Admin-set flat profit margins, keyed by product (e.g. transfer_out).
 *
 * Data plans use pricing_rules instead. A missing row means "never configured" — resolveMargin
 * treats that as 0. Absence is still distinguishable from an explicit zero via getProfitMargin
 * returning null.
 */
export async function getProfitMargins(): Promise<ProfitMarginRecord[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<{ key: string; value_ngn: number; updated_at: string; updated_by: string | null }>('SELECT key, value_ngn, updated_at, updated_by FROM profit_margins ORDER BY key ASC')
    return result.rows.map(row => ({ key: row.key, valueNgn: Number(row.value_ngn), updatedAt: row.updated_at, updatedBy: row.updated_by ?? undefined }))
  }
  const rows = getDb()
    .prepare('SELECT key, value_ngn, updated_at, updated_by FROM profit_margins ORDER BY key ASC')
    .all() as Array<{ key: string; value_ngn: number; updated_at: string; updated_by: string | null }>

  return rows.map(row => ({
    key: row.key,
    valueNgn: Number(row.value_ngn),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? undefined,
  }))
}

/** One margin by key, or null when the admin has never set it. */
export async function getProfitMargin(key: string): Promise<number | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<{ value_ngn: number }>('SELECT value_ngn FROM profit_margins WHERE key = ? LIMIT 1', [key])
    if (!result.rows[0]) return null
    const value = Number(result.rows[0].value_ngn)
    return Number.isFinite(value) ? value : null
  }
  const row = getDb()
    .prepare('SELECT value_ngn FROM profit_margins WHERE key = ? LIMIT 1')
    .get(key) as { value_ngn: number } | undefined

  if (!row) return null
  const value = Number(row.value_ngn)
  return Number.isFinite(value) ? value : null
}

export async function upsertProfitMargin(input: {
  key: string
  valueNgn: number
  updatedBy?: string
}): Promise<ProfitMarginRecord> {
  await ensureDbReady()
  const updatedAt = new Date().toISOString()
  const value = Math.round(input.valueNgn * 100) / 100
  if (isPostgresEnabled()) {
    await queryPostgres(`INSERT INTO profit_margins (key, value_ngn, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_ngn = excluded.value_ngn, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, [input.key, value, updatedAt, input.updatedBy ?? null])
    return { key: input.key, valueNgn: value, updatedAt, updatedBy: input.updatedBy }
  }

  getDb().prepare(`
    INSERT INTO profit_margins (key, value_ngn, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_ngn = excluded.value_ngn,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(input.key, value, updatedAt, input.updatedBy ?? null)

  return { key: input.key, valueNgn: value, updatedAt, updatedBy: input.updatedBy }
}

export type PricingRuleRecord = {
  id: string
  scope: string
  vendor: string | null
  network: string | null
  planType: string | null
  variationCode: string | null
  marginBps: number
  marginKobo: number
  minMarginKobo: number
  maxMarginKobo: number | null
  roundToKobo: number
  active: boolean
  note: string | null
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
}

type PricingRuleRow = {
  id: string
  scope: string
  vendor: string
  network: string
  plan_type: string
  variation_code: string
  margin_bps: number
  margin_kobo: number
  min_margin_kobo: number
  max_margin_kobo: number | null
  round_to_kobo: number
  active: number
  note: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function nullToEmpty(value: string | null | undefined): string {
  return value?.trim() || ''
}

function mapPricingRuleRow(row: PricingRuleRow): PricingRuleRecord {
  return {
    id: row.id,
    scope: row.scope,
    vendor: emptyToNull(row.vendor),
    network: emptyToNull(row.network),
    planType: emptyToNull(row.plan_type),
    variationCode: emptyToNull(row.variation_code),
    marginBps: Number(row.margin_bps) || 0,
    marginKobo: Number(row.margin_kobo) || 0,
    minMarginKobo: Number(row.min_margin_kobo) || 0,
    maxMarginKobo: row.max_margin_kobo == null ? null : Number(row.max_margin_kobo),
    roundToKobo: Number(row.round_to_kobo) || 0,
  active: Boolean(row.active) || Number(row.active) === 1,
    note: row.note,
    createdBy: row.created_by ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getPricingRules(options?: { activeOnly?: boolean }): Promise<PricingRuleRecord[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<PricingRuleRow>(options?.activeOnly ? 'SELECT * FROM pricing_rules WHERE active = ? ORDER BY updated_at DESC' : 'SELECT * FROM pricing_rules ORDER BY scope ASC, updated_at DESC', options?.activeOnly ? [true] : [])
    return result.rows.map(mapPricingRuleRow)
  }
  const rows = options?.activeOnly
    ? getDb()
      .prepare('SELECT * FROM pricing_rules WHERE active = 1 ORDER BY updated_at DESC')
      .all() as PricingRuleRow[]
    : getDb()
      .prepare('SELECT * FROM pricing_rules ORDER BY scope ASC, updated_at DESC')
      .all() as PricingRuleRow[]

  return rows.map(mapPricingRuleRow)
}

export async function getPricingRuleById(id: string): Promise<PricingRuleRecord | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<PricingRuleRow>('SELECT * FROM pricing_rules WHERE id = ? LIMIT 1', [id])
    return result.rows[0] ? mapPricingRuleRow(result.rows[0]) : null
  }
  const row = getDb()
    .prepare('SELECT * FROM pricing_rules WHERE id = ? LIMIT 1')
    .get(id) as PricingRuleRow | undefined
  return row ? mapPricingRuleRow(row) : null
}

export async function findPricingRuleByTarget(input: {
  scope: string
  vendor?: string | null
  network?: string | null
  planType?: string | null
  variationCode?: string | null
}): Promise<PricingRuleRecord | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<PricingRuleRow>('SELECT * FROM pricing_rules WHERE scope = ? AND vendor = ? AND network = ? AND plan_type = ? AND variation_code = ? LIMIT 1', [input.scope, nullToEmpty(input.vendor), nullToEmpty(input.network), nullToEmpty(input.planType), nullToEmpty(input.variationCode)])
    return result.rows[0] ? mapPricingRuleRow(result.rows[0]) : null
  }
  const row = getDb()
    .prepare(`
      SELECT * FROM pricing_rules
      WHERE scope = ?
        AND vendor = ?
        AND network = ?
        AND plan_type = ?
        AND variation_code = ?
      LIMIT 1
    `)
    .get(
      input.scope,
      nullToEmpty(input.vendor),
      nullToEmpty(input.network),
      nullToEmpty(input.planType),
      nullToEmpty(input.variationCode),
    ) as PricingRuleRow | undefined
  return row ? mapPricingRuleRow(row) : null
}

export async function createPricingRule(input: {
  scope: string
  vendor?: string | null
  network?: string | null
  planType?: string | null
  variationCode?: string | null
  marginBps: number
  marginKobo: number
  minMarginKobo: number
  maxMarginKobo: number | null
  roundToKobo: number
  note?: string | null
  createdBy?: string
}): Promise<PricingRuleRecord> {
  await ensureDbReady()
  const id = `prule_${randomBytes(8).toString('hex')}`
  const now = new Date().toISOString()

  if (isPostgresEnabled()) {
    const result = await queryPostgres<PricingRuleRow>(`
      INSERT INTO pricing_rules (id, scope, vendor, network, plan_type, variation_code, margin_bps, margin_kobo, min_margin_kobo, max_margin_kobo, round_to_kobo, active, note, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `, [id, input.scope, nullToEmpty(input.vendor), nullToEmpty(input.network), nullToEmpty(input.planType), nullToEmpty(input.variationCode), Math.round(input.marginBps), Math.round(input.marginKobo), Math.round(input.minMarginKobo), input.maxMarginKobo == null ? null : Math.round(input.maxMarginKobo), Math.round(input.roundToKobo), true, input.note?.trim() || null, input.createdBy ?? null, input.createdBy ?? null, now, now])
    if (!result.rows[0]) throw new Error('Failed to create pricing rule.')
    return mapPricingRuleRow(result.rows[0])
  }

  getDb().prepare(`
    INSERT INTO pricing_rules (
      id, scope, vendor, network, plan_type, variation_code,
      margin_bps, margin_kobo, min_margin_kobo, max_margin_kobo, round_to_kobo,
      active, note, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.scope,
    nullToEmpty(input.vendor),
    nullToEmpty(input.network),
    nullToEmpty(input.planType),
    nullToEmpty(input.variationCode),
    Math.round(input.marginBps),
    Math.round(input.marginKobo),
    Math.round(input.minMarginKobo),
    input.maxMarginKobo == null ? null : Math.round(input.maxMarginKobo),
    Math.round(input.roundToKobo),
    input.note?.trim() || null,
    input.createdBy ?? null,
    input.createdBy ?? null,
    now,
    now,
  )

  const created = await getPricingRuleById(id)
  if (!created) throw new Error('Failed to create pricing rule.')
  return created
}

export async function updatePricingRule(
  id: string,
  input: {
    marginBps: number
    marginKobo: number
    minMarginKobo: number
    maxMarginKobo: number | null
    roundToKobo: number
    note?: string | null
    updatedBy?: string
  },
): Promise<PricingRuleRecord | null> {
  await ensureDbReady()
  const existing = await getPricingRuleById(id)
  if (!existing) return null

  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`UPDATE pricing_rules SET margin_bps = ?, margin_kobo = ?, min_margin_kobo = ?, max_margin_kobo = ?, round_to_kobo = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?`, [Math.round(input.marginBps), Math.round(input.marginKobo), Math.round(input.minMarginKobo), input.maxMarginKobo == null ? null : Math.round(input.maxMarginKobo), Math.round(input.roundToKobo), input.note?.trim() || null, input.updatedBy ?? null, now, id])
    return getPricingRuleById(id)
  }
  getDb().prepare(`
    UPDATE pricing_rules SET
      margin_bps = ?,
      margin_kobo = ?,
      min_margin_kobo = ?,
      max_margin_kobo = ?,
      round_to_kobo = ?,
      note = ?,
      updated_by = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    Math.round(input.marginBps),
    Math.round(input.marginKobo),
    Math.round(input.minMarginKobo),
    input.maxMarginKobo == null ? null : Math.round(input.maxMarginKobo),
    Math.round(input.roundToKobo),
    input.note?.trim() || null,
    input.updatedBy ?? null,
    now,
    id,
  )

  return getPricingRuleById(id)
}

export async function setPricingRuleActive(
  id: string,
  active: boolean,
  updatedBy?: string,
): Promise<PricingRuleRecord | null> {
  await ensureDbReady()
  const existing = await getPricingRuleById(id)
  if (!existing) return null

  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE pricing_rules SET active = ?, updated_by = ?, updated_at = ? WHERE id = ?', [active, updatedBy ?? null, now, id])
    return getPricingRuleById(id)
  }
  getDb().prepare(`
    UPDATE pricing_rules SET active = ?, updated_by = ?, updated_at = ? WHERE id = ?
  `).run(active ? 1 : 0, updatedBy ?? null, now, id)

  return getPricingRuleById(id)
}

export async function deletePricingRule(id: string): Promise<boolean> {
  await ensureDbReady()
  if (isPostgresEnabled()) return ((await queryPostgres('DELETE FROM pricing_rules WHERE id = ?', [id])).rowCount ?? 0) > 0
  const result = getDb().prepare('DELETE FROM pricing_rules WHERE id = ?').run(id)
  return Number(result.changes ?? 0) > 0
}

export async function getReferralOverviewByUserId(userId: string): Promise<ReferralOverview | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const userResult = await queryPostgres<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [userId])
    const user = userResult.rows[0]
    if (!user) return null
    const [referredResult, totalResult, bonusResult] = await Promise.all([
      queryPostgres<UserRow>('SELECT * FROM users WHERE "referredByUserId" = ? ORDER BY "createdAt" DESC', [userId]),
      queryPostgres<{ total: string }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND type = ? AND status = ?`, [userId, 'referral_bonus', 'success']),
      queryPostgres<Pick<TransactionRow, 'amount' | 'metadata'>>(`SELECT amount, metadata FROM transactions WHERE user_id = ? AND type = ? AND status = ? ORDER BY created_at DESC`, [userId, 'referral_bonus', 'success']),
    ])
    const bonusByUser = new Map<string, number>()
    for (const row of bonusResult.rows) {
      const metadata = readReferralBonusMetadata(parseJson(row.metadata, undefined as Record<string, unknown> | undefined))
      if (metadata.referredUserId && metadata.role === 'inviter') bonusByUser.set(metadata.referredUserId, (bonusByUser.get(metadata.referredUserId) ?? 0) + Number(row.amount))
    }
    const entries = await Promise.all(referredResult.rows.map(async row => {
      const count = await queryPostgres<{ count: string }>(`SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND status = ? AND type NOT IN ('referral_bonus', 'reward_bonus')`, [row.id, 'success'])
      const earnedAmount = bonusByUser.get(row.id) ?? 0
      return { userId: row.id, name: row.name, joinedAt: row.referredAt ?? row.createdAt, transactionCount: Number(count.rows[0]?.count ?? 0), earnedAmount, rewardPaid: earnedAmount > 0 }
    }))
    return { referralCode: user.referralCode, totalReferrals: entries.length, totalEarned: Number(totalResult.rows[0]?.total ?? 0), entries }
  }
  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(userId) as UserRow | undefined
  if (!user) return null

  const referredRows = db
    .prepare('SELECT * FROM users WHERE referredByUserId = ? ORDER BY createdAt DESC')
    .all(userId) as UserRow[]

  const totalEarnedRow = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND type = ? AND status = ?')
    .get(userId, 'referral_bonus', 'success') as { total?: number } | undefined

  const bonusRows = db
    .prepare('SELECT amount, metadata FROM transactions WHERE user_id = ? AND type = ? AND status = ? ORDER BY created_at DESC')
    .all(userId, 'referral_bonus', 'success') as Array<Pick<TransactionRow, 'amount' | 'metadata'>>

  const bonusByReferredUserId = new Map<string, number>()
  for (const row of bonusRows) {
    const metadata = readReferralBonusMetadata(parseJson(row.metadata, undefined as Record<string, unknown> | undefined))
    if (!metadata.referredUserId || metadata.role !== 'inviter') continue
    bonusByReferredUserId.set(
      metadata.referredUserId,
      (bonusByReferredUserId.get(metadata.referredUserId) ?? 0) + Number(row.amount)
    )
  }

  const entries: ReferralEntry[] = referredRows.map(row => {
    const transactionCountRow = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM transactions
        WHERE user_id = ?
          AND status = ?
          AND type NOT IN ('referral_bonus', 'reward_bonus')
      `)
      .get(row.id, 'success') as { count?: number } | undefined

    const earnedAmount = bonusByReferredUserId.get(row.id) ?? 0

    return {
      userId: row.id,
      name: row.name,
      joinedAt: row.referredAt ?? row.createdAt,
      transactionCount: Number(transactionCountRow?.count ?? 0),
      earnedAmount,
      rewardPaid: earnedAmount > 0,
    }
  })

  return {
    referralCode: user.referralCode,
    totalReferrals: entries.length,
    totalEarned: Number(totalEarnedRow?.total ?? 0),
    entries,
  }
}

export async function getSessionByToken(token: string): Promise<SessionRecord | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()])
    const result = await queryPostgres<SessionRow>('SELECT * FROM sessions WHERE token = ? LIMIT 1', [token])
    return result.rows[0] ? mapSessionRow(result.rows[0]) : null
  }
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
  const row = getDb()
    .prepare('SELECT * FROM sessions WHERE token = ? LIMIT 1')
    .get(token) as SessionRow | undefined
  return row ? mapSessionRow(row) : null
}

export async function getWalletByUserId(userId: string): Promise<Wallet | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const walletResult = await queryPostgres<WalletRow>('SELECT * FROM wallets WHERE user_id = ? LIMIT 1', [userId])
    const row = walletResult.rows[0]
    if (!row) return null
    const balancesResult = await queryPostgres<{ asset: string; account: 'available' | 'locked'; balance: number }>(`
      SELECT COALESCE(asset, 'NGN') AS asset, account,
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance
      FROM ledger_entries WHERE user_id = ? GROUP BY asset, account
    `, [userId])
    const balances = emptyAssetBalances()
    for (const balance of balancesResult.rows) {
      const asset: AssetBalanceKey = balance.asset === 'RESERVE' ? 'RESERVE' : 'NGN'
      if (balance.account === 'available') balances[asset].available = Number(balance.balance)
      if (balance.account === 'locked') balances[asset].locked = Number(balance.balance)
    }
    const persistedBalance = Number(row.balance)
    const persistedLockedBalance = Number(row.locked_balance)
    if (persistedBalance !== balances.NGN.available || persistedLockedBalance !== balances.NGN.locked) {
      await queryPostgres('UPDATE wallets SET balance = ?, locked_balance = ? WHERE user_id = ?', [balances.NGN.available, balances.NGN.locked, userId])
    }
    return buildWalletFromRow(row, balances)
  }
  const row = getDb()
    .prepare('SELECT * FROM wallets WHERE user_id = ? LIMIT 1')
    .get(userId) as WalletRow | undefined

  if (!row) return null

  const balances = calculateWalletBalances(getDb(), userId)
  if (Number(row.balance) !== balances.NGN.available || Number(row.locked_balance) !== balances.NGN.locked) {
    syncWalletSnapshot(getDb(), userId, balances)
  }

  return buildWalletFromRow(row, balances)
}

export async function getTransactionsForUser(userId: string): Promise<Transaction[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<TransactionRow>('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC', [userId])
    return result.rows.map(row => ({
      id: row.id,
      type: row.type as Transaction['type'],
      status: row.status as Transaction['status'],
      amount: Number(row.amount),
      fee: Number(row.fee),
      description: row.description,
      reference: row.reference,
      recipient: row.recipient ?? undefined,
      narration: row.narration ?? undefined,
      createdAt: row.created_at,
      icon: row.icon ?? undefined,
      metadata: parseJson(row.metadata, undefined),
    }))
  }
  const rows = getDb()
    .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as TransactionRow[]

  return rows.map((row): Transaction => ({
    id: row.id,
    type: row.type,
    status: row.status,
    amount: Number(row.amount),
    fee: Number(row.fee),
    description: row.description,
    reference: row.reference,
    recipient: row.recipient ?? undefined,
    narration: row.narration ?? undefined,
    createdAt: row.created_at,
    icon: row.icon ?? undefined,
    metadata: parseJson(row.metadata, undefined as Transaction['metadata']),
  }))
}

export async function getTransactionById(userId: string, transactionId: string): Promise<Transaction | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<TransactionRow>('SELECT * FROM transactions WHERE id = ? AND user_id = ? LIMIT 1', [transactionId, userId])
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id, type: row.type as Transaction['type'], status: row.status as Transaction['status'], amount: Number(row.amount), fee: Number(row.fee),
      description: row.description, reference: row.reference, recipient: row.recipient ?? undefined, narration: row.narration ?? undefined,
      createdAt: row.created_at, icon: row.icon ?? undefined, metadata: parseJson(row.metadata, undefined),
    }
  }
  const row = getDb()
    .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? LIMIT 1')
    .get(transactionId, userId) as TransactionRow | undefined

  if (!row) return null

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    amount: Number(row.amount),
    fee: Number(row.fee),
    description: row.description,
    reference: row.reference,
    recipient: row.recipient ?? undefined,
    narration: row.narration ?? undefined,
    createdAt: row.created_at,
    icon: row.icon ?? undefined,
    metadata: parseJson(row.metadata, undefined as Transaction['metadata']),
  }
}

export async function getAnyTransactionById(transactionId: string): Promise<{ userId: string; transaction: Transaction } | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<TransactionRow>('SELECT * FROM transactions WHERE id = ? LIMIT 1', [transactionId])
    const row = result.rows[0]
    return row ? { userId: row.user_id, transaction: mapTransactionRow(row) } : null
  }
  const row = getDb()
    .prepare('SELECT * FROM transactions WHERE id = ? LIMIT 1')
    .get(transactionId) as TransactionRow | undefined

  if (!row) return null

  return {
    userId: row.user_id,
    transaction: {
      id: row.id,
      type: row.type,
      status: row.status,
      amount: Number(row.amount),
      fee: Number(row.fee),
      description: row.description,
      reference: row.reference,
      recipient: row.recipient ?? undefined,
      narration: row.narration ?? undefined,
      createdAt: row.created_at,
      icon: row.icon ?? undefined,
      metadata: parseJson(row.metadata, undefined as Transaction['metadata']),
    },
  }
}

export async function getTransactionByReference(reference: string): Promise<{ userId: string; transaction: Transaction } | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<TransactionRow>('SELECT * FROM transactions WHERE reference = ? LIMIT 1', [reference])
    const row = result.rows[0]
    return row ? { userId: row.user_id, transaction: mapTransactionRow(row) } : null
  }
  const row = getDb()
    .prepare('SELECT * FROM transactions WHERE reference = ? LIMIT 1')
    .get(reference) as TransactionRow | undefined

  if (!row) return null

  return {
    userId: row.user_id,
    transaction: {
      id: row.id,
      type: row.type,
      status: row.status,
      amount: Number(row.amount),
      fee: Number(row.fee),
      description: row.description,
      reference: row.reference,
      recipient: row.recipient ?? undefined,
      narration: row.narration ?? undefined,
      createdAt: row.created_at,
      icon: row.icon ?? undefined,
      metadata: parseJson(row.metadata, undefined as Transaction['metadata']),
    },
  }
}

export async function createStandaloneTransaction(userId: string, transaction: Transaction): Promise<Transaction> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres(`INSERT INTO transactions (id, user_id, type, status, amount, fee, description, reference, recipient, narration, created_at, icon, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [transaction.id, userId, transaction.type, transaction.status, transaction.amount, transaction.fee, transaction.description, transaction.reference, transaction.recipient ?? null, transaction.narration ?? null, transaction.createdAt, transaction.icon ?? null, transaction.metadata ? JSON.stringify(transaction.metadata) : null])
    const inserted = await getTransactionById(userId, transaction.id)
    if (!inserted) throw new Error('Unable to persist transaction.')
    await maybeApplyFirstSuccessfulTransactionRewards(userId, inserted)
    return inserted
  }
  const db = getDb()
  db.prepare(`
    INSERT INTO transactions (
      id, user_id, type, status, amount, fee, description, reference, recipient, narration, created_at, icon, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    transaction.id,
    userId,
    transaction.type,
    transaction.status,
    transaction.amount,
    transaction.fee,
    transaction.description,
    transaction.reference,
    transaction.recipient ?? null,
    transaction.narration ?? null,
    transaction.createdAt,
    transaction.icon ?? null,
    transaction.metadata ? JSON.stringify(transaction.metadata) : null
  )

  const inserted = await getTransactionById(userId, transaction.id)
  if (!inserted) {
    throw new Error('Unable to persist transaction.')
  }
  await maybeApplyFirstSuccessfulTransactionRewards(userId, inserted)
  return inserted
}

export async function updateTransactionStatus(userId: string, transactionId: string, status: Transaction['status']) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE transactions SET status = ? WHERE id = ? AND user_id = ?', [status, transactionId, userId])
    const updated = await getTransactionById(userId, transactionId)
    if (updated) await maybeApplyFirstSuccessfulTransactionRewards(userId, updated)
    return updated
  }
  getDb().prepare('UPDATE transactions SET status = ? WHERE id = ? AND user_id = ?').run(status, transactionId, userId)
  const updated = await getTransactionById(userId, transactionId)
  if (updated) {
    await maybeApplyFirstSuccessfulTransactionRewards(userId, updated)
  }
  return updated
}

export async function listRecentTransactions(limit = 40): Promise<Array<{ userId: string; transaction: Transaction }>> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<TransactionRow>('SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?', [limit])
    return result.rows.map(row => ({ userId: row.user_id, transaction: mapTransactionRow(row) }))
  }
  const rows = getDb()
    .prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?')
    .all(limit) as TransactionRow[]

  return rows.map(row => ({
    userId: row.user_id,
    transaction: {
      id: row.id,
      type: row.type,
      status: row.status,
      amount: Number(row.amount),
      fee: Number(row.fee),
      description: row.description,
      reference: row.reference,
      recipient: row.recipient ?? undefined,
      narration: row.narration ?? undefined,
      createdAt: row.created_at,
      icon: row.icon ?? undefined,
      metadata: parseJson(row.metadata, undefined as Transaction['metadata']),
    },
  }))
}

export async function listPendingBillTransactions(limit = 50): Promise<Array<{ userId: string; transaction: Transaction }>> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<TransactionRow>(`
      SELECT * FROM transactions WHERE status = 'pending'
      AND type IN ('airtime', 'data', 'electric', 'cable', 'education', 'gas', 'insurance', 'water')
      ORDER BY created_at DESC LIMIT ?
    `, [limit])
    return result.rows.map(row => ({ userId: row.user_id, transaction: mapTransactionRow(row) }))
  }
  const rows = getDb()
    .prepare(`
      SELECT * FROM transactions
      WHERE status = 'pending'
        AND type IN ('airtime', 'data', 'electric', 'cable', 'education', 'gas', 'insurance', 'water')
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(limit) as TransactionRow[]

  return rows
    .map(row => ({
      userId: row.user_id,
      transaction: {
        id: row.id,
        type: row.type,
        status: row.status,
        amount: Number(row.amount),
        fee: Number(row.fee),
        description: row.description,
        reference: row.reference,
        recipient: row.recipient ?? undefined,
        narration: row.narration ?? undefined,
        createdAt: row.created_at,
        icon: row.icon ?? undefined,
        metadata: parseJson(row.metadata, undefined as Transaction['metadata']),
      },
    }))
    .filter(item => item.transaction.metadata?.providerName === 'flutterwave' && item.transaction.metadata?.settlementKind === 'provider_bill')
}

export async function getLedgerEntriesForTransaction(userId: string, transactionId: string): Promise<LedgerEntry[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<LedgerEntryRow>('SELECT * FROM ledger_entries WHERE user_id = ? AND transaction_id = ? ORDER BY created_at ASC', [userId, transactionId])
    return result.rows.map(mapLedgerEntryRow)
  }
  const rows = getDb()
    .prepare('SELECT * FROM ledger_entries WHERE user_id = ? AND transaction_id = ? ORDER BY created_at ASC')
    .all(userId, transactionId) as LedgerEntryRow[]
  return rows.map(mapLedgerEntryRow)
}

export async function listLedgerEntries(limit = 100): Promise<LedgerEntry[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) return (await queryPostgres<LedgerEntryRow>('SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT ?', [limit])).rows.map(mapLedgerEntryRow)
  const rows = getDb()
    .prepare('SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT ?')
    .all(limit) as LedgerEntryRow[]
  return rows.map(mapLedgerEntryRow)
}

async function maybeApplyRewardRulesForEvent(input: {
  event: RewardRule['triggerEvent']
  sourceUserId: string
  transaction?: Transaction
}) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const sourceResult = await queryPostgres<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [input.sourceUserId])
    const sourceUser = sourceResult.rows[0]
    if (!sourceUser) return
    const rules = (await queryPostgres<RewardRuleRow>('SELECT * FROM reward_rules WHERE is_active = ? AND trigger_event = ? ORDER BY created_at ASC, id ASC', [true, input.event])).rows.map(mapRewardRuleRow)
    for (const rule of rules) {
      if (rule.requiresReferral && !sourceUser.referredByUserId) continue
      if (input.event === 'first_successful_transaction') {
        if (!input.transaction || !isReferralRewardEligibleTransaction(input.transaction)) continue
        if (rule.allowedTransactionTypes?.length && !rule.allowedTransactionTypes.includes(input.transaction.type)) continue
        if (rule.excludedTransactionTypes?.length && rule.excludedTransactionTypes.includes(input.transaction.type)) continue
      }
      const beneficiaryUserId = rule.audience === 'inviter' ? sourceUser.referredByUserId : sourceUser.id
      if (!beneficiaryUserId) continue
      const beneficiary = (await queryPostgres<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [beneficiaryUserId])).rows[0]
      if (!beneficiary) continue
      const rewardType: Transaction['type'] = rule.kind === 'referral' ? 'referral_bonus' : 'reward_bonus'
      const duplicate = await queryPostgres<{ id: string }>(`SELECT id FROM transactions WHERE user_id = ? AND type = ? AND status = ? AND metadata LIKE ? LIMIT 1`, [beneficiary.id, rewardType, 'success', `%"rewardRuleId":"${rule.id}"%`])
      const existingRequest = await queryPostgres<{ id: string }>('SELECT id FROM reward_award_requests WHERE reward_rule_id = ? AND source_user_id = ? LIMIT 1', [rule.id, sourceUser.id])
      if (duplicate.rows[0] || existingRequest.rows[0]) continue
      const now = new Date().toISOString()
      if (Number.isFinite(rule.dailyPayoutCapNgn) && (rule.dailyPayoutCapNgn ?? 0) > 0) {
        const dailyCap = rule.dailyPayoutCapNgn ?? 0
        const date = new Date()
        const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString()
        const dayEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString()
        const paid = await queryPostgres<{ total: string }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = ? AND status = ? AND metadata LIKE ? AND created_at >= ? AND created_at < ?`, [rewardType, 'success', `%"rewardRuleId":"${rule.id}"%`, dayStart, dayEnd])
        const paidToday = Number(paid.rows[0]?.total ?? 0)
        if (paidToday + rule.amountNgn > dailyCap) {
          const requestId = `reward_req_${randomBytes(6).toString('hex')}`
          await queryPostgres(`INSERT INTO reward_award_requests (id, reward_rule_id, reward_rule_name, reward_kind, reward_type, trigger_event, audience, beneficiary_user_id, source_user_id, trigger_transaction_id, amount_ngn, status, status_reason, reviewed_at, reviewed_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [requestId, rule.id, rule.name, rule.kind, rewardType, rule.triggerEvent, rule.audience, beneficiary.id, sourceUser.id, input.transaction?.id ?? null, rule.amountNgn, 'rejected', `Daily payout cap reached at â‚¦${dailyCap.toLocaleString('en-NG')}.`, now, null, now, now])
          await insertAuditLog({ userId: beneficiary.id, actorUserId: sourceUser.id, action: 'reward.rule_rejected_cap', entityType: 'reward_award_request', entityId: requestId, metadata: { rewardRuleId: rule.id, sourceUserId: sourceUser.id, amount: rule.amountNgn, dailyPayoutCapNgn: dailyCap, paidTodayNgn: paidToday } })
          continue
        }
      }
      if (rule.manualApprovalRequired) {
        const requestId = `reward_req_${randomBytes(6).toString('hex')}`
        await queryPostgres(`INSERT INTO reward_award_requests (id, reward_rule_id, reward_rule_name, reward_kind, reward_type, trigger_event, audience, beneficiary_user_id, source_user_id, trigger_transaction_id, amount_ngn, status, status_reason, reviewed_at, reviewed_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [requestId, rule.id, rule.name, rule.kind, rewardType, rule.triggerEvent, rule.audience, beneficiary.id, sourceUser.id, input.transaction?.id ?? null, rule.amountNgn, 'pending', 'Waiting for admin approval.', null, null, now, now])
        await insertAuditLog({ userId: beneficiary.id, actorUserId: sourceUser.id, action: 'reward.rule_pending_manual', entityType: 'reward_award_request', entityId: requestId, metadata: { rewardRuleId: rule.id, sourceUserId: sourceUser.id, amount: rule.amountNgn } })
        continue
      }
      const rewardTransaction: Transaction = { id: `tx_${randomBytes(6).toString('hex')}`, type: rewardType, status: 'success', amount: rule.amountNgn, fee: 0, description: rule.kind === 'referral' ? `${rule.name} â€” ${sourceUser.name}` : rule.name, reference: generateRef(), createdAt: now, icon: rule.kind === 'referral' ? 'â‚¦' : 'ðŸŽ', metadata: { rewardRuleId: rule.id, rewardRuleName: rule.name, rewardEvent: rule.triggerEvent, sourceUserId: sourceUser.id, sourceReferralCode: sourceUser.referredByReferralCode ?? '', triggerTransactionId: input.transaction?.id, role: rule.audience, referredUserId: rule.audience === 'inviter' ? sourceUser.id : undefined } }
      await applyWalletMutation({ userId: beneficiary.id, asset: 'NGN', balanceDelta: rule.amountNgn, transaction: rewardTransaction })
      await insertNotification(createNotification({ userId: beneficiary.id, title: `${rule.name} paid`, message: `You earned â‚¦${rule.amountNgn.toLocaleString('en-NG')} from the "${rule.name}" reward rule.`, type: 'success' }))
      await insertAuditLog({ userId: beneficiary.id, actorUserId: sourceUser.id, action: 'reward.rule_applied', entityType: 'transaction', entityId: rewardTransaction.id, metadata: { rewardRuleId: rule.id, sourceUserId: sourceUser.id, amount: rule.amountNgn } })
    }
    return
  }
  const db = getDb()
  const sourceUser = db
    .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
    .get(input.sourceUserId) as UserRow | undefined

  if (!sourceUser) return

  const ruleRows = db
    .prepare('SELECT * FROM reward_rules WHERE is_active = 1 AND trigger_event = ? ORDER BY created_at ASC, id ASC')
    .all(input.event) as RewardRuleRow[]

  for (const row of ruleRows) {
    const rule = mapRewardRuleRow(row)
    if (rule.requiresReferral && !sourceUser.referredByUserId) continue

    if (input.event === 'first_successful_transaction') {
      if (!input.transaction || !isReferralRewardEligibleTransaction(input.transaction)) continue
      if (rule.allowedTransactionTypes?.length && !rule.allowedTransactionTypes.includes(input.transaction.type)) continue
      if (rule.excludedTransactionTypes?.length && rule.excludedTransactionTypes.includes(input.transaction.type)) continue
    }

    let beneficiaryUserId = sourceUser.id
    if (rule.audience === 'inviter') {
      if (!sourceUser.referredByUserId) continue
      beneficiaryUserId = sourceUser.referredByUserId
    }

    const beneficiary = db
      .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
      .get(beneficiaryUserId) as UserRow | undefined
    if (!beneficiary) continue

    const rewardTransactionType: Transaction['type'] = rule.kind === 'referral' ? 'referral_bonus' : 'reward_bonus'
    const existingRewardRows = db
      .prepare('SELECT metadata FROM transactions WHERE user_id = ? AND type = ? AND status = ?')
      .all(beneficiary.id, rewardTransactionType, 'success') as Array<Pick<TransactionRow, 'metadata'>>

    const alreadyAwarded = existingRewardRows.some(existingRow => {
      const metadata = parseJson(existingRow.metadata, undefined as Record<string, unknown> | undefined)
      return metadata?.rewardRuleId === rule.id && metadata?.sourceUserId === sourceUser.id
    })
    if (alreadyAwarded) continue

    const existingRequest = db
      .prepare(`
        SELECT *
        FROM reward_award_requests
        WHERE reward_rule_id = ?
          AND source_user_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
      `)
      .get(rule.id, sourceUser.id) as RewardAwardRequestRow | undefined
    if (existingRequest) continue

    const now = new Date()
    if (Number.isFinite(rule.dailyPayoutCapNgn) && (rule.dailyPayoutCapNgn ?? 0) > 0) {
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
      const dayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
      const paidTodayRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM transactions
        WHERE type = ?
          AND status = 'success'
          AND metadata LIKE ?
          AND created_at >= ?
          AND created_at < ?
      `).get(
        rewardTransactionType,
        `%"rewardRuleId":"${rule.id}"%`,
        dayStart,
        dayEnd
      ) as { total?: number } | undefined
      const paidToday = Number(paidTodayRow?.total ?? 0)
      if (paidToday + rule.amountNgn > (rule.dailyPayoutCapNgn ?? 0)) {
        const requestId = `reward_req_${randomBytes(6).toString('hex')}`
        db.prepare(`
          INSERT INTO reward_award_requests (
            id, reward_rule_id, reward_rule_name, reward_kind, reward_type, trigger_event, audience,
            beneficiary_user_id, source_user_id, trigger_transaction_id, amount_ngn, status, status_reason,
            reviewed_at, reviewed_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          requestId,
          rule.id,
          rule.name,
          rule.kind,
          rewardTransactionType,
          rule.triggerEvent,
          rule.audience,
          beneficiary.id,
          sourceUser.id,
          input.transaction?.id ?? null,
          rule.amountNgn,
          'rejected',
          `Daily payout cap reached at ₦${(rule.dailyPayoutCapNgn ?? 0).toLocaleString('en-NG')}.`,
          now.toISOString(),
          null,
          now.toISOString(),
          now.toISOString()
        )
        await insertAuditLog({
          userId: beneficiary.id,
          actorUserId: sourceUser.id,
          action: 'reward.rule_rejected_cap',
          entityType: 'reward_award_request',
          entityId: requestId,
          metadata: {
            rewardRuleId: rule.id,
            rewardRuleName: rule.name,
            sourceUserId: sourceUser.id,
            triggerTransactionId: input.transaction?.id,
            amount: rule.amountNgn,
            dailyPayoutCapNgn: rule.dailyPayoutCapNgn,
            paidTodayNgn: paidToday,
          },
        })
        continue
      }
    }

    if (rule.manualApprovalRequired) {
      const requestId = `reward_req_${randomBytes(6).toString('hex')}`
      db.prepare(`
        INSERT INTO reward_award_requests (
          id, reward_rule_id, reward_rule_name, reward_kind, reward_type, trigger_event, audience,
          beneficiary_user_id, source_user_id, trigger_transaction_id, amount_ngn, status, status_reason,
          reviewed_at, reviewed_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        requestId,
        rule.id,
        rule.name,
        rule.kind,
        rewardTransactionType,
        rule.triggerEvent,
        rule.audience,
        beneficiary.id,
        sourceUser.id,
        input.transaction?.id ?? null,
        rule.amountNgn,
        'pending',
        'Waiting for admin approval.',
        null,
        null,
        now.toISOString(),
        now.toISOString()
      )
      await insertAuditLog({
        userId: beneficiary.id,
        actorUserId: sourceUser.id,
        action: 'reward.rule_pending_manual',
        entityType: 'reward_award_request',
        entityId: requestId,
        metadata: {
          rewardRuleId: rule.id,
          rewardRuleName: rule.name,
          sourceUserId: sourceUser.id,
          triggerTransactionId: input.transaction?.id,
          amount: rule.amountNgn,
        },
      })
      continue
    }

    const rewardTransaction: Transaction = {
      id: `tx_${randomBytes(6).toString('hex')}`,
      type: rewardTransactionType,
      status: 'success',
      amount: rule.amountNgn,
      fee: 0,
      description: rule.kind === 'referral' ? `${rule.name} — ${sourceUser.name}` : rule.name,
      reference: generateRef(),
      createdAt: new Date().toISOString(),
      icon: rule.kind === 'referral' ? '₦' : '🎁',
      metadata: {
        rewardRuleId: rule.id,
        rewardRuleName: rule.name,
        rewardEvent: rule.triggerEvent,
        sourceUserId: sourceUser.id,
        sourceReferralCode: sourceUser.referredByReferralCode ?? '',
        triggerTransactionId: input.transaction?.id,
        role: rule.audience,
        referredUserId: rule.audience === 'inviter' ? sourceUser.id : undefined,
      },
    }

    await applyWalletMutation({
      userId: beneficiary.id,
      asset: 'NGN',
      balanceDelta: rule.amountNgn,
      transaction: rewardTransaction,
    })

    await insertNotification(createNotification({
      userId: beneficiary.id,
      title: `${rule.name} paid`,
      message: `You earned ₦${rule.amountNgn.toLocaleString('en-NG')} from the "${rule.name}" reward rule.`,
      type: 'success',
    }))

    if (rule.audience === 'inviter') {
      await insertNotification(createNotification({
        userId: sourceUser.id,
        title: 'Referral tracked',
        message: 'Your qualifying activity triggered your inviter’s referral reward.',
        type: 'info',
      }))
    }

    await insertAuditLog({
      userId: beneficiary.id,
      actorUserId: sourceUser.id,
      action: 'reward.rule_applied',
      entityType: 'transaction',
      entityId: rewardTransaction.id,
      metadata: {
        rewardRuleId: rule.id,
        rewardRuleName: rule.name,
        rewardEvent: rule.triggerEvent,
        sourceUserId: sourceUser.id,
        triggerTransactionId: input.transaction?.id,
        amount: rule.amountNgn,
      },
    })
  }
}

async function maybeApplySignupRewardsForUser(userId: string) {
  await maybeApplyRewardRulesForEvent({
    event: 'user_signup',
    sourceUserId: userId,
  })
}

async function maybeApplyFirstSuccessfulTransactionRewards(userId: string, transaction: Transaction) {
  if (!isReferralRewardEligibleTransaction(transaction)) return

  await ensureDbReady()
  const db = getDb()
  const firstQualifyingTransaction = db
    .prepare(`
      SELECT id
      FROM transactions
      WHERE user_id = ?
        AND status = 'success'
        AND type NOT IN ('referral_bonus', 'reward_bonus')
      ORDER BY datetime(created_at) ASC, id ASC
      LIMIT 1
    `)
    .get(userId) as { id?: string } | undefined

  if (firstQualifyingTransaction?.id !== transaction.id) return

  await maybeApplyRewardRulesForEvent({
    event: 'first_successful_transaction',
    sourceUserId: userId,
    transaction,
  })
}

export async function applyWalletMutation(input: WalletMutationInput): Promise<{ wallet: Wallet; transaction: Transaction }> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const asset = input.asset === 'RESERVE' ? 'RESERVE' : 'NGN'
    const balanceDelta = input.balanceDelta ?? 0
    const lockedBalanceDelta = input.lockedBalanceDelta ?? 0
    const result = await withPostgresTransaction(async client => {
      const walletResult = await queryPostgresClient<WalletRow>(client, 'SELECT * FROM wallets WHERE user_id = ? LIMIT 1 FOR UPDATE', [input.userId])
      const walletRow = walletResult.rows[0]
      if (!walletRow) throw new Error('Wallet not found')

      const balancesResult = await queryPostgresClient<{ asset: string; account: 'available' | 'locked'; balance: number }>(client, `
        SELECT COALESCE(asset, 'NGN') AS asset, account,
          COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance
        FROM ledger_entries WHERE user_id = ? GROUP BY asset, account
      `, [input.userId])
      const currentBalances = emptyAssetBalances()
      for (const row of balancesResult.rows) {
        const key: AssetBalanceKey = row.asset === 'RESERVE' ? 'RESERVE' : 'NGN'
        if (row.account === 'available') currentBalances[key].available = Number(row.balance)
        if (row.account === 'locked') currentBalances[key].locked = Number(row.balance)
      }

      if (typeof input.minimumAvailableBalance === 'number' && currentBalances[asset].available < input.minimumAvailableBalance) {
        throw new Error('Insufficient balance')
      }
      const nextBalance = currentBalances[asset].available + balanceDelta
      const nextLockedBalance = currentBalances[asset].locked + lockedBalanceDelta
      if (nextBalance < 0 || nextLockedBalance < 0) throw new Error('Wallet balance cannot go negative')
      const nextBalances: AssetBalanceSummary = {
        ...currentBalances,
        [asset]: { available: nextBalance, locked: nextLockedBalance },
      }

      await queryPostgresClient(client, `
        INSERT INTO transactions (id, user_id, type, status, amount, fee, description, reference, recipient, narration, created_at, icon, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        input.transaction.id, input.userId, input.transaction.type, input.transaction.status,
        input.transaction.amount, input.transaction.fee, input.transaction.description, input.transaction.reference,
        input.transaction.recipient ?? null, input.transaction.narration ?? null, input.transaction.createdAt,
        input.transaction.icon ?? null, input.transaction.metadata ? JSON.stringify(input.transaction.metadata) : null,
      ])
      const insertLedger = async (account: 'available' | 'locked', delta: number) => {
        if (!delta) return
        await queryPostgresClient(client, `
          INSERT INTO ledger_entries (id, user_id, transaction_id, asset, account, direction, amount, description, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          `ledger_${randomBytes(6).toString('hex')}`, input.userId, input.transaction.id, asset, account,
          delta > 0 ? 'credit' : 'debit', Math.abs(delta), input.transaction.description, input.transaction.createdAt,
        ])
      }
      await insertLedger('available', balanceDelta)
      await insertLedger('locked', lockedBalanceDelta)
      await queryPostgresClient(client, 'UPDATE wallets SET balance = ?, locked_balance = ? WHERE user_id = ?', [nextBalances.NGN.available, nextBalances.NGN.locked, input.userId])
      return { wallet: buildWalletFromRow(walletRow, nextBalances), transaction: input.transaction }
    })
    await maybeApplyFirstSuccessfulTransactionRewards(input.userId, result.transaction)
    return result
  }
  const db = getDb()
  const asset = input.asset === 'RESERVE' ? 'RESERVE' : 'NGN'
  const balanceDelta = input.balanceDelta ?? 0
  const lockedBalanceDelta = input.lockedBalanceDelta ?? 0

  db.exec('BEGIN')

  try {
    const walletRow = db
      .prepare('SELECT * FROM wallets WHERE user_id = ? LIMIT 1')
      .get(input.userId) as WalletRow | undefined

    if (!walletRow) {
      throw new Error('Wallet not found')
    }

    const currentBalances = calculateWalletBalances(db, input.userId)
    const currentBalance = currentBalances[asset].available
    const currentLockedBalance = currentBalances[asset].locked

    if (typeof input.minimumAvailableBalance === 'number' && currentBalance < input.minimumAvailableBalance) {
      throw new Error('Insufficient balance')
    }

    const nextBalance = currentBalance + balanceDelta
    const nextLockedBalance = currentLockedBalance + lockedBalanceDelta
    const nextBalances: AssetBalanceSummary = {
      ...currentBalances,
      [asset]: {
        available: nextBalance,
        locked: nextLockedBalance,
      },
    }

    if (nextBalance < 0 || nextLockedBalance < 0) {
      throw new Error('Wallet balance cannot go negative')
    }

    db.prepare(`
      INSERT INTO transactions (
        id, user_id, type, status, amount, fee, description, reference, recipient, narration, created_at, icon, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.transaction.id,
      input.userId,
      input.transaction.type,
      input.transaction.status,
      input.transaction.amount,
      input.transaction.fee,
      input.transaction.description,
      input.transaction.reference,
      input.transaction.recipient ?? null,
      input.transaction.narration ?? null,
      input.transaction.createdAt,
      input.transaction.icon ?? null,
      input.transaction.metadata ? JSON.stringify(input.transaction.metadata) : null
    )

    const insertLedgerEntry = db.prepare(`
      INSERT INTO ledger_entries (id, user_id, transaction_id, asset, account, direction, amount, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const now = input.transaction.createdAt

    if (balanceDelta !== 0) {
      insertLedgerEntry.run(
        `ledger_${randomBytes(6).toString('hex')}`,
        input.userId,
        input.transaction.id,
        asset,
        'available',
        balanceDelta > 0 ? 'credit' : 'debit',
        Math.abs(balanceDelta),
        input.transaction.description,
        now
      )
    }

    if (lockedBalanceDelta !== 0) {
      insertLedgerEntry.run(
        `ledger_${randomBytes(6).toString('hex')}`,
        input.userId,
        input.transaction.id,
        asset,
        'locked',
        lockedBalanceDelta > 0 ? 'credit' : 'debit',
        Math.abs(lockedBalanceDelta),
        input.transaction.description,
        now
      )
    }

    syncWalletSnapshot(db, input.userId, nextBalances)

    db.exec('COMMIT')

    const result = {
      wallet: buildWalletFromRow(walletRow, nextBalances),
      transaction: input.transaction,
    }
    await maybeApplyFirstSuccessfulTransactionRewards(input.userId, result.transaction)
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function resolvePendingTransaction(
  userId: string,
  transactionId: string,
  outcome: 'success' | 'failed'
): Promise<{ wallet: Wallet; transaction: Transaction } | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const settled = await withPostgresTransaction(async client => {
      const walletResult = await queryPostgresClient<WalletRow>(client, 'SELECT * FROM wallets WHERE user_id = ? LIMIT 1 FOR UPDATE', [userId])
      const transactionResult = await queryPostgresClient<TransactionRow>(client, 'SELECT * FROM transactions WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE', [transactionId, userId])
      const walletRow = walletResult.rows[0]
      const transactionRow = transactionResult.rows[0]
      if (!walletRow || !transactionRow) return null
      if (transactionRow.status !== 'pending') return { wallet: null, transaction: mapTransactionRow(transactionRow) }
      const balancesResult = await queryPostgresClient<{ asset: string; account: string; balance: string }>(client, `SELECT COALESCE(asset, 'NGN') AS asset, account, COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance FROM ledger_entries WHERE user_id = ? GROUP BY COALESCE(asset, 'NGN'), account`, [userId])
      const balances: AssetBalanceSummary = { NGN: { available: 0, locked: 0 }, RESERVE: { available: 0, locked: 0 } }
      for (const row of balancesResult.rows) {
        const asset = row.asset === 'RESERVE' ? 'RESERVE' : 'NGN'
        if (row.account === 'available' || row.account === 'locked') balances[asset][row.account] = Number(row.balance)
      }
      const amount = Math.abs(Number(transactionRow.amount))
      const metadata = parseJson(transactionRow.metadata, {} as Record<string, unknown>)
      const asset = metadata.walletAsset === 'RESERVE' ? 'RESERVE' : 'NGN'
      const flow = typeof metadata.settlementFlow === 'string' ? metadata.settlementFlow : (transactionRow.type === 'p2p_withdrawal' || transactionRow.type === 'withdrawal' ? 'release_locked' : transactionRow.type === 'deposit' ? 'credit_on_success' : 'none')
      if (flow !== 'release_locked' && flow !== 'credit_on_success') throw new Error(`Unsupported settlement flow for transaction ${transactionRow.type}`)
      const kind = typeof metadata.settlementKind === 'string' ? metadata.settlementKind : 'generic'
      const now = new Date().toISOString()
      if (flow === 'release_locked') {
        balances[asset].locked -= amount
        await queryPostgresClient(client, 'INSERT INTO ledger_entries (id, user_id, transaction_id, asset, account, direction, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [`ledger_${randomBytes(6).toString('hex')}`, userId, transactionId, asset, 'locked', 'debit', amount, `${kind} settlement for ${transactionRow.description}`, now])
        if (outcome === 'failed') {
          balances[asset].available += amount
          await queryPostgresClient(client, 'INSERT INTO ledger_entries (id, user_id, transaction_id, asset, account, direction, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [`ledger_${randomBytes(6).toString('hex')}`, userId, transactionId, asset, 'available', 'credit', amount, `${kind} failed refund for ${transactionRow.description}`, now])
        }
      } else if (outcome === 'success') {
        balances[asset].available += amount
        await queryPostgresClient(client, 'INSERT INTO ledger_entries (id, user_id, transaction_id, asset, account, direction, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [`ledger_${randomBytes(6).toString('hex')}`, userId, transactionId, asset, 'available', 'credit', amount, `${kind} settlement for ${transactionRow.description}`, now])
      }
      if (balances[asset].available < 0 || balances[asset].locked < 0) throw new Error('Invalid wallet state during settlement')
      await queryPostgresClient(client, 'UPDATE wallets SET balance = ?, locked_balance = ? WHERE user_id = ?', [balances.NGN.available, balances.NGN.locked, userId])
      const updated = await queryPostgresClient<TransactionRow>(client, 'UPDATE transactions SET status = ? WHERE id = ? AND user_id = ? RETURNING *', [outcome, transactionId, userId])
      return { wallet: buildWalletFromRow(walletRow, balances), transaction: mapTransactionRow(updated.rows[0] ?? transactionRow) }
    })
    if (!settled) return null
    if (settled.wallet === null) {
      const wallet = await getWalletByUserId(userId)
      return wallet ? { wallet, transaction: settled.transaction } : null
    }
    await maybeApplyFirstSuccessfulTransactionRewards(userId, settled.transaction)
    return settled
  }
  const db = getDb()
  db.exec('BEGIN')

  try {
    const walletRow = db
      .prepare('SELECT * FROM wallets WHERE user_id = ? LIMIT 1')
      .get(userId) as WalletRow | undefined
    const transactionRow = db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? LIMIT 1')
      .get(transactionId, userId) as TransactionRow | undefined

    if (!walletRow || !transactionRow) {
      db.exec('ROLLBACK')
      return null
    }

    if (transactionRow.status !== 'pending') {
      const wallet = buildWalletFromRow(walletRow, calculateWalletBalances(db, userId))
      const transaction = await getTransactionById(userId, transactionId)
      db.exec('ROLLBACK')
      return transaction ? { wallet, transaction } : null
    }

    const currentBalances = calculateWalletBalances(db, userId)
    const absoluteAmount = Math.abs(Number(transactionRow.amount))
    const metadata = parseJson(transactionRow.metadata, {} as Record<string, unknown>)
    const walletAsset = metadata.walletAsset === 'RESERVE' ? 'RESERVE' : 'NGN'
    let nextBalance = currentBalances[walletAsset].available
    let nextLockedBalance = currentBalances[walletAsset].locked
    const settlementFlow = typeof metadata.settlementFlow === 'string'
      ? metadata.settlementFlow
      : (transactionRow.type === 'p2p_withdrawal' || transactionRow.type === 'withdrawal'
          ? 'release_locked'
          : transactionRow.type === 'deposit'
            ? 'credit_on_success'
            : 'none')
    const settlementKind = typeof metadata.settlementKind === 'string'
      ? metadata.settlementKind
      : transactionRow.type === 'deposit'
        ? 'provider_deposit'
        : transactionRow.type === 'withdrawal'
          ? 'provider_payout'
          : transactionRow.type === 'p2p_withdrawal'
          ? 'merchant_payout'
            : 'generic'

    const supportsSettlement =
      settlementFlow === 'release_locked' ||
      settlementFlow === 'credit_on_success'

    if (!supportsSettlement) {
      throw new Error(`Unsupported settlement flow for transaction ${transactionRow.type}`)
    }

    if (settlementFlow === 'credit_on_success' && outcome === 'failed') {
      // Pending provider deposits can fail without any balance movement because funds were never credited.
    }

    const insertLedgerEntry = db.prepare(`
      INSERT INTO ledger_entries (id, user_id, transaction_id, asset, account, direction, amount, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    if (settlementFlow === 'release_locked') {
      nextLockedBalance -= absoluteAmount
      if (outcome === 'failed') {
        nextBalance += absoluteAmount
      }

      insertLedgerEntry.run(
        `ledger_${randomBytes(6).toString('hex')}`,
        userId,
        transactionId,
        walletAsset,
        'locked',
        'debit',
        absoluteAmount,
        `${settlementKind} settlement for ${transactionRow.description}`,
        new Date().toISOString()
      )

      if (outcome === 'failed') {
        insertLedgerEntry.run(
          `ledger_${randomBytes(6).toString('hex')}`,
          userId,
          transactionId,
          walletAsset,
          'available',
          'credit',
          absoluteAmount,
          `${settlementKind} failed refund for ${transactionRow.description}`,
          new Date().toISOString()
        )
      }
    }

    if (settlementFlow === 'credit_on_success' && outcome === 'success') {
      nextBalance += absoluteAmount
      insertLedgerEntry.run(
        `ledger_${randomBytes(6).toString('hex')}`,
        userId,
        transactionId,
        walletAsset,
        'available',
        'credit',
        absoluteAmount,
        `${settlementKind} settlement for ${transactionRow.description}`,
        new Date().toISOString()
      )
    }

    if (nextBalance < 0 || nextLockedBalance < 0) {
      throw new Error('Invalid wallet state during settlement')
    }

    const nextBalances: AssetBalanceSummary = {
      ...currentBalances,
      [walletAsset]: {
        available: nextBalance,
        locked: nextLockedBalance,
      },
    }

    syncWalletSnapshot(db, userId, nextBalances)
    db.prepare('UPDATE transactions SET status = ? WHERE id = ? AND user_id = ?')
      .run(outcome, transactionId, userId)

    db.exec('COMMIT')

    const wallet = buildWalletFromRow(walletRow, nextBalances)
    const transaction = await getTransactionById(userId, transactionId)

    if (transaction) {
      await maybeApplyFirstSuccessfulTransactionRewards(userId, transaction)
      return { wallet, transaction }
    }
    return null
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function resolvePendingTransactionByReference(
  reference: string,
  outcome: 'success' | 'failed'
): Promise<{ userId: string; wallet: Wallet; transaction: Transaction } | null> {
  const match = await getTransactionByReference(reference)
  if (!match) return null

  const result = await resolvePendingTransaction(match.userId, match.transaction.id, outcome)
  return result ? { userId: match.userId, ...result } : null
}

export async function recordProviderEvent(input: {
  externalEventId: string
  provider: string
  reference: string
  status: string
  failureReason?: string
  payload?: Record<string, unknown>
}): Promise<{ event: ProviderEvent; inserted: boolean }> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const id = `pe_${randomBytes(6).toString('hex')}`
    const now = new Date().toISOString()
    const inserted = await queryPostgres<ProviderEventRow>(`
      INSERT INTO provider_events (id, external_event_id, provider, reference, status, payload, failure_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(external_event_id) DO NOTHING RETURNING *
    `, [id, input.externalEventId, input.provider, input.reference, input.status, input.payload ? JSON.stringify(input.payload) : null, input.failureReason ?? null, now])
    const event = inserted.rows[0] ?? (await queryPostgres<ProviderEventRow>('SELECT * FROM provider_events WHERE external_event_id = ? LIMIT 1', [input.externalEventId])).rows[0]
    if (!event) throw new Error('Unable to persist provider event')
    return { event: mapProviderEventRow(event), inserted: inserted.rows.length > 0 }
  }
  const db = getDb()
  const id = `pe_${randomBytes(6).toString('hex')}`
  const now = new Date().toISOString()

  const result = db.prepare(`
    INSERT OR IGNORE INTO provider_events (
      id, external_event_id, provider, reference, status, payload, failure_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.externalEventId,
    input.provider,
    input.reference,
    input.status,
    input.payload ? JSON.stringify(input.payload) : null,
    input.failureReason ?? null,
    now
  ) as { changes?: number }

  const row = db.prepare('SELECT * FROM provider_events WHERE external_event_id = ? LIMIT 1')
    .get(input.externalEventId) as ProviderEventRow | undefined

  if (!row) {
    throw new Error('Unable to persist provider event')
  }

  return {
    event: mapProviderEventRow(row),
    inserted: Number(result.changes ?? 0) > 0,
  }
}

export async function markProviderEventProcessed(externalEventId: string): Promise<ProviderEvent | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<ProviderEventRow>('UPDATE provider_events SET processed_at = ? WHERE external_event_id = ? RETURNING *', [new Date().toISOString(), externalEventId])
    return result.rows[0] ? mapProviderEventRow(result.rows[0]) : null
  }
  const db = getDb()
  const processedAt = new Date().toISOString()
  db.prepare('UPDATE provider_events SET processed_at = ? WHERE external_event_id = ?')
    .run(processedAt, externalEventId)
  const row = db.prepare('SELECT * FROM provider_events WHERE external_event_id = ? LIMIT 1')
    .get(externalEventId) as ProviderEventRow | undefined
  return row ? mapProviderEventRow(row) : null
}

export async function requeueProviderEvent(externalEventId: string): Promise<ProviderEvent | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<ProviderEventRow>('UPDATE provider_events SET processed_at = NULL, retry_count = COALESCE(retry_count, 0) + 1 WHERE external_event_id = ? RETURNING *', [externalEventId])
    return result.rows[0] ? mapProviderEventRow(result.rows[0]) : null
  }
  const db = getDb()
  db.prepare('UPDATE provider_events SET processed_at = NULL, retry_count = COALESCE(retry_count, 0) + 1 WHERE external_event_id = ?')
    .run(externalEventId)
  const row = db.prepare('SELECT * FROM provider_events WHERE external_event_id = ? LIMIT 1')
    .get(externalEventId) as ProviderEventRow | undefined
  return row ? mapProviderEventRow(row) : null
}

export async function listProviderEvents(input?: { status?: string; provider?: string; reference?: string; limit?: number }): Promise<ProviderEvent[]> {
  await ensureDbReady()
  const limit = Math.max(1, Math.min(100, input?.limit ?? 50))
  const where: string[] = []
  const args: Array<string | number> = []

  if (input?.status?.trim()) {
    where.push('status = ?')
    args.push(input.status.trim())
  }

  if (input?.provider?.trim()) {
    where.push('provider LIKE ?')
    args.push(`%${input.provider.trim()}%`)
  }

  if (input?.reference?.trim()) {
    where.push('reference LIKE ?')
    args.push(`%${input.reference.trim()}%`)
  }

  if (isPostgresEnabled()) {
    const result = await queryPostgres<ProviderEventRow>(`
      SELECT * FROM provider_events ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `, [...args, limit])
    return result.rows.map(mapProviderEventRow)
  }

  const rows = getDb()
    .prepare(`
      SELECT * FROM provider_events
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(...args, limit) as ProviderEventRow[]
  return rows.map(mapProviderEventRow)
}

export async function getProviderEventsByReference(reference: string): Promise<ProviderEvent[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<ProviderEventRow>('SELECT * FROM provider_events WHERE reference = ? ORDER BY created_at DESC', [reference])
    return result.rows.map(mapProviderEventRow)
  }
  const rows = getDb()
    .prepare('SELECT * FROM provider_events WHERE reference = ? ORDER BY created_at DESC')
    .all(reference) as ProviderEventRow[]
  return rows.map(mapProviderEventRow)
}

export async function getProviderDiagnosticsReport(): Promise<ProviderDiagnosticsReport> {
  await ensureDbReady()
  const db = getDb()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const providerRows = db.prepare(`
    SELECT DISTINCT provider
    FROM provider_events
    ORDER BY provider COLLATE NOCASE ASC
  `).all() as Array<{ provider: string }>

  const providers: ProviderHealthSummary[] = providerRows.map((row) => {
    const provider = row.provider
    const counts = db.prepare(`
      SELECT
        COUNT(CASE WHEN created_at >= ? THEN 1 END) AS total_events_24h,
        COUNT(CASE WHEN processed_at IS NULL AND (failure_reason IS NULL AND lower(status) != 'failed') THEN 1 END) AS pending_count,
        COUNT(CASE WHEN failure_reason IS NOT NULL OR lower(status) = 'failed' THEN 1 END) AS failed_count,
        COUNT(CASE WHEN COALESCE(retry_count, 0) > 0 AND processed_at IS NULL THEN 1 END) AS retrying_count,
        MAX(created_at) AS last_event_at,
        MAX(processed_at) AS last_processed_at,
        MAX(CASE WHEN processed_at IS NOT NULL AND failure_reason IS NULL AND lower(status) != 'failed' THEN created_at END) AS last_success_at,
        MAX(CASE WHEN failure_reason IS NOT NULL OR lower(status) = 'failed' THEN created_at END) AS last_failure_at
      FROM provider_events
      WHERE provider = ?
    `).get(since24h, provider) as {
      total_events_24h?: number
      pending_count?: number
      failed_count?: number
      retrying_count?: number
      last_event_at?: string | null
      last_processed_at?: string | null
      last_success_at?: string | null
      last_failure_at?: string | null
    }

    const lastFailureRow = db.prepare(`
      SELECT failure_reason, status
      FROM provider_events
      WHERE provider = ? AND (failure_reason IS NOT NULL OR lower(status) = 'failed')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(provider) as { failure_reason?: string | null; status?: string | null } | undefined

    const topFailureReasons = db.prepare(`
      SELECT
        COALESCE(NULLIF(failure_reason, ''), status, 'failed') AS reason,
        COUNT(*) AS count
      FROM provider_events
      WHERE provider = ? AND (failure_reason IS NOT NULL OR lower(status) = 'failed')
      GROUP BY COALESCE(NULLIF(failure_reason, ''), status, 'failed')
      ORDER BY count DESC, reason ASC
      LIMIT 3
    `).all(provider) as Array<{ reason: string; count: number }>

    return {
      provider,
      totalEvents24h: Number(counts.total_events_24h ?? 0),
      pendingCount: Number(counts.pending_count ?? 0),
      failedCount: Number(counts.failed_count ?? 0),
      retryingCount: Number(counts.retrying_count ?? 0),
      lastEventAt: counts.last_event_at ?? undefined,
      lastProcessedAt: counts.last_processed_at ?? undefined,
      lastSuccessAt: counts.last_success_at ?? undefined,
      lastFailureAt: counts.last_failure_at ?? undefined,
      lastFailureReason: lastFailureRow?.failure_reason || lastFailureRow?.status || undefined,
      topFailureReasons: topFailureReasons.map((item) => ({ reason: item.reason, count: Number(item.count) })),
    }
  })

  const totals = db.prepare(`
    SELECT
      COUNT(CASE WHEN processed_at IS NULL AND (failure_reason IS NULL AND lower(status) != 'failed') THEN 1 END) AS total_pending_events,
      COUNT(CASE WHEN created_at >= ? AND (failure_reason IS NOT NULL OR lower(status) = 'failed') THEN 1 END) AS total_failed_events_24h,
      COUNT(CASE WHEN COALESCE(retry_count, 0) > 0 AND processed_at IS NULL THEN 1 END) AS total_retrying_events
    FROM provider_events
  `).get(since24h) as {
    total_pending_events?: number
    total_failed_events_24h?: number
    total_retrying_events?: number
  }

  const recentFailures = db.prepare(`
    SELECT *
    FROM provider_events
    WHERE failure_reason IS NOT NULL OR lower(status) = 'failed'
    ORDER BY created_at DESC
    LIMIT 12
  `).all() as ProviderEventRow[]

  return {
    totalPendingEvents: Number(totals.total_pending_events ?? 0),
    totalFailedEvents24h: Number(totals.total_failed_events_24h ?? 0),
    totalRetryingEvents: Number(totals.total_retrying_events ?? 0),
    providers,
    recentFailures: recentFailures.map((row) => ({
      provider: row.provider,
      externalEventId: row.external_event_id,
      reference: row.reference,
      status: row.status,
      failureReason: row.failure_reason ?? undefined,
      retryCount: row.retry_count != null ? Number(row.retry_count) : undefined,
      createdAt: row.created_at,
    })),
  }
}

export async function createDepositIntent(input: {
  userId: string
  transactionId: string
  reference: string
  grossAmount: number
  netAmount: number
  fee: number
  fundingMethod: string
  provider: string
  providerReference?: string
  providerStatus?: string
  accountNumber?: string
  bankName?: string
  accountName?: string
  expiresAt?: string
  note?: string
  status?: DepositIntent['status']
}): Promise<DepositIntent> {
  await ensureDbReady()
  const now = new Date().toISOString()
  const id = `di_${randomBytes(6).toString('hex')}`
  if (isPostgresEnabled()) {
    const result = await queryPostgres<DepositIntentRow>(`
      INSERT INTO deposit_intents (id, user_id, transaction_id, reference, gross_amount, net_amount, fee, funding_method, provider, provider_reference, provider_status, account_number, bank_name, account_name, expires_at, note, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `, [id, input.userId, input.transactionId, input.reference, input.grossAmount, input.netAmount, input.fee, input.fundingMethod, input.provider, input.providerReference ?? null, input.providerStatus ?? null, input.accountNumber ?? null, input.bankName ?? null, input.accountName ?? null, input.expiresAt ?? null, input.note ?? null, input.status ?? 'pending', now, now])
    const row = result.rows[0]
    if (!row) throw new Error('Unable to create deposit intent')
    return mapDepositIntentRow(row)
  }
  getDb().prepare(`
    INSERT INTO deposit_intents (
      id, user_id, transaction_id, reference, gross_amount, net_amount, fee, funding_method, provider, provider_reference, provider_status, account_number, bank_name, account_name, expires_at, note, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.transactionId,
    input.reference,
    input.grossAmount,
    input.netAmount,
    input.fee,
    input.fundingMethod,
    input.provider,
    input.providerReference ?? null,
    input.providerStatus ?? null,
    input.accountNumber ?? null,
    input.bankName ?? null,
    input.accountName ?? null,
    input.expiresAt ?? null,
    input.note ?? null,
    input.status ?? 'pending',
    now,
    now
  )

  const row = getDb().prepare('SELECT * FROM deposit_intents WHERE id = ? LIMIT 1').get(id) as DepositIntentRow | undefined
  if (!row) throw new Error('Unable to create deposit intent')
  return mapDepositIntentRow(row)
}

export async function getDepositIntentByReference(reference: string): Promise<DepositIntent | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<DepositIntentRow>('SELECT * FROM deposit_intents WHERE reference = ? LIMIT 1', [reference])
    return result.rows[0] ? mapDepositIntentRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM deposit_intents WHERE reference = ? LIMIT 1').get(reference) as DepositIntentRow | undefined
  return row ? mapDepositIntentRow(row) : null
}

export async function listDepositIntents(input?: { status?: DepositIntent['status']; provider?: string; reference?: string; limit?: number }): Promise<DepositIntent[]> {
  await ensureDbReady()
  const limit = Math.max(1, Math.min(100, input?.limit ?? 50))
  const where: string[] = []
  const args: unknown[] = []

  if (input?.status) {
    where.push('status = ?')
    args.push(input.status)
  }

  if (input?.reference?.trim()) {
    where.push('reference LIKE ?')
    args.push(`%${input.reference.trim()}%`)
  }

  if (input?.provider?.trim()) {
    where.push('provider LIKE ?')
    args.push(`%${input.provider.trim()}%`)
  }

  if (isPostgresEnabled()) {
    const result = await queryPostgres<DepositIntentRow>(`
      SELECT * FROM deposit_intents ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `, [...args, limit] as Array<string | number>)
    return result.rows.map(mapDepositIntentRow)
  }

  const rows = getDb().prepare(`
    SELECT * FROM deposit_intents
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...args, limit) as DepositIntentRow[]

  return rows.map(mapDepositIntentRow)
}

export async function getDepositIntentByTransactionId(transactionId: string): Promise<DepositIntent | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<DepositIntentRow>('SELECT * FROM deposit_intents WHERE transaction_id = ? LIMIT 1', [transactionId])
    return result.rows[0] ? mapDepositIntentRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM deposit_intents WHERE transaction_id = ? LIMIT 1').get(transactionId) as DepositIntentRow | undefined
  return row ? mapDepositIntentRow(row) : null
}

export async function updateDepositIntentStatus(reference: string, status: DepositIntent['status'], providerReference?: string, providerStatus?: string, failureReason?: string): Promise<DepositIntent | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`UPDATE deposit_intents SET status = ?, provider_reference = COALESCE(?, provider_reference), provider_status = COALESCE(?, provider_status), failure_reason = CASE WHEN ? = 'failed' THEN COALESCE(?, failure_reason, 'Settlement failed') ELSE NULL END, updated_at = ? WHERE reference = ?`, [status, providerReference ?? null, providerStatus ?? null, status, failureReason ?? null, now, reference])
    return getDepositIntentByReference(reference)
  }
  getDb().prepare(`
    UPDATE deposit_intents
    SET status = ?, provider_reference = COALESCE(?, provider_reference), provider_status = COALESCE(?, provider_status), failure_reason = CASE WHEN ? = 'failed' THEN COALESCE(?, failure_reason, 'Settlement failed') ELSE NULL END, updated_at = ?
    WHERE reference = ?
  `).run(status, providerReference ?? null, providerStatus ?? null, status, failureReason ?? null, now, reference)
  return getDepositIntentByReference(reference)
}

export async function updateWalletVirtualAccounts(userId: string, virtualAccounts: Wallet['virtualAccounts']): Promise<Wallet | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE wallets SET virtual_accounts = ? WHERE user_id = ?', [JSON.stringify(virtualAccounts), userId])
    return getWalletByUserId(userId)
  }
  const db = getDb()
  db.prepare('UPDATE wallets SET virtual_accounts = ? WHERE user_id = ?')
    .run(JSON.stringify(virtualAccounts), userId)
  return getWalletByUserId(userId)
}

export async function listCryptoDepositAddressesByUserId(userId: string): Promise<CryptoDepositAddress[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoDepositAddressRow>(`
      SELECT * FROM crypto_deposit_addresses WHERE user_id = ? AND is_active = ?
      ORDER BY CASE address_family WHEN 'evm' THEN 1 WHEN 'solana' THEN 2 WHEN 'ton' THEN 3 WHEN 'near' THEN 4 WHEN 'sui' THEN 5 ELSE 9 END, created_at ASC
    `, [userId, true])
    return result.rows.map(mapCryptoDepositAddressRow)
  }
  const rows = getDb().prepare(`
    SELECT * FROM crypto_deposit_addresses
    WHERE user_id = ? AND is_active = 1
    ORDER BY
      CASE address_family
        WHEN 'evm' THEN 1
        WHEN 'solana' THEN 2
        WHEN 'ton' THEN 3
        WHEN 'near' THEN 4
        WHEN 'sui' THEN 5
        ELSE 9
      END,
      created_at ASC
  `).all(userId) as CryptoDepositAddressRow[]
  return rows.map(mapCryptoDepositAddressRow)
}

export async function listCryptoDepositAddressesByFamily(addressFamily: CryptoDepositAddress['addressFamily']): Promise<CryptoDepositAddress[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoDepositAddressRow>(
      'SELECT * FROM crypto_deposit_addresses WHERE address_family = ? AND is_active = ? ORDER BY created_at ASC', [addressFamily, true]
    )
    return result.rows.map(mapCryptoDepositAddressRow)
  }
  const rows = getDb().prepare(`
    SELECT * FROM crypto_deposit_addresses
    WHERE address_family = ? AND is_active = 1
    ORDER BY created_at ASC
  `).all(addressFamily) as CryptoDepositAddressRow[]
  return rows.map(mapCryptoDepositAddressRow)
}

export async function getCryptoDepositAddressByUserAndFamily(
  userId: string,
  addressFamily: CryptoDepositAddress['addressFamily'],
): Promise<CryptoDepositAddress | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoDepositAddressRow>(`
      SELECT * FROM crypto_deposit_addresses WHERE user_id = ? AND address_family = ? AND is_active = ? LIMIT 1
    `, [userId, addressFamily, true])
    return result.rows[0] ? mapCryptoDepositAddressRow(result.rows[0]) : null
  }
  const row = getDb().prepare(`
    SELECT * FROM crypto_deposit_addresses
    WHERE user_id = ? AND address_family = ? AND is_active = 1
    LIMIT 1
  `).get(userId, addressFamily) as CryptoDepositAddressRow | undefined
  return row ? mapCryptoDepositAddressRow(row) : null
}

export async function getCryptoDepositAddressSecretById(id: string): Promise<{
  record: CryptoDepositAddress
  secret: string
  keyVersion: string
} | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoDepositAddressRow>(
      'SELECT * FROM crypto_deposit_addresses WHERE id = ? AND is_active = ? LIMIT 1', [id, true]
    )
    const row = result.rows[0]
    if (!row) return null
    return { record: mapCryptoDepositAddressRow(row), secret: decryptSensitiveValue(row.encrypted_secret), keyVersion: row.key_version }
  }
  const row = getDb().prepare(`
    SELECT * FROM crypto_deposit_addresses
    WHERE id = ? AND is_active = 1
    LIMIT 1
  `).get(id) as CryptoDepositAddressRow | undefined
  if (!row) return null

  return {
    record: mapCryptoDepositAddressRow(row),
    secret: decryptSensitiveValue(row.encrypted_secret),
    keyVersion: row.key_version,
  }
}

export async function createCryptoDepositAddress(input: {
  userId: string
  addressFamily: CryptoDepositAddress['addressFamily']
  networkLabel: string
  address: string
  secret: string
  derivationPath?: string
}): Promise<CryptoDepositAddress> {
  await ensureDbReady()
  const existing = await getCryptoDepositAddressByUserAndFamily(input.userId, input.addressFamily)
  if (existing) return existing

  const now = new Date().toISOString()
  const encrypted = encryptSensitiveValue(input.secret)
  const id = `cda_${randomBytes(6).toString('hex')}`

  if (isPostgresEnabled()) {
    await queryPostgres(`
      INSERT INTO crypto_deposit_addresses (id, user_id, address_family, network_label, address, encrypted_secret, key_version, derivation_path, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, address_family) DO NOTHING
    `, [id, input.userId, input.addressFamily, input.networkLabel, input.address, encrypted.payload,
      encrypted.keyVersion, input.derivationPath ?? null, true, now, now])
    const record = await getCryptoDepositAddressByUserAndFamily(input.userId, input.addressFamily)
    if (!record) throw new Error('Unable to create crypto deposit address.')
    return record
  }

  getDb().prepare(`
    INSERT INTO crypto_deposit_addresses (
      id, user_id, address_family, network_label, address, encrypted_secret, key_version, derivation_path, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, address_family) DO NOTHING
  `).run(
    id,
    input.userId,
    input.addressFamily,
    input.networkLabel,
    input.address,
    encrypted.payload,
    encrypted.keyVersion,
    input.derivationPath ?? null,
    1,
    now,
    now
  )

  const record = await getCryptoDepositAddressByUserAndFamily(input.userId, input.addressFamily)
  if (!record) throw new Error('Unable to create crypto deposit address.')
  return record
}

export async function getCryptoDepositEventByExternalId(externalEventId: string): Promise<CryptoDepositEvent | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoDepositEventRow>(
      'SELECT * FROM crypto_deposit_events WHERE external_event_id = ? LIMIT 1', [externalEventId]
    )
    return result.rows[0] ? mapCryptoDepositEventRow(result.rows[0]) : null
  }
  const row = getDb().prepare(`
    SELECT * FROM crypto_deposit_events
    WHERE external_event_id = ?
    LIMIT 1
  `).get(externalEventId) as CryptoDepositEventRow | undefined
  return row ? mapCryptoDepositEventRow(row) : null
}

export async function listCryptoDepositEvents(input: {
  limit?: number
  userId?: string
  pairId?: string
  status?: CryptoDepositEvent['status']
  sweepStatus?: string
  source?: 'onchain' | 'binance_internal'
} = {}): Promise<CryptoDepositEvent[]> {
  await ensureDbReady()
  let sql = `SELECT * FROM crypto_deposit_events WHERE 1=1`
  const params: Array<string | number> = []
  if (input.userId) {
    sql += ` AND user_id = ?`
    params.push(input.userId)
  }
  if (input.pairId) {
    sql += ` AND pair_id = ?`
    params.push(input.pairId)
  }
  if (input.status) {
    sql += ` AND status = ?`
    params.push(input.status)
  }
  if (input.sweepStatus) {
    sql += ` AND sweep_status = ?`
    params.push(input.sweepStatus)
  }
  // Support filtering by CEX / source for the new Binance internal flow
  if ((input as any).source) {
    sql += ` AND source = ?`
    params.push((input as any).source)
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`
  params.push(Math.min(200, input.limit ?? 50))
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoDepositEventRow>(sql, params)
    return result.rows.map(mapCryptoDepositEventRow)
  }
  const rows = getDb().prepare(sql).all(...params) as CryptoDepositEventRow[]
  return rows.map(mapCryptoDepositEventRow)
}

export async function getCryptoDepositAddressByAddress(address: string): Promise<CryptoDepositAddress | null> {
  await ensureDbReady()
  const normalized = address.toLowerCase()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoDepositAddressRow>(`
      SELECT * FROM crypto_deposit_addresses WHERE lower(address) = ? AND is_active = ? LIMIT 1
    `, [normalized, true])
    return result.rows[0] ? mapCryptoDepositAddressRow(result.rows[0]) : null
  }
  const row = getDb().prepare(`
    SELECT * FROM crypto_deposit_addresses
    WHERE lower(address) = ? AND is_active = 1
    LIMIT 1
  `).get(normalized) as CryptoDepositAddressRow | undefined
  return row ? mapCryptoDepositAddressRow(row) : null
}

export async function createCryptoDepositEvent(input: {
  externalEventId: string
  userId: string
  addressId?: string | null
  addressFamily?: CryptoDepositEvent['addressFamily'] | null
  pairId: CryptoDepositEvent['pairId']
  network?: string | null
  assetSymbol: string
  amountCrypto: number
  amountUnits: string
  txHash?: string | null
  blockNumber?: string
  logIndex?: number
  status: CryptoDepositEvent['status']
  cryptoOrderId?: string
  transactionId?: string
  payload?: Record<string, unknown>
  // CEX fields (Binance internal first). source defaults to onchain for backward compat.
  source?: 'onchain' | 'binance_internal'
  cexExchange?: string
  cexUid?: string
  cexTxId?: string
  memo?: string
}): Promise<CryptoDepositEvent> {
  await ensureDbReady()
  const existing = await getCryptoDepositEventByExternalId(input.externalEventId)
  if (existing) return existing

  const now = new Date().toISOString()
  const id = `cde_${randomBytes(6).toString('hex')}`
  const source = input.source ?? 'onchain'

  if (isPostgresEnabled()) {
    await queryPostgres(`
      INSERT INTO crypto_deposit_events (id, external_event_id, user_id, address_id, address_family, pair_id, network, asset_symbol, amount_crypto, amount_units, tx_hash, block_number, log_index, status, sweep_status, crypto_order_id, transaction_id, payload, source, cex_exchange, cex_uid, cex_tx_id, memo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_event_id) DO NOTHING
    `, [id, input.externalEventId, input.userId, input.addressId ?? null, input.addressFamily ?? null,
      input.pairId, input.network ?? null, input.assetSymbol, input.amountCrypto, input.amountUnits,
      input.txHash ?? null, input.blockNumber ?? null, input.logIndex ?? null, input.status, 'pending',
      input.cryptoOrderId ?? null, input.transactionId ?? null, input.payload ? JSON.stringify(input.payload) : null,
      source, input.cexExchange ?? null, input.cexUid ?? null, input.cexTxId ?? null, input.memo ?? null, now, now])
    const event = await getCryptoDepositEventByExternalId(input.externalEventId)
    if (!event) throw new Error('Unable to create crypto deposit event.')
    return event
  }

  getDb().prepare(`
    INSERT INTO crypto_deposit_events (
      id, external_event_id, user_id, address_id, address_family, pair_id, network, asset_symbol,
      amount_crypto, amount_units, tx_hash, block_number, log_index, status, sweep_status,
      crypto_order_id, transaction_id, payload, source, cex_exchange, cex_uid, cex_tx_id, memo,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_event_id) DO NOTHING
  `).run(
    id,
    input.externalEventId,
    input.userId,
    input.addressId ?? null,
    input.addressFamily ?? null,
    input.pairId,
    input.network ?? null,
    input.assetSymbol,
    input.amountCrypto,
    input.amountUnits,
    input.txHash ?? null,
    input.blockNumber ?? null,
    input.logIndex ?? null,
    input.status,
    'pending',
    input.cryptoOrderId ?? null,
    input.transactionId ?? null,
    input.payload ? JSON.stringify(input.payload) : null,
    source,
    input.cexExchange ?? null,
    input.cexUid ?? null,
    input.cexTxId ?? null,
    input.memo ?? null,
    now,
    now
  )

  const event = await getCryptoDepositEventByExternalId(input.externalEventId)
  if (!event) throw new Error('Unable to create crypto deposit event.')
  return event
}

// === CEX Deposit Intents (Binance internal transfers etc.) ===

export async function createCexDepositIntent(input: {
  userId: string
  reference: string
  exchange: 'binance'
  pairId: CryptoPairId
  expectedAmountCrypto: number
  cexUid: string
  memo?: string
  expiresAt?: string
  note?: string
}): Promise<CexDepositIntent> {
  await ensureDbReady()
  const now = new Date().toISOString()
  const id = `cei_${randomBytes(6).toString('hex')}`

  if (isPostgresEnabled()) {
    const result = await queryPostgres<CexDepositIntentRow>(`INSERT INTO cex_deposit_intents (id, user_id, reference, exchange, pair_id, expected_amount_crypto, cex_uid, memo, status, expires_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, [id, input.userId, input.reference, input.exchange, input.pairId, input.expectedAmountCrypto, input.cexUid, input.memo ?? null, 'pending', input.expiresAt ?? null, input.note ?? null, now, now])
    if (!result.rows[0]) throw new Error('Unable to create CEX deposit intent.')
    return mapCexDepositIntentRow(result.rows[0])
  }

  getDb().prepare(`
    INSERT INTO cex_deposit_intents (
      id, user_id, reference, exchange, pair_id, expected_amount_crypto, cex_uid, memo, status, expires_at, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.reference,
    input.exchange,
    input.pairId,
    input.expectedAmountCrypto,
    input.cexUid,
    input.memo ?? null,
    'pending',
    input.expiresAt ?? null,
    input.note ?? null,
    now,
    now
  )

  const row = getDb().prepare('SELECT * FROM cex_deposit_intents WHERE id = ? LIMIT 1').get(id) as CexDepositIntentRow | undefined
  if (!row) throw new Error('Unable to create CEX deposit intent.')
  return mapCexDepositIntentRow(row)
}

export async function getCexDepositIntentByReference(reference: string): Promise<CexDepositIntent | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CexDepositIntentRow>('SELECT * FROM cex_deposit_intents WHERE reference = ? LIMIT 1', [reference])
    return result.rows[0] ? mapCexDepositIntentRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM cex_deposit_intents WHERE reference = ? LIMIT 1').get(reference) as CexDepositIntentRow | undefined
  return row ? mapCexDepositIntentRow(row) : null
}

export async function listCexDepositIntents(input?: { userId?: string; status?: CexDepositIntent['status']; limit?: number }): Promise<CexDepositIntent[]> {
  await ensureDbReady()
  const limit = Math.min(100, input?.limit ?? 50)
  const where: string[] = []
  const args: any[] = []

  if (input?.userId) {
    where.push('user_id = ?')
    args.push(input.userId)
  }
  if (input?.status) {
    where.push('status = ?')
    args.push(input.status)
  }

  const sql = `
    SELECT * FROM cex_deposit_intents
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CexDepositIntentRow>(sql, [...args, limit])
    return result.rows.map(mapCexDepositIntentRow)
  }
  const rows = getDb().prepare(sql).all(...args, limit) as CexDepositIntentRow[]
  return rows.map(mapCexDepositIntentRow)
}

export async function markCexDepositIntentMatched(intentId: string, eventId: string): Promise<CexDepositIntent | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CexDepositIntentRow>(`UPDATE cex_deposit_intents SET status = 'matched', matched_event_id = ?, updated_at = ? WHERE id = ? RETURNING *`, [eventId, now, intentId])
    return result.rows[0] ? mapCexDepositIntentRow(result.rows[0]) : null
  }
  getDb().prepare(`
    UPDATE cex_deposit_intents
    SET status = 'matched', matched_event_id = ?, updated_at = ?
    WHERE id = ?
  `).run(eventId, now, intentId)

  const row = getDb().prepare('SELECT * FROM cex_deposit_intents WHERE id = ? LIMIT 1').get(intentId) as CexDepositIntentRow | undefined
  return row ? mapCexDepositIntentRow(row) : null
}

// Persisted last-scanned block for the deposit scanner (per chain/pair key like "base:ETH_BASE:native").
// This prevents large historical re-scans after restarts and ensures recent deposits are picked up promptly
// in the next watchdog cycle.
export async function getLastScannedBlock(key: string): Promise<bigint | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<{ block_number: string }>('SELECT block_number FROM scanner_state WHERE key = ? LIMIT 1', [key])
    return result.rows[0]?.block_number ? BigInt(result.rows[0].block_number) : null
  }
  const row = getDb().prepare('SELECT block_number FROM scanner_state WHERE key = ?').get(key) as { block_number?: string } | undefined
  return row?.block_number ? BigInt(row.block_number) : null
}

export async function setLastScannedBlock(key: string, block: bigint): Promise<void> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('INSERT INTO scanner_state (key, block_number) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET block_number = excluded.block_number', [key, block.toString()])
    return
  }
  getDb().prepare(`
    INSERT INTO scanner_state (key, block_number) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET block_number = excluded.block_number
  `).run(key, block.toString())
}

// Record a Binance internal transfer deposit (no on-chain address).
// This creates the event and immediately triggers NGN credit (direct or via pending sell order).
// No sweep is performed (manual control on Binance as requested).
export async function recordBinanceInternalDeposit(input: {
  userId: string
  pairId: CryptoPairId
  amountCrypto: number
  amountUnits: string
  cexTxId: string
  memo?: string
  cexUid?: string
  payload?: Record<string, unknown>
}): Promise<CryptoDepositEvent> {
  await ensureDbReady()

  const externalEventId = `binance:internal:${input.cexTxId}`
  const existing = await getCryptoDepositEventByExternalId(externalEventId)
  if (existing) return existing

  if (CEX_DEBUG) console.log(`[cex-binance] recordBinanceInternalDeposit user=${input.userId} pair=${input.pairId} amountCrypto=${input.amountCrypto} cexTxId=${input.cexTxId} memo=${input.memo || ''}`)

  // Create the CEX-sourced event (address-less)
  const event = await createCryptoDepositEvent({
    externalEventId,
    userId: input.userId,
    addressId: null,
    addressFamily: null,
    pairId: input.pairId,
    network: null,
    assetSymbol: input.pairId.split('_')[0] || 'CRYPTO',
    amountCrypto: input.amountCrypto,
    amountUnits: input.amountUnits,
    txHash: input.cexTxId,
    status: 'unmatched',
    source: 'binance_internal',
    cexExchange: 'binance',
    cexUid: input.cexUid ?? (process.env.MAFITAPAY_BINANCE_DEPOSIT_UID || 'BINANCE_UID_NOT_SET'),
    cexTxId: input.cexTxId,
    memo: input.memo,
    payload: input.payload,
  })

  // Reuse the exact same credit logic as on-chain direct deposits.
  // This will find a pending sell order (if any) or do direct NGN credit + notification.
  const settled = await (async () => {
    const order = await findPendingCryptoSellOrderForDeposit({
      userId: input.userId,
      pairId: input.pairId,
      amountCrypto: input.amountCrypto,
    })

    if (order) {
      await settleCryptoSellDeposit({
        order,
        event,
        txHash: input.cexTxId,
        amountUnits: input.amountUnits,
        amountCrypto: input.amountCrypto,
      })
      const matched = await markCryptoDepositEventMatched({
        externalEventId,
        cryptoOrderId: order.id,
        transactionId: order.transactionId,
      })
      return matched ?? event
    } else {
      // Direct NGN credit path (no pending sell order)
      // minimal asset shape is sufficient for the settle function
      return await settleDirectCryptoDeposit({ event, asset: { pairId: input.pairId } as any })
    }
  })()

  // Mark as matched if not already (for direct path)
  if (settled.status === 'unmatched') {
    await markCryptoDepositEventMatched({
      externalEventId,
      transactionId: `binance_${input.cexTxId}`,
    })
  }

  // If there was a pending intent with this memo, mark it matched too (for manual records)
  if (input.memo) {
    try {
      const intent = await getCexDepositIntentByReference(input.memo)
      if (intent && intent.status === 'pending' && settled.id) {
        await markCexDepositIntentMatched(intent.id, settled.id)
      }
    } catch {}
  }

  if (CEX_DEBUG) console.log(`[cex-binance] record complete for ${externalEventId}`)
  return (await getCryptoDepositEventByExternalId(externalEventId)) || settled
}

// === Binance CEX poller (quick win for auto-detection of internal transfers) ===
// Requires MAFITAPAY_BINANCE_API_KEY and MAFITAPAY_BINANCE_API_SECRET (read-only deposit history perms)
// Polls recent deposit history and matches pending cex_deposit_intents by memo + amount.
// Calls recordBinanceInternalDeposit on match (which handles credit, no sweep).
// Note: For prod, store keys encrypted (use SENSITIVE_DATA_KEY like deposit secrets) and decrypt on use.
//
// CEX is currently parked / skipped while focusing on on-chain deposits.
// All verbose [cex-binance] logs are gated behind MAFITAPAY_DEBUG_CEX=1 (or DEBUG_CRYPTO=1)
// so they do not pollute the on-chain scanner output.
const CEX_DEBUG = process.env.MAFITAPAY_DEBUG_CEX === '1' || process.env.MAFITAPAY_DEBUG_CRYPTO === '1';

export async function syncBinanceCexDeposits() {
  if (CEX_DEBUG) console.log('[cex-binance] syncBinanceCexDeposits starting...')
  const apiKey = process.env.MAFITAPAY_BINANCE_API_KEY?.trim()
  const apiSecret = process.env.MAFITAPAY_BINANCE_API_SECRET?.trim()
  const depositUid = process.env.MAFITAPAY_BINANCE_DEPOSIT_UID?.trim()

  if (!apiKey || !apiSecret) {
    if (CEX_DEBUG) console.warn('[cex-binance] Binance API key/secret not configured. Skipping sync. (Set MAFITAPAY_BINANCE_API_KEY and SECRET for auto CEX detection)')
    return { synced: 0, matched: 0, error: 'no_api_keys' }
  }

  if (CEX_DEBUG) console.log('[cex-binance] Binance keys present, attempting API call...')

  // Test basic public connectivity first (this will tell us if the *server process* can even reach Binance at all)
  try {
    if (CEX_DEBUG) console.log('[cex-binance] Testing basic public connectivity to api.binance.com...')
    const timeRes = await fetch('https://api.binance.com/api/v3/time', { method: 'GET' })
    const timeData = await timeRes.json().catch(() => ({}))
    if (CEX_DEBUG) console.log('[cex-binance] Basic /time test:', timeRes.status, 'serverTime:', timeData.serverTime || 'n/a')
    if (!timeRes.ok) {
      if (CEX_DEBUG) console.warn('[cex-binance] Basic connectivity test got non-OK from Binance public endpoint.')
    }
  } catch (connErr) {
    if (CEX_DEBUG) {
      console.error('[cex-binance] BASIC CONNECTIVITY TEST TO BINANCE FAILED:', connErr instanceof Error ? connErr.message : connErr)
      if (connErr instanceof Error && connErr.cause) {
        console.error('[cex-binance] Error cause:', connErr.cause)
      }
      console.error('[cex-binance] This means the Next.js server process cannot reach api.binance.com, even though your browser/machine claims internet.')

      // WSL2 DNS is the #1 cause when google etc work but api.binance.com specifically ENOTFOUNDs
      let isWSLEnv = false
      try {
        if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) isWSLEnv = true
        else {
          const fs = await import('node:fs')
          const ver = fs.readFileSync('/proc/version', 'utf8')
          isWSLEnv = /microsoft-standard-WSL/i.test(ver) || /WSL2/i.test(ver)
        }
      } catch {}
      if (isWSLEnv || (connErr instanceof Error && /ENOTFOUND|getaddrinfo/i.test(connErr.message + String(connErr.cause || '')))) {
        console.error('[cex-binance] *** DETECTED WSL2 ENVIRONMENT + DNS FAILURE (common for api.binance.com subdomain) ***')
        console.error('[cex-binance] Your Windows host browser resolves fine and "has internet", but the WSL Ubuntu (where `npm run dev` runs) uses an auto-generated /etc/resolv.conf (nameserver 10.255.255.254) that fails to resolve api.binance.com.')
        console.error('[cex-binance] Binance IP whitelist + read-only key are irrelevant until DNS works from inside WSL.')
        console.error('[cex-binance] APPLY THIS FIX NOW (in the same WSL terminal where you run the dev server):')
        console.error('  sudo bash -c \'echo -e "[network]\\ngenerateResolvConf = false" > /etc/wsl.conf\'')
        console.error('  sudo rm -f /etc/resolv.conf')
        console.error('  sudo bash -c \'echo -e "nameserver 8.8.8.8\\nnameserver 1.1.1.1\\noptions edns0\\n" > /etc/resolv.conf\'')
        console.error('  # Then from a *Windows* PowerShell (not WSL):   wsl --shutdown')
        console.error('  # Re-open your WSL terminal, cd /home/mafita/mafitapay, run: npm run dev')
        console.error('[cex-binance] TEMPORARY (quick test, lost on some restarts):')
        console.error('  sudo bash -c \'echo -e "nameserver 8.8.8.8\\nnameserver 1.1.1.1" > /etc/resolv.conf\'')
        console.error('  # Then immediately test: node -e "fetch(\'https://api.binance.com/api/v3/time\').then(r=>r.json()).then(console.log)"')
      } else {
        console.error('[cex-binance] Common causes: proxy env vars (HTTP_PROXY/HTTPS_PROXY), DNS resolver differences in Node vs browser, IPv6 issues, firewall per-process, or the dev server running in a container/WSL without host net access.')
      }
    }
    return { synced: 0, matched: 0, error: 'basic_connectivity_failed' }
  }

  // Always fetch server time first for accurate timestamp (avoids clock skew / recvWindow issues)
  let serverTime = Date.now()
  try {
    const timeRes = await fetch('https://api.binance.com/api/v3/time')
    if (timeRes.ok) {
      const timeData = await timeRes.json()
      serverTime = timeData.serverTime
      if (CEX_DEBUG) console.log('[cex-binance] Binance server time fetched successfully:', serverTime)
    } else {
      if (CEX_DEBUG) console.warn('[cex-binance] Failed to fetch server time, using local time. Status:', timeRes.status)
    }
  } catch (timeErr) {
    if (CEX_DEBUG) console.warn('[cex-binance] Error fetching Binance server time (using local):', timeErr instanceof Error ? timeErr.message : timeErr)
  }

  await ensureDbReady()

  const pendingIntents = await listCexDepositIntents({ status: 'pending' })
  if (pendingIntents.length === 0) {
    return { synced: 0, matched: 0 }
  }

  if (CEX_DEBUG) console.log(`[cex-binance] ${pendingIntents.length} pending CEX intent(s) waiting for deposit. Memos: ${pendingIntents.map(i => `${i.memo} (pair=${i.pairId}, exp=${i.expectedAmountCrypto})`).join(' | ')}`)

  // Fetch recent deposits (last 24h, limit 100)
  // Use serverTime for timestamp to avoid recvWindow/timestamp errors from local clock skew.
  const timestamp = serverTime
  const recvWindow = 60000
  const startTime = timestamp - 24 * 60 * 60 * 1000 // last 24 hours
  const query = `timestamp=${timestamp}&recvWindow=${recvWindow}&startTime=${startTime}&limit=100`
  const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex')
  const url = `https://api.binance.com/sapi/v1/capital/deposit/hisrec?${query}&signature=${signature}`

  try {
    if (CEX_DEBUG) console.log('[cex-binance] Calling Binance deposit history API (signed)...')
    const res = await fetch(url, {
      headers: {
        'X-MBX-APIKEY': apiKey,
      },
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => 'no body')
      if (CEX_DEBUG) console.warn(`[cex-binance] Binance API HTTP error ${res.status}: ${errText}`)
      return { synced: 0, matched: 0, error: `http_${res.status}` }
    }
    const deposits: any[] = await res.json()
    if (CEX_DEBUG) {
      console.log(`[cex-binance] Binance API success, got ${deposits.length} deposit records`)
      if (deposits.length === 0) {
        console.log('[cex-binance] No deposits returned for last 24h. If you just performed a UID/internal transfer with one of the memos above: (1) confirm the USDT (or asset) credit arrived in the Binance account tied to these API keys (check the account\'s Deposit/Transaction history in Binance app/web and look for the exact memo in Remark), (2) UID off-chain transfers can take a short time to index in /hisrec, (3) make sure you used "Internal Transfer / To Binance User (UID)" not a blockchain network withdraw. The poller will keep checking.')
      }
    }

    let matched = 0
    for (const d of deposits) {
      if (!d || !d.amount || !d.coin) continue
      const memo = (d.memo || d.remark || '').trim()
      if (!memo) continue

      const depAmount = Number(d.amount)
      const candidates = pendingIntents.filter(i => i.memo === memo)
      const matchingIntent = pendingIntents.find(i =>
        i.memo === memo &&
        i.pairId.toUpperCase().includes(d.coin.toUpperCase()) &&
        (i.expectedAmountCrypto <= 0 || Math.abs(i.expectedAmountCrypto - depAmount) < Math.max(0.01, depAmount * 0.01))
      )

      if (candidates.length > 0 && !matchingIntent) {
        if (CEX_DEBUG) console.warn('[cex-binance] Deposit memo matched a pending intent but pair/amount filter rejected it', { memo, coin: d.coin, amount: depAmount, candidates: candidates.map(c => ({pair: c.pairId, exp: c.expectedAmountCrypto})) })
      }

      if (matchingIntent) {
        try {
          await recordBinanceInternalDeposit({
            userId: matchingIntent.userId,
            pairId: matchingIntent.pairId,
            amountCrypto: depAmount,
            amountUnits: String(d.amount),
            cexTxId: String(d.txId || d.tranId || d.insertTime || Date.now()),
            memo,
            cexUid: depositUid,
            payload: { binanceDeposit: d },
          })
          const matchedEvent = await getCryptoDepositEventByExternalId(`binance:internal:${d.txId || d.tranId || Date.now()}`)
          if (matchedEvent) {
            await markCexDepositIntentMatched(matchingIntent.id, matchedEvent.id)
          }
          matched++
          if (CEX_DEBUG) console.log('[cex-binance] Matched and credited intent', matchingIntent.reference, 'tx', d.txId || d.tranId)
        } catch (e) {
          if (CEX_DEBUG) console.warn('[cex-binance] Failed to record matched deposit', e)
        }
      }
    }

    if (CEX_DEBUG) console.log(`[cex-binance] sync complete: checked ${deposits.length} deposits, matched ${matched}`)
    return { synced: deposits.length, matched }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (CEX_DEBUG) {
      console.error('[cex-binance] Sync failed with exception:', msg)
      if (e instanceof Error && e.cause) {
        console.error('[cex-binance] Error cause:', e.cause)
      }
      if (msg.toLowerCase().includes('fetch') || msg.includes('Failed to fetch')) {
        // Re-detect WSL for the signed-call failure path too
        let isWSLEnv2 = false
        try {
          if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) isWSLEnv2 = true
          else {
            const fs = await import('node:fs')
            const ver = fs.readFileSync('/proc/version', 'utf8')
            isWSLEnv2 = /microsoft-standard-WSL/i.test(ver) || /WSL2/i.test(ver)
          }
        } catch {}
        if (isWSLEnv2 || /ENOTFOUND|getaddrinfo/i.test(msg + ' ' + String((e as any)?.cause || ''))) {
          console.warn('[cex-binance] WSL2 DNS failure (api.binance.com not resolving inside WSL). Apply the /etc/wsl.conf + resolv.conf + wsl --shutdown steps printed in the basic connectivity error above.')
        } else {
          console.warn('[cex-binance] Likely network or connectivity issue reaching api.binance.com from the *server process*. Even if browser has internet:')
          console.warn('  - Check if the Next.js dev server process can reach external sites (try node -e "fetch(\'https://api.binance.com/api/v3/time\').then(r=>r.json()).then(console.log)" )')
          console.warn('  - Corporate proxy, VPN, firewall, DNS, or IPv6 issues can affect Node but not browser.')
          console.warn('  - Binance may rate-limit or geo-block the IP. For local testing, use the manual "Record Deposit" form.')
        }
      }
    }
    return { synced: 0, matched: 0, error: 'fetch_failed' }
  }
}

let binanceCexInterval: NodeJS.Timeout | null = null

export function ensureBinanceCexDepositSyncWatchdog() {
  if (binanceCexInterval) return
  if (CEX_DEBUG) console.log('[cex-binance] starting watchdog (every 30s)')
  binanceCexInterval = setInterval(() => {
    void syncBinanceCexDeposits().catch(err => {
      if (CEX_DEBUG) console.warn('[cex-binance] watchdog error', err instanceof Error ? err.message : err)
    })
  }, 30000)
}

export async function markCryptoDepositEventMatched(input: {
  externalEventId: string
  cryptoOrderId?: string
  transactionId: string
}): Promise<CryptoDepositEvent | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`
      UPDATE crypto_deposit_events SET status = 'matched',
      sweep_status = CASE WHEN sweep_status = 'skipped' THEN 'pending' ELSE sweep_status END,
      crypto_order_id = ?, transaction_id = ?, updated_at = ?
      WHERE external_event_id = ? AND status = 'unmatched'
    `, [input.cryptoOrderId ?? null, input.transactionId, now, input.externalEventId])
    return getCryptoDepositEventByExternalId(input.externalEventId)
  }
  getDb().prepare(`
    UPDATE crypto_deposit_events
    SET status = 'matched',
        sweep_status = CASE WHEN sweep_status = 'skipped' THEN 'pending' ELSE sweep_status END,
        crypto_order_id = ?,
        transaction_id = ?,
        updated_at = ?
    WHERE external_event_id = ?
      AND status = 'unmatched'
  `).run(input.cryptoOrderId ?? null, input.transactionId, now, input.externalEventId)
  return getCryptoDepositEventByExternalId(input.externalEventId)
}

export async function claimCryptoDepositEventSweep(externalEventId: string): Promise<CryptoDepositEvent | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoDepositEventRow>(`
      UPDATE crypto_deposit_events SET sweep_status = 'sweeping', sweep_error = NULL, updated_at = ?
      WHERE external_event_id = ? AND status = 'matched'
      AND (sweep_status IS NULL OR sweep_status = 'pending' OR sweep_status = 'failed') RETURNING *
    `, [now, externalEventId])
    return result.rows[0] ? mapCryptoDepositEventRow(result.rows[0]) : null
  }
  getDb().prepare(`
    UPDATE crypto_deposit_events
    SET sweep_status = 'sweeping',
        sweep_error = NULL,
        updated_at = ?
    WHERE external_event_id = ?
      AND status = 'matched'
      AND (sweep_status IS NULL OR sweep_status = 'pending' OR sweep_status = 'failed')
  `).run(now, externalEventId)
  const event = await getCryptoDepositEventByExternalId(externalEventId)
  return event?.sweepStatus === 'sweeping' ? event : null
}

export async function markCryptoDepositEventSwept(input: {
  externalEventId: string
  txHash: string
}): Promise<CryptoDepositEvent | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`
      UPDATE crypto_deposit_events SET sweep_status = 'swept', sweep_tx_hash = ?, sweep_error = NULL,
      swept_at = ?, updated_at = ? WHERE external_event_id = ?
    `, [input.txHash, now, now, input.externalEventId])
    return getCryptoDepositEventByExternalId(input.externalEventId)
  }
  getDb().prepare(`
    UPDATE crypto_deposit_events
    SET sweep_status = 'swept',
        sweep_tx_hash = ?,
        sweep_error = NULL,
        swept_at = ?,
        updated_at = ?
    WHERE external_event_id = ?
  `).run(input.txHash, now, now, input.externalEventId)
  return getCryptoDepositEventByExternalId(input.externalEventId)
}

export async function markCryptoDepositEventSweepFailed(input: {
  externalEventId: string
  error: string
}): Promise<CryptoDepositEvent | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`UPDATE crypto_deposit_events SET sweep_status = 'failed', sweep_error = ?, updated_at = ? WHERE external_event_id = ?`, [input.error.slice(0, 500), now, input.externalEventId])
    return getCryptoDepositEventByExternalId(input.externalEventId)
  }
  getDb().prepare(`
    UPDATE crypto_deposit_events
    SET sweep_status = 'failed',
        sweep_error = ?,
        updated_at = ?
    WHERE external_event_id = ?
  `).run(input.error.slice(0, 500), now, input.externalEventId)
  return getCryptoDepositEventByExternalId(input.externalEventId)
}

export async function updateCryptoDepositEventConversion(externalEventId: string, conversion: any) {
  await ensureDbReady()
  const now = new Date().toISOString()
  const existing = await getCryptoDepositEventByExternalId(externalEventId)
  if (!existing) return null
  const payload = {
    ...(existing.payload || {}),
    conversion,
  }
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE crypto_deposit_events SET payload = ?, updated_at = ? WHERE external_event_id = ?', [JSON.stringify(payload), now, externalEventId])
    return getCryptoDepositEventByExternalId(externalEventId)
  }
  getDb().prepare(`
    UPDATE crypto_deposit_events
    SET payload = ?,
        updated_at = ?
    WHERE external_event_id = ?
  `).run(JSON.stringify(payload), now, externalEventId)
  return getCryptoDepositEventByExternalId(externalEventId)
}

export async function findPendingCryptoSellOrderForDeposit(input: {
  userId: string
  pairId: CryptoOrder['pairId']
  amountCrypto: number
  tolerancePercent?: number
}): Promise<CryptoOrder | null> {
  await ensureDbReady()
  const tolerancePercent = input.tolerancePercent ?? 0.02
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoOrderRow>(`
      SELECT * FROM crypto_orders WHERE user_id = ? AND pair_id = ? AND side = 'sell' AND status = 'pending'
      ORDER BY created_at ASC LIMIT 20
    `, [input.userId, input.pairId])
    for (const row of result.rows) {
      const order = mapCryptoOrderRow(row)
      const expected = Number(order.cryptoAmount)
      if (!Number.isFinite(expected) || expected <= 0) continue
      const diff = Math.abs(expected - input.amountCrypto)
      if (diff <= Math.max(0.00000001, expected * (tolerancePercent / 100))) return order
    }
    return null
  }
  const rows = getDb().prepare(`
    SELECT * FROM crypto_orders
    WHERE user_id = ?
      AND pair_id = ?
      AND side = 'sell'
      AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 20
  `).all(input.userId, input.pairId) as CryptoOrderRow[]

  for (const row of rows) {
    const order = mapCryptoOrderRow(row)
    const expected = Number(order.cryptoAmount)
    if (!Number.isFinite(expected) || expected <= 0) continue
    const diff = Math.abs(expected - input.amountCrypto)
    const allowed = Math.max(0.00000001, expected * (tolerancePercent / 100))
    if (diff <= allowed) return order
  }

  return null
}

export async function createSettledDepositFromProvider(input: {
  userId: string
  reference: string
  provider: string
  providerReference?: string
  providerStatus?: string
  grossAmount: number
  fee: number
  fundingMethod: string
  accountNumber?: string
  bankName?: string
  accountName?: string
  note?: string
  metadata?: Record<string, unknown>
}): Promise<{ wallet: Wallet; transaction: Transaction; depositIntent: DepositIntent }> {
  const netAmount = input.grossAmount - input.fee
  if (netAmount <= 0) {
    throw new Error('Deposit amount is too small after fees.')
  }

  const now = new Date().toISOString()
  const transaction: Transaction = {
    id: input.reference,
    type: 'deposit',
    status: 'success',
    amount: netAmount,
    fee: input.fee,
    description: 'Bank Transfer Deposit',
    reference: input.reference,
    createdAt: now,
    icon: '⬇',
    metadata: {
      grossAmount: input.grossAmount,
      fundingMethod: input.fundingMethod,
      settlementFlow: 'credit_on_success',
      settlementKind: 'provider_deposit',
      walletAsset: 'NGN',
      ...input.metadata,
    },
  }

  const result = await applyWalletMutation({
    userId: input.userId,
    asset: 'NGN',
    balanceDelta: netAmount,
    transaction,
  })

  const depositIntent = await createDepositIntent({
    userId: input.userId,
    transactionId: result.transaction.id,
    reference: result.transaction.reference,
    grossAmount: input.grossAmount,
    netAmount,
    fee: input.fee,
    fundingMethod: input.fundingMethod,
    provider: input.provider,
    providerReference: input.providerReference,
    providerStatus: input.providerStatus,
    accountNumber: input.accountNumber,
    bankName: input.bankName,
    accountName: input.accountName,
    note: input.note,
    status: 'success',
  })

  return {
    wallet: result.wallet,
    transaction: result.transaction,
    depositIntent,
  }
}

export async function requeueDepositIntent(reference: string): Promise<DepositIntent | null> {
  await ensureDbReady()
  const current = await getDepositIntentByReference(reference)
  if (!current) return null
  if (current.status !== 'failed') {
    throw new Error(`Deposit intent is ${current.status} and cannot be requeued.`)
  }
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`UPDATE deposit_intents SET status = 'pending', retry_count = COALESCE(retry_count, 0) + 1, failure_reason = NULL, updated_at = ? WHERE reference = ?`, [now, reference])
    return getDepositIntentByReference(reference)
  }
  getDb().prepare(`
    UPDATE deposit_intents
    SET status = 'pending', retry_count = COALESCE(retry_count, 0) + 1, failure_reason = NULL, updated_at = ?
    WHERE reference = ?
  `).run(now, reference)
  return getDepositIntentByReference(reference)
}

export async function createPayoutRequest(input: {
  userId: string
  transactionId: string
  reference: string
  amount: number
  provider: string
  merchantId?: string
  beneficiary?: string
  providerReference?: string
  providerStatus?: string
  lastSyncAt?: string
  lastSyncStatus?: string
  status?: PayoutRequest['status']
}): Promise<PayoutRequest> {
  await ensureDbReady()
  const now = new Date().toISOString()
  const id = `po_${randomBytes(6).toString('hex')}`
  if (isPostgresEnabled()) {
    const result = await queryPostgres<PayoutRequestRow>(`
      INSERT INTO payout_requests (id, user_id, transaction_id, reference, amount, provider, merchant_id, beneficiary, provider_reference, provider_status, last_sync_at, last_sync_status, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `, [id, input.userId, input.transactionId, input.reference, input.amount, input.provider,
      input.merchantId ?? null, input.beneficiary ?? null, input.providerReference ?? null,
      input.providerStatus ?? null, input.lastSyncAt ?? null, input.lastSyncStatus ?? null,
      input.status ?? 'pending', now, now])
    if (!result.rows[0]) throw new Error('Unable to create payout request')
    return mapPayoutRequestRow(result.rows[0])
  }
  getDb().prepare(`
    INSERT INTO payout_requests (
      id, user_id, transaction_id, reference, amount, provider, merchant_id, beneficiary, provider_reference, provider_status, last_sync_at, last_sync_status, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.transactionId,
    input.reference,
    input.amount,
    input.provider,
    input.merchantId ?? null,
    input.beneficiary ?? null,
    input.providerReference ?? null,
    input.providerStatus ?? null,
    input.lastSyncAt ?? null,
    input.lastSyncStatus ?? null,
    input.status ?? 'pending',
    now,
    now
  )

  const row = getDb().prepare('SELECT * FROM payout_requests WHERE id = ? LIMIT 1').get(id) as PayoutRequestRow | undefined
  if (!row) throw new Error('Unable to create payout request')
  return mapPayoutRequestRow(row)
}

export async function getPayoutRequestByReference(reference: string): Promise<PayoutRequest | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<PayoutRequestRow>('SELECT * FROM payout_requests WHERE reference = ? LIMIT 1', [reference])
    return result.rows[0] ? mapPayoutRequestRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM payout_requests WHERE reference = ? LIMIT 1').get(reference) as PayoutRequestRow | undefined
  return row ? mapPayoutRequestRow(row) : null
}

export async function listPayoutRequests(input?: { status?: PayoutRequest['status']; provider?: string; reference?: string; limit?: number }): Promise<PayoutRequest[]> {
  await ensureDbReady()
  const limit = Math.max(1, Math.min(100, input?.limit ?? 50))
  const where: string[] = []
  const args: unknown[] = []

  if (input?.status) {
    where.push('status = ?')
    args.push(input.status)
  }

  if (input?.reference?.trim()) {
    where.push('reference LIKE ?')
    args.push(`%${input.reference.trim()}%`)
  }

  if (input?.provider?.trim()) {
    where.push('provider LIKE ?')
    args.push(`%${input.provider.trim()}%`)
  }

  if (isPostgresEnabled()) {
    const result = await queryPostgres<PayoutRequestRow>(`
      SELECT * FROM payout_requests ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `, [...args, limit] as Array<string | number>)
    return result.rows.map(mapPayoutRequestRow)
  }

  const rows = getDb().prepare(`
    SELECT * FROM payout_requests
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...args, limit) as PayoutRequestRow[]

  return rows.map(mapPayoutRequestRow)
}

export async function getPayoutRequestByTransactionId(transactionId: string): Promise<PayoutRequest | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<PayoutRequestRow>('SELECT * FROM payout_requests WHERE transaction_id = ? LIMIT 1', [transactionId])
    return result.rows[0] ? mapPayoutRequestRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM payout_requests WHERE transaction_id = ? LIMIT 1').get(transactionId) as PayoutRequestRow | undefined
  return row ? mapPayoutRequestRow(row) : null
}

export async function updatePayoutRequestStatus(reference: string, status: PayoutRequest['status'], providerReference?: string, providerStatus?: string, failureReason?: string, lastSyncAt?: string, lastSyncStatus?: string): Promise<PayoutRequest | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`UPDATE payout_requests SET status = ?, provider_reference = COALESCE(?, provider_reference), provider_status = COALESCE(?, provider_status), last_sync_at = COALESCE(?, last_sync_at), last_sync_status = COALESCE(?, last_sync_status), failure_reason = CASE WHEN ? = 'failed' THEN COALESCE(?, failure_reason, 'Settlement failed') ELSE NULL END, updated_at = ? WHERE reference = ?`, [status, providerReference ?? null, providerStatus ?? null, lastSyncAt ?? null, lastSyncStatus ?? null, status, failureReason ?? null, now, reference])
    return getPayoutRequestByReference(reference)
  }
  getDb().prepare(`
    UPDATE payout_requests
    SET status = ?, provider_reference = COALESCE(?, provider_reference), provider_status = COALESCE(?, provider_status), last_sync_at = COALESCE(?, last_sync_at), last_sync_status = COALESCE(?, last_sync_status), failure_reason = CASE WHEN ? = 'failed' THEN COALESCE(?, failure_reason, 'Settlement failed') ELSE NULL END, updated_at = ?
    WHERE reference = ?
  `).run(status, providerReference ?? null, providerStatus ?? null, lastSyncAt ?? null, lastSyncStatus ?? null, status, failureReason ?? null, now, reference)
  return getPayoutRequestByReference(reference)
}

export async function markPayoutRequestSync(reference: string, providerStatus?: string, failureReason?: string): Promise<PayoutRequest | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`UPDATE payout_requests SET last_sync_at = ?, last_sync_status = COALESCE(?, last_sync_status), provider_status = COALESCE(?, provider_status), failure_reason = COALESCE(?, failure_reason), updated_at = ? WHERE reference = ?`, [now, providerStatus ?? null, providerStatus ?? null, failureReason ?? null, now, reference])
    return getPayoutRequestByReference(reference)
  }
  getDb().prepare(`
    UPDATE payout_requests
    SET last_sync_at = ?, last_sync_status = COALESCE(?, last_sync_status), provider_status = COALESCE(?, provider_status), failure_reason = COALESCE(?, failure_reason), updated_at = ?
    WHERE reference = ?
  `).run(now, providerStatus ?? null, providerStatus ?? null, failureReason ?? null, now, reference)
  return getPayoutRequestByReference(reference)
}

export async function requeuePayoutRequest(reference: string): Promise<PayoutRequest | null> {
  await ensureDbReady()
  const current = await getPayoutRequestByReference(reference)
  if (!current) return null
  if (current.status !== 'failed') {
    throw new Error(`Payout request is ${current.status} and cannot be requeued.`)
  }
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`UPDATE payout_requests SET status = 'pending', retry_count = COALESCE(retry_count, 0) + 1, failure_reason = NULL, updated_at = ? WHERE reference = ?`, [now, reference])
    return getPayoutRequestByReference(reference)
  }
  getDb().prepare(`
    UPDATE payout_requests
    SET status = 'pending', retry_count = COALESCE(retry_count, 0) + 1, failure_reason = NULL, updated_at = ?
    WHERE reference = ?
  `).run(now, reference)
  return getPayoutRequestByReference(reference)
}

export async function listBeneficiaries(userId: string, kind?: Beneficiary['kind'], includeArchived = false): Promise<Beneficiary[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<BeneficiaryRow>(`
      SELECT * FROM beneficiaries WHERE user_id = ?
      ${kind ? 'AND kind = ?' : ''} ${includeArchived ? '' : 'AND archived_at IS NULL'}
      ORDER BY is_default DESC, updated_at DESC
    `, kind ? [userId, kind] : [userId])
    return result.rows.map(mapBeneficiaryRow)
  }
  const rows = ((kind && includeArchived)
    ? getDb().prepare('SELECT * FROM beneficiaries WHERE user_id = ? AND kind = ? ORDER BY is_default DESC, updated_at DESC').all(userId, kind)
    : kind
      ? getDb().prepare('SELECT * FROM beneficiaries WHERE user_id = ? AND kind = ? AND archived_at IS NULL ORDER BY is_default DESC, updated_at DESC').all(userId, kind)
      : includeArchived
        ? getDb().prepare('SELECT * FROM beneficiaries WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC').all(userId)
        : getDb().prepare('SELECT * FROM beneficiaries WHERE user_id = ? AND archived_at IS NULL ORDER BY is_default DESC, updated_at DESC').all(userId)
  ) as BeneficiaryRow[]
  return rows.map(mapBeneficiaryRow)
}

export async function upsertBeneficiary(input: {
  userId: string
  kind: Beneficiary['kind']
  label: string
  bankCode?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
  internalUserId?: string
  handle?: string
  verifiedAt?: string
  verificationProvider?: string
  verificationStatus?: Beneficiary['verificationStatus']
  verificationReference?: string
  verificationCheckedAt?: string
  verificationReason?: string
}): Promise<Beneficiary> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    const existingResult = input.kind === 'bank' && input.accountNumber
      ? await queryPostgres<BeneficiaryRow>(`SELECT * FROM beneficiaries WHERE user_id = ? AND kind = 'bank' AND account_number = ? AND COALESCE(bank_code, '') = COALESCE(?, '') LIMIT 1`, [input.userId, input.accountNumber, input.bankCode ?? null])
      : input.kind === 'internal' && input.internalUserId
        ? await queryPostgres<BeneficiaryRow>(`SELECT * FROM beneficiaries WHERE user_id = ? AND kind = 'internal' AND internal_user_id = ? LIMIT 1`, [input.userId, input.internalUserId])
        : { rows: [] as BeneficiaryRow[] }
    const existing = existingResult.rows[0]
    const values = [input.label, input.bankCode ?? null, input.bankName ?? null, input.accountNumber ?? null,
      input.accountName ?? null, input.internalUserId ?? null, input.handle ?? null, input.verifiedAt ?? null,
      input.verificationProvider ?? null, input.verificationStatus ?? null, input.verificationReference ?? null,
      input.verificationCheckedAt ?? null, input.verificationReason ?? null, now]
    if (existing) {
      const result = await queryPostgres<BeneficiaryRow>(`
        UPDATE beneficiaries SET label = ?, bank_code = ?, bank_name = ?, account_number = ?, account_name = ?, internal_user_id = ?, handle = ?, verified_at = COALESCE(?, verified_at), verification_provider = COALESCE(?, verification_provider), verification_status = COALESCE(?, verification_status), verification_reference = COALESCE(?, verification_reference), verification_checked_at = COALESCE(?, verification_checked_at), verification_reason = ?, last_used_at = ?, archived_at = NULL, updated_at = ? WHERE id = ? RETURNING *
      `, [...values, now, existing.id])
      if (!result.rows[0]) throw new Error('Unable to update beneficiary')
      return mapBeneficiaryRow(result.rows[0])
    }
    const id = `ben_${randomBytes(6).toString('hex')}`
    const result = await queryPostgres<BeneficiaryRow>(`
      INSERT INTO beneficiaries (id, user_id, kind, label, bank_code, bank_name, account_number, account_name, internal_user_id, handle, verified_at, is_default, verification_provider, verification_status, verification_reference, verification_checked_at, verification_reason, last_used_at, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `, [id, input.userId, input.kind, input.label, input.bankCode ?? null, input.bankName ?? null,
      input.accountNumber ?? null, input.accountName ?? null, input.internalUserId ?? null, input.handle ?? null,
      input.verifiedAt ?? null, false, input.verificationProvider ?? null, input.verificationStatus ?? null,
      input.verificationReference ?? null, input.verificationCheckedAt ?? null, input.verificationReason ?? null,
      now, null, now, now])
    if (!result.rows[0]) throw new Error('Unable to create beneficiary')
    return mapBeneficiaryRow(result.rows[0])
  }
  const db = getDb()
  const now = new Date().toISOString()

  let existing: BeneficiaryRow | undefined
  if (input.kind === 'bank' && input.accountNumber) {
    existing = db.prepare(`
      SELECT * FROM beneficiaries
      WHERE user_id = ? AND kind = 'bank' AND account_number = ? AND COALESCE(bank_code, '') = COALESCE(?, '')
      LIMIT 1
    `).get(input.userId, input.accountNumber, input.bankCode ?? null) as BeneficiaryRow | undefined
  }

  if (input.kind === 'internal' && input.internalUserId) {
    existing = db.prepare(`
      SELECT * FROM beneficiaries
      WHERE user_id = ? AND kind = 'internal' AND internal_user_id = ?
      LIMIT 1
    `).get(input.userId, input.internalUserId) as BeneficiaryRow | undefined
  }

  if (existing) {
    db.prepare(`
      UPDATE beneficiaries
      SET label = ?, bank_code = ?, bank_name = ?, account_number = ?, account_name = ?, internal_user_id = ?, handle = ?, verified_at = COALESCE(?, verified_at), verification_provider = COALESCE(?, verification_provider), verification_status = COALESCE(?, verification_status), verification_reference = COALESCE(?, verification_reference), verification_checked_at = COALESCE(?, verification_checked_at), verification_reason = ?, last_used_at = ?, archived_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      input.label,
      input.bankCode ?? null,
      input.bankName ?? null,
      input.accountNumber ?? null,
      input.accountName ?? null,
      input.internalUserId ?? null,
      input.handle ?? null,
      input.verifiedAt ?? null,
      input.verificationProvider ?? null,
      input.verificationStatus ?? null,
      input.verificationReference ?? null,
      input.verificationCheckedAt ?? null,
      input.verificationReason ?? null,
      now,
      now,
      existing.id
    )
    const row = db.prepare('SELECT * FROM beneficiaries WHERE id = ? LIMIT 1').get(existing.id) as BeneficiaryRow | undefined
    if (!row) throw new Error('Unable to update beneficiary')
    return mapBeneficiaryRow(row)
  }

  const id = `ben_${randomBytes(6).toString('hex')}`
  db.prepare(`
    INSERT INTO beneficiaries (
      id, user_id, kind, label, bank_code, bank_name, account_number, account_name, internal_user_id, handle, verified_at, is_default, verification_provider, verification_status, verification_reference, verification_checked_at, verification_reason, last_used_at, archived_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.kind,
    input.label,
    input.bankCode ?? null,
    input.bankName ?? null,
    input.accountNumber ?? null,
    input.accountName ?? null,
    input.internalUserId ?? null,
    input.handle ?? null,
    input.verifiedAt ?? null,
    0,
    input.verificationProvider ?? null,
    input.verificationStatus ?? null,
    input.verificationReference ?? null,
    input.verificationCheckedAt ?? null,
    input.verificationReason ?? null,
    now,
    null,
    now,
    now
  )
  const row = db.prepare('SELECT * FROM beneficiaries WHERE id = ? LIMIT 1').get(id) as BeneficiaryRow | undefined
  if (!row) throw new Error('Unable to create beneficiary')
  return mapBeneficiaryRow(row)
}

export async function getBeneficiaryById(userId: string, id: string): Promise<Beneficiary | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<BeneficiaryRow>('SELECT * FROM beneficiaries WHERE user_id = ? AND id = ? LIMIT 1', [userId, id])
    return result.rows[0] ? mapBeneficiaryRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM beneficiaries WHERE user_id = ? AND id = ? LIMIT 1').get(userId, id) as BeneficiaryRow | undefined
  return row ? mapBeneficiaryRow(row) : null
}

export async function setDefaultBeneficiary(userId: string, id: string): Promise<Beneficiary | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    return withPostgresTransaction(async client => {
      const target = await queryPostgresClient<BeneficiaryRow>(client, 'SELECT * FROM beneficiaries WHERE user_id = ? AND id = ? AND archived_at IS NULL LIMIT 1 FOR UPDATE', [userId, id])
      if (!target.rows[0]) return null
      const now = new Date().toISOString()
      await queryPostgresClient(client, 'UPDATE beneficiaries SET is_default = ?, updated_at = ? WHERE user_id = ? AND kind = ?', [false, now, userId, target.rows[0].kind])
      const updated = await queryPostgresClient<BeneficiaryRow>(client, 'UPDATE beneficiaries SET is_default = ?, updated_at = ? WHERE user_id = ? AND id = ? RETURNING *', [true, now, userId, id])
      return updated.rows[0] ? mapBeneficiaryRow(updated.rows[0]) : null
    })
  }
  const db = getDb()
  const target = db.prepare('SELECT * FROM beneficiaries WHERE user_id = ? AND id = ? AND archived_at IS NULL LIMIT 1').get(userId, id) as BeneficiaryRow | undefined
  if (!target) return null
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE beneficiaries SET is_default = 0, updated_at = ? WHERE user_id = ? AND kind = ?').run(new Date().toISOString(), userId, target.kind)
    db.prepare('UPDATE beneficiaries SET is_default = 1, updated_at = ? WHERE user_id = ? AND id = ?').run(new Date().toISOString(), userId, id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getBeneficiaryById(userId, id)
}

export async function archiveBeneficiary(userId: string, id: string): Promise<Beneficiary | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE beneficiaries SET archived_at = ?, is_default = ?, updated_at = ? WHERE user_id = ? AND id = ? AND archived_at IS NULL', [now, false, now, userId, id])
    return getBeneficiaryById(userId, id)
  }
  getDb().prepare(`
    UPDATE beneficiaries
    SET archived_at = ?, is_default = 0, updated_at = ?
    WHERE user_id = ? AND id = ? AND archived_at IS NULL
  `).run(now, now, userId, id)
  return getBeneficiaryById(userId, id)
}

export async function restoreBeneficiary(userId: string, id: string): Promise<Beneficiary | null> {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE beneficiaries SET archived_at = NULL, updated_at = ? WHERE user_id = ? AND id = ?', [now, userId, id])
    return getBeneficiaryById(userId, id)
  }
  getDb().prepare(`
    UPDATE beneficiaries
    SET archived_at = NULL, updated_at = ?
    WHERE user_id = ? AND id = ?
  `).run(now, userId, id)
  return getBeneficiaryById(userId, id)
}

export async function deleteBeneficiary(userId: string, id: string): Promise<boolean> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres('DELETE FROM beneficiaries WHERE user_id = ? AND id = ?', [userId, id])
    return (result.rowCount ?? 0) > 0
  }
  const result = getDb().prepare('DELETE FROM beneficiaries WHERE user_id = ? AND id = ?').run(userId, id)
  return Number(result.changes ?? 0) > 0
}

export async function recordBeneficiaryVerification(input: {
  beneficiaryId: string
  userId: string
  kind: BeneficiaryVerification['kind']
  provider: string
  status: BeneficiaryVerification['status']
  reference?: string
  bankCode?: string
  accountNumber?: string
  accountName?: string
  bankName?: string
  handle?: string
  errorCode?: string
  payload?: Record<string, unknown>
  reason?: string
}): Promise<BeneficiaryVerification> {
  await ensureDbReady()
  const id = `benver_${randomBytes(6).toString('hex')}`
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<BeneficiaryVerificationRow>(`
      INSERT INTO beneficiary_verifications (id, beneficiary_id, user_id, kind, provider, status, reference, bank_code, account_number, account_name, bank_name, handle, error_code, payload, reason, checked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `, [id, input.beneficiaryId, input.userId, input.kind, input.provider, input.status,
      input.reference ?? null, input.bankCode ?? null, input.accountNumber ?? null, input.accountName ?? null,
      input.bankName ?? null, input.handle ?? null, input.errorCode ?? null,
      input.payload ? JSON.stringify(input.payload) : null, input.reason ?? null, now, now])
    if (!result.rows[0]) throw new Error('Unable to record beneficiary verification')
    return mapBeneficiaryVerificationRow(result.rows[0])
  }
  getDb().prepare(`
    INSERT INTO beneficiary_verifications (
      id, beneficiary_id, user_id, kind, provider, status, reference, bank_code, account_number, account_name, bank_name, handle, error_code, payload, reason, checked_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.beneficiaryId,
    input.userId,
    input.kind,
    input.provider,
    input.status,
    input.reference ?? null,
    input.bankCode ?? null,
    input.accountNumber ?? null,
    input.accountName ?? null,
    input.bankName ?? null,
    input.handle ?? null,
    input.errorCode ?? null,
    input.payload ? JSON.stringify(input.payload) : null,
    input.reason ?? null,
    now,
    now
  )
  const row = getDb().prepare('SELECT * FROM beneficiary_verifications WHERE id = ? LIMIT 1').get(id) as BeneficiaryVerificationRow | undefined
  if (!row) throw new Error('Unable to record beneficiary verification')
  return mapBeneficiaryVerificationRow(row)
}

export async function getSessionsForUser(userId: string): Promise<SessionRecord[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()])
    const result = await queryPostgres<SessionRow>('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC', [userId])
    return result.rows.map(mapSessionRow)
  }
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
  const rows = db
    .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as SessionRow[]
  return rows.map(mapSessionRow)
}

export async function insertSession(session: SessionRecord) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres(`
      INSERT INTO sessions (token, user_id, expires_at, created_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [session.token, session.userId, session.expiresAt, session.createdAt, session.userAgent ?? null, session.ipAddress ?? null])
    return
  }
  const db = getDb()
  db.exec('BEGIN')

  try {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
    db.prepare(`
      INSERT INTO sessions (token, user_id, expires_at, created_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      session.token,
      session.userId,
      session.expiresAt,
      session.createdAt,
      session.userAgent ?? null,
      session.ipAddress ?? null
    )
    const overflowRows = db
      .prepare(`
        SELECT token FROM sessions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT -1 OFFSET ?
      `)
      .all(session.userId, MAX_SESSIONS_PER_USER) as Array<{ token: string }>
    for (const row of overflowRows) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(row.token)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function createPasswordResetToken(userId: string, metadata?: { userAgent?: string; ipAddress?: string }) {
  await ensureDbReady()
  const now = new Date()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString()
  const rawToken = randomBytes(24).toString('hex')
  const tokenHash = hashPasswordResetToken(rawToken)
  const id = `prt_${randomBytes(6).toString('hex')}`
  if (isPostgresEnabled()) {
    await withPostgresTransaction(async client => {
      await queryPostgresClient(client, 'DELETE FROM password_reset_tokens WHERE user_id = ?', [userId])
      await queryPostgresClient(client, `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at, used_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`, [id, userId, tokenHash, expiresAt, nowIso, metadata?.userAgent ?? null, metadata?.ipAddress ?? null])
    })
    await insertAuditLog({ userId, action: 'auth.password_reset_requested', entityType: 'user', entityId: userId, metadata: { expiresAt } })
    return { id, token: rawToken, expiresAt, createdAt: nowIso }
  }
  const db = getDb()

  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId)
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at, used_at, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    id,
    userId,
    tokenHash,
    expiresAt,
    nowIso,
    metadata?.userAgent ?? null,
    metadata?.ipAddress ?? null
  )

  await insertAuditLog({
    userId,
    action: 'auth.password_reset_requested',
    entityType: 'user',
    entityId: userId,
    metadata: {
      expiresAt,
    },
  })

  return {
    id,
    token: rawToken,
    expiresAt,
    createdAt: nowIso,
  }
}

export async function createEmailVerificationToken(userId: string, metadata?: { userAgent?: string; ipAddress?: string }) {
  await ensureDbReady()
  const now = new Date()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000).toISOString()
  const rawToken = randomBytes(24).toString('hex')
  const tokenHash = hashEmailVerificationToken(rawToken)
  const id = `evt_${randomBytes(6).toString('hex')}`
  if (isPostgresEnabled()) {
    await withPostgresTransaction(async client => {
      await queryPostgresClient(client, 'DELETE FROM email_verification_tokens WHERE user_id = ?', [userId])
      await queryPostgresClient(client, `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at, used_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`, [id, userId, tokenHash, expiresAt, nowIso, metadata?.userAgent ?? null, metadata?.ipAddress ?? null])
    })
    await insertAuditLog({ userId, action: 'auth.email_verification_requested', entityType: 'user', entityId: userId, metadata: { expiresAt } })
    return { id, token: rawToken, expiresAt, createdAt: nowIso }
  }
  const db = getDb()

  db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(userId)
  db.prepare(`
    INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at, used_at, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    id,
    userId,
    tokenHash,
    expiresAt,
    nowIso,
    metadata?.userAgent ?? null,
    metadata?.ipAddress ?? null
  )

  await insertAuditLog({
    userId,
    action: 'auth.email_verification_requested',
    entityType: 'user',
    entityId: userId,
    metadata: {
      expiresAt,
    },
  })

  return {
    id,
    token: rawToken,
    expiresAt,
    createdAt: nowIso,
  }
}

export async function consumePasswordResetToken(token: string) {
  await ensureDbReady()
  const trimmed = token.trim()
  if (!trimmed) return null
  const tokenHash = hashPasswordResetToken(trimmed)
  if (isPostgresEnabled()) {
    const consumed = await withPostgresTransaction(async client => {
      const result = await queryPostgresClient<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(client, 'SELECT * FROM password_reset_tokens WHERE token_hash = ? LIMIT 1 FOR UPDATE', [tokenHash])
      const row = result.rows[0]
      if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return null
      await queryPostgresClient(client, 'UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', [new Date().toISOString(), row.id])
      return { id: row.id, userId: row.user_id }
    })
    if (!consumed) return null
    await insertAuditLog({ userId: consumed.userId, action: 'auth.password_reset_consumed', entityType: 'user', entityId: consumed.userId })
    return consumed
  }
  const row = getDb()
    .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ? LIMIT 1')
    .get(tokenHash) as {
      id: string
      user_id: string
      token_hash: string
      expires_at: string
      created_at: string
      used_at: string | null
      user_agent: string | null
      ip_address: string | null
    } | undefined

  if (!row) return null
  if (row.used_at) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) return null

  getDb()
    .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id)

  await insertAuditLog({
    userId: row.user_id,
    action: 'auth.password_reset_consumed',
    entityType: 'user',
    entityId: row.user_id,
  })

  return {
    id: row.id,
    userId: row.user_id,
  }
}

export async function consumeEmailVerificationToken(token: string) {
  await ensureDbReady()
  const trimmed = token.trim()
  if (!trimmed) return null
  const tokenHash = hashEmailVerificationToken(trimmed)
  if (isPostgresEnabled()) {
    const consumed = await withPostgresTransaction(async client => {
      const result = await queryPostgresClient<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(client, 'SELECT * FROM email_verification_tokens WHERE token_hash = ? LIMIT 1 FOR UPDATE', [tokenHash])
      const row = result.rows[0]
      if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return null
      await queryPostgresClient(client, 'UPDATE email_verification_tokens SET used_at = ? WHERE id = ?', [new Date().toISOString(), row.id])
      return { id: row.id, userId: row.user_id }
    })
    if (!consumed) return null
    await insertAuditLog({ userId: consumed.userId, action: 'auth.email_verification_consumed', entityType: 'user', entityId: consumed.userId })
    return consumed
  }
  const row = getDb()
    .prepare('SELECT * FROM email_verification_tokens WHERE token_hash = ? LIMIT 1')
    .get(tokenHash) as {
      id: string
      user_id: string
      token_hash: string
      expires_at: string
      created_at: string
      used_at: string | null
      user_agent: string | null
      ip_address: string | null
    } | undefined

  if (!row) return null
  if (row.used_at) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) return null

  getDb()
    .prepare('UPDATE email_verification_tokens SET used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id)

  await insertAuditLog({
    userId: row.user_id,
    action: 'auth.email_verification_consumed',
    entityType: 'user',
    entityId: row.user_id,
  })

  return {
    id: row.id,
    userId: row.user_id,
  }
}

export async function activateUserAccount(userId: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE users SET "accountStatus" = ? WHERE id = ?', ['active', userId])
    await insertAuditLog({ userId, action: 'auth.email_verified', entityType: 'user', entityId: userId })
    return getUserById(userId)
  }
  getDb().prepare('UPDATE users SET accountStatus = ? WHERE id = ?').run('active', userId)
  await insertAuditLog({
    userId,
    action: 'auth.email_verified',
    entityType: 'user',
    entityId: userId,
  })
  return getUserById(userId)
}

export async function consumeAuthRateLimitAttempt(input: {
  action: 'login' | 'forgot_password' | 'reset_password' | 'verify_email'
  scopes: string[]
  limit: number
  windowMinutes: number
}) {
  await ensureDbReady()
  const uniqueScopes = Array.from(new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean)))
  if (!uniqueScopes.length) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: input.limit,
      blockedScope: null,
    }
  }

  if (isPostgresEnabled()) {
    const now = new Date()
    const nowIso = now.toISOString()
    const cutoffIso = new Date(now.getTime() - input.windowMinutes * 60 * 1000).toISOString()
    const retentionIso = new Date(now.getTime() - AUTH_RATE_LIMIT_RETENTION_HOURS * 60 * 60 * 1000).toISOString()
    return withPostgresTransaction(async client => {
      await queryPostgresClient(client, 'DELETE FROM auth_rate_limit_attempts WHERE created_at <= ?', [retentionIso])
      const states = await Promise.all(uniqueScopes.map(async scope => {
        const result = await queryPostgresClient<{ count: string; oldest_created_at: string | null }>(client, 'SELECT COUNT(*) AS count, MIN(created_at) AS oldest_created_at FROM auth_rate_limit_attempts WHERE action = ? AND scope = ? AND created_at >= ?', [input.action, scope, cutoffIso])
        return { scope, count: Number(result.rows[0]?.count ?? 0), oldestCreatedAt: result.rows[0]?.oldest_created_at ?? null }
      }))
      const blocked = states.find(state => state.count >= input.limit)
      if (blocked) return { allowed: false, retryAfterSeconds: blocked.oldestCreatedAt ? Math.max(1, Math.ceil((new Date(blocked.oldestCreatedAt).getTime() + input.windowMinutes * 60 * 1000 - now.getTime()) / 1000)) : input.windowMinutes * 60, remaining: 0, blockedScope: blocked.scope }
      for (const scope of uniqueScopes) await queryPostgresClient(client, 'INSERT INTO auth_rate_limit_attempts (id, action, scope, created_at) VALUES (?, ?, ?, ?)', [`arl_${randomBytes(6).toString('hex')}`, input.action, scope, nowIso])
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, input.limit - (Math.max(...states.map(state => state.count), 0) + 1)), blockedScope: null }
    })
  }

  const db = getDb()
  const now = new Date()
  const nowIso = now.toISOString()
  const cutoffIso = new Date(now.getTime() - input.windowMinutes * 60 * 1000).toISOString()
  const retentionIso = new Date(now.getTime() - AUTH_RATE_LIMIT_RETENTION_HOURS * 60 * 60 * 1000).toISOString()

  db.prepare('DELETE FROM auth_rate_limit_attempts WHERE created_at <= ?').run(retentionIso)

  type ScopeState = { scope: string; count: number; oldestCreatedAt: string | null }
  const states = uniqueScopes.map((scope) => {
    const row = db
      .prepare(`
        SELECT COUNT(*) AS count, MIN(created_at) AS oldest_created_at
        FROM auth_rate_limit_attempts
        WHERE action = ? AND scope = ? AND created_at >= ?
      `)
      .get(input.action, scope, cutoffIso) as { count?: number; oldest_created_at?: string | null } | undefined
    return {
      scope,
      count: Number(row?.count ?? 0),
      oldestCreatedAt: row?.oldest_created_at ?? null,
    } satisfies ScopeState
  })

  const blockedState = states.find((state) => state.count >= input.limit)
  if (blockedState) {
    const retryAfterSeconds = blockedState.oldestCreatedAt
      ? Math.max(
        1,
        Math.ceil(
          (new Date(blockedState.oldestCreatedAt).getTime() + input.windowMinutes * 60 * 1000 - now.getTime()) / 1000
        )
      )
      : input.windowMinutes * 60
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
      blockedScope: blockedState.scope,
    }
  }

  const insertAttempt = db.prepare(`
    INSERT INTO auth_rate_limit_attempts (id, action, scope, created_at)
    VALUES (?, ?, ?, ?)
  `)
  for (const scope of uniqueScopes) {
    insertAttempt.run(`arl_${randomBytes(6).toString('hex')}`, input.action, scope, nowIso)
  }

  const remaining = Math.max(0, input.limit - (Math.max(...states.map((state) => state.count), 0) + 1))
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining,
    blockedScope: null,
  }
}

export async function clearAuthRateLimitAttempts(input: {
  action: 'login' | 'forgot_password' | 'reset_password' | 'verify_email'
  scopes: string[]
}) {
  await ensureDbReady()
  const uniqueScopes = Array.from(new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean)))
  if (!uniqueScopes.length) return 0
  if (isPostgresEnabled()) {
    let removed = 0
    for (const scope of uniqueScopes) removed += (await queryPostgres('DELETE FROM auth_rate_limit_attempts WHERE action = ? AND scope = ?', [input.action, scope])).rowCount ?? 0
    return removed
  }
  const statement = getDb().prepare('DELETE FROM auth_rate_limit_attempts WHERE action = ? AND scope = ?')
  let removed = 0
  for (const scope of uniqueScopes) {
    const result = statement.run(input.action, scope) as { changes?: number }
    removed += Number(result.changes ?? 0)
  }
  return removed
}

export async function deleteSessionByToken(token: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('DELETE FROM sessions WHERE token = ?', [token])
    return
  }
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export async function deleteSessionsByUserId(userId: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('DELETE FROM sessions WHERE user_id = ?', [userId])
    return
  }
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export async function revokeUserSession(userId: string, token: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres('DELETE FROM sessions WHERE token = ? AND user_id = ?', [token, userId])
    return Number(result.rowCount ?? 0) > 0
  }
  const result = getDb()
    .prepare('DELETE FROM sessions WHERE token = ? AND user_id = ?')
    .run(token, userId) as { changes?: number }
  return Number(result.changes ?? 0) > 0
}

export async function revokeOtherUserSessions(userId: string, currentToken?: string | null) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = currentToken
      ? await queryPostgres('DELETE FROM sessions WHERE user_id = ? AND token != ?', [userId, currentToken])
      : await queryPostgres('DELETE FROM sessions WHERE user_id = ?', [userId])
    return Number(result.rowCount ?? 0)
  }
  const result = currentToken
    ? getDb()
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
      .run(userId, currentToken) as { changes?: number }
    : getDb()
      .prepare('DELETE FROM sessions WHERE user_id = ?')
      .run(userId) as { changes?: number }
  return Number(result.changes ?? 0)
}

export async function updateUserAccountStatus(input: {
  userId: string
  status: User['accountStatus']
  actorUserId?: string
  reason?: string
}) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const current = await getUserById(input.userId)
    if (!current) return null
    await withPostgresTransaction(async client => {
      await queryPostgresClient(client, 'UPDATE users SET "accountStatus" = ? WHERE id = ?', [input.status, input.userId])
      if (input.status === 'deactivated') await queryPostgresClient(client, 'DELETE FROM sessions WHERE user_id = ?', [input.userId])
    })
    await insertAuditLog({ userId: input.userId, actorUserId: input.actorUserId ?? input.userId, action: input.status === 'deactivated' ? 'account.deactivated' : 'account.reactivated', entityType: 'user', entityId: input.userId, metadata: input.reason ? { reason: input.reason } : undefined })
    return getUserById(input.userId)
  }
  const db = getDb()
  const current = await getUserById(input.userId)
  if (!current) return null

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE users SET accountStatus = ? WHERE id = ?')
      .run(input.status, input.userId)

    if (input.status === 'deactivated') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(input.userId)
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  await insertAuditLog({
    userId: input.userId,
    actorUserId: input.actorUserId ?? input.userId,
    action: input.status === 'deactivated' ? 'account.deactivated' : 'account.reactivated',
    entityType: 'user',
    entityId: input.userId,
    metadata: input.reason ? { reason: input.reason } : undefined,
  })

  return getUserById(input.userId)
}

export async function updateUserProfile(userId: string, updates: { name?: string; phone?: string }) {
  await ensureDbReady()
  const current = await getUserById(userId)
  if (!current) return null

  const name = typeof updates.name === 'string' && updates.name.trim() ? updates.name.trim() : current.name
  const phone = typeof updates.phone === 'string' && updates.phone.trim() ? updates.phone.trim() : current.phone
  const handle = name !== current.name ? buildHandle(name, current.email) : current.handle

  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE users SET name = ?, phone = ?, handle = ? WHERE id = ?', [name, phone, handle, userId])
    await insertAuditLog({ userId, actorUserId: userId, action: 'profile.updated', entityType: 'user', entityId: userId, metadata: { name, phone } })
    return getUserById(userId)
  }

  getDb()
    .prepare('UPDATE users SET name = ?, phone = ?, handle = ? WHERE id = ?')
    .run(name, phone, handle, userId)

  await insertAuditLog({
    userId,
    actorUserId: userId,
    action: 'profile.updated',
    entityType: 'user',
    entityId: userId,
    metadata: { name, phone },
  })

  return getUserById(userId)
}

export async function updateUserPassword(userId: string, password: string) {
  await ensureDbReady()
  const { passwordHash, passwordSalt } = createPasswordRecord(password)
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE users SET "passwordHash" = ?, "passwordSalt" = ? WHERE id = ?', [passwordHash, passwordSalt, userId])
    await insertAuditLog({ userId, actorUserId: userId, action: 'security.password_changed', entityType: 'user', entityId: userId })
    return
  }
  getDb()
    .prepare('UPDATE users SET passwordHash = ?, passwordSalt = ? WHERE id = ?')
    .run(passwordHash, passwordSalt, userId)

  await insertAuditLog({
    userId,
    actorUserId: userId,
    action: 'security.password_changed',
    entityType: 'user',
    entityId: userId,
  })
}

export async function insertNotification(notification: NotificationRecord) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await withPostgresTransaction(async client => {
      await queryPostgresClient(client, `
        INSERT INTO notifications (id, user_id, title, message, type, read, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [notification.id, notification.userId, notification.title, notification.message,
        notification.type, notification.read, notification.createdAt])
      await queryPostgresClient(client, `
        DELETE FROM notifications
        WHERE id IN (
          SELECT id FROM notifications
          WHERE user_id = ? ORDER BY created_at DESC OFFSET 20
        )
      `, [notification.userId])
    })
    return
  }
  const db = getDb()
  db.exec('BEGIN')

  try {
    db.prepare(`
      INSERT INTO notifications (id, user_id, title, message, type, read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      notification.id,
      notification.userId,
      notification.title,
      notification.message,
      notification.type,
      notification.read ? 1 : 0,
      notification.createdAt
    )

    db.prepare(`
      DELETE FROM notifications
      WHERE id IN (
        SELECT id FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT -1 OFFSET 20
      )
    `).run(notification.userId)

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function getNotificationsForUser(userId: string): Promise<NotificationRecord[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<NotificationRow>(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC', [userId]
    )
    return result.rows.map(mapNotificationRow)
  }
  const rows = getDb()
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as NotificationRow[]
  return rows.map(mapNotificationRow)
}

export async function upsertPushToken(input: {
  userId: string
  token: string
  platform: PushTokenRecord['platform']
}): Promise<void> {
  await ensureDbReady()
  const now = new Date().toISOString()

  if (isPostgresEnabled()) {
    await queryPostgres(`
      INSERT INTO push_tokens (id, user_id, token, platform, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, token) DO UPDATE SET
        platform = excluded.platform, last_seen_at = excluded.last_seen_at
    `, [`pt_${randomBytes(6).toString('hex')}`, input.userId, input.token, input.platform, now, now])
    return
  }

  getDb()
    .prepare(`
      INSERT INTO push_tokens (id, user_id, token, platform, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, token) DO UPDATE SET
        platform = excluded.platform,
        last_seen_at = excluded.last_seen_at
    `)
    .run(`pt_${randomBytes(6).toString('hex')}`, input.userId, input.token, input.platform, now, now)
}

export async function getPushTokensByUserId(userId: string): Promise<PushTokenRecord[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<PushTokenRow>(
      'SELECT * FROM push_tokens WHERE user_id = ? ORDER BY last_seen_at DESC', [userId]
    )
    return result.rows.map(mapPushTokenRow)
  }
  const rows = getDb()
    .prepare('SELECT * FROM push_tokens WHERE user_id = ? ORDER BY last_seen_at DESC')
    .all(userId) as PushTokenRow[]
  return rows.map(mapPushTokenRow)
}

export async function deletePushToken(userId: string, token: string): Promise<void> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', [userId, token])
    return
  }
  getDb().prepare('DELETE FROM push_tokens WHERE user_id = ? AND token = ?').run(userId, token)
}

export async function listRecentNotifications(limit = 80): Promise<Array<NotificationRecord & {
  userName?: string
  userEmail?: string
  userPhone?: string
}>> {
  await ensureDbReady()
  const safeLimit = Math.max(1, Math.min(200, limit))
  if (isPostgresEnabled()) {
    const result = await queryPostgres<NotificationRow & {
      user_name?: string | null
      user_email?: string | null
      user_phone?: string | null
    }>(`
      SELECT n.id, n.user_id, n.title, n.message, n.type, n.read, n.created_at,
             u.name AS user_name, u.email AS user_email, u.phone AS user_phone
      FROM notifications n LEFT JOIN users u ON u.id = n.user_id
      ORDER BY n.created_at DESC LIMIT ?
    `, [safeLimit])
    return result.rows.map(row => ({
      ...mapNotificationRow(row), userName: row.user_name ?? undefined,
      userEmail: row.user_email ?? undefined, userPhone: row.user_phone ?? undefined,
    }))
  }
  const rows = getDb()
    .prepare(`
      SELECT
        n.id,
        n.user_id,
        n.title,
        n.message,
        n.type,
        n.read,
        n.created_at,
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS user_phone
      FROM notifications n
      LEFT JOIN users u ON u.id = n.user_id
      ORDER BY n.created_at DESC
      LIMIT ?
    `)
    .all(safeLimit) as Array<NotificationRow & {
      user_name?: string | null
      user_email?: string | null
      user_phone?: string | null
    }>

  return rows.map(row => ({
    ...mapNotificationRow(row),
    userName: row.user_name ?? undefined,
    userEmail: row.user_email ?? undefined,
    userPhone: row.user_phone ?? undefined,
  }))
}

export async function getCryptoAssets(options?: { forceRefresh?: boolean; liveOnly?: boolean }): Promise<CryptoAsset[]> {
  await ensureDbReady()
  const rows = isPostgresEnabled()
    ? (await queryPostgres<CryptoPairRow>('SELECT * FROM crypto_pairs WHERE is_active = ?', [true])).rows
    : getDb().prepare('SELECT * FROM crypto_pairs WHERE is_active = 1').all() as CryptoPairRow[]
  const persistedAssets = rows.map(mapCryptoPairRow)
  const shouldRefresh = options?.forceRefresh === true || persistedAssets.some(asset =>
    asset.marketSnapshotSource !== 'live' || !isCryptoMarketSnapshotFresh(asset.marketPriceUpdatedAt)
  )
  if (CRYPTO_MARKET_LOGGING_ENABLED) {
    console.log('[crypto-assets] getCryptoAssets', JSON.stringify({
      forceRefresh: options?.forceRefresh === true,
      liveOnly: options?.liveOnly === true,
      shouldRefresh,
      persistedAssets: persistedAssets.map(asset => ({
        id: asset.id,
        snapshotSource: asset.marketSnapshotSource ?? null,
        updatedAt: asset.marketPriceUpdatedAt ?? null,
      })),
    }))
  }
  if (!shouldRefresh) {
    return persistedAssets.map(mapPersistedCryptoSnapshot).sort((a, b) => a.marketRate - b.marketRate)
  }

  return await refreshCryptoAssetsSingleFlight(persistedAssets, { liveOnly: options?.liveOnly })
}

export async function getCryptoAssetById(id: string): Promise<CryptoAsset | null> {
  await ensureDbReady()
  const row = isPostgresEnabled()
    ? (await queryPostgres<CryptoPairRow>('SELECT * FROM crypto_pairs WHERE id = ? LIMIT 1', [id])).rows[0]
    : getDb().prepare('SELECT * FROM crypto_pairs WHERE id = ? LIMIT 1').get(id) as CryptoPairRow | undefined
  if (!row) return null
  const persistedAsset = mapCryptoPairRow(row)
  const [asset] = persistedAsset.marketSnapshotSource === 'live' && isCryptoMarketSnapshotFresh(persistedAsset.marketPriceUpdatedAt)
    ? [mapPersistedCryptoSnapshot(persistedAsset)]
    : await hydrateCryptoAssetPricing([persistedAsset])
  if (asset) await persistCryptoMarketSnapshots([asset])
  return asset ?? null
}

export async function getCryptoAssetBySymbol(symbol: string): Promise<CryptoAsset | null> {
  await ensureDbReady()
  const row = isPostgresEnabled()
    ? (await queryPostgres<CryptoPairRow>('SELECT * FROM crypto_pairs WHERE symbol = ? AND is_active = ?', [symbol, true])).rows[0]
    : getDb().prepare('SELECT * FROM crypto_pairs WHERE symbol = ? AND is_active = 1 LIMIT 1').get(symbol) as CryptoPairRow | undefined
  if (!row) return null
  const persistedAsset = mapCryptoPairRow(row)
  const [asset] = persistedAsset.marketSnapshotSource === 'live' && isCryptoMarketSnapshotFresh(persistedAsset.marketPriceUpdatedAt)
    ? [mapPersistedCryptoSnapshot(persistedAsset)]
    : await hydrateCryptoAssetPricing([persistedAsset])
  if (asset) await persistCryptoMarketSnapshots([asset])
  return asset ?? null
}

export async function refreshCryptoMarketSnapshots(): Promise<CryptoAsset[]> {
  await ensureDbReady()
  const rows = isPostgresEnabled()
    ? (await queryPostgres<CryptoPairRow>('SELECT * FROM crypto_pairs WHERE is_active = ?', [true])).rows
    : getDb().prepare('SELECT * FROM crypto_pairs WHERE is_active = 1').all() as CryptoPairRow[]
  return await refreshCryptoAssetsSingleFlight(rows.map(mapCryptoPairRow))
}

export function ensureCryptoMarketAutoRefreshScheduler() {
  const state = getCryptoMarketSchedulerState()
  if (state.interval) return

  state.interval = setInterval(() => {
    void kickCryptoMarketRefresh().catch(error => {
      if (CRYPTO_MARKET_LOGGING_ENABLED) {
        console.error('[crypto-market] scheduler.error', error)
      }
    })
  }, 30_000)
}

export async function kickCryptoMarketRefresh() {
  const state = getCryptoMarketSchedulerState()
  if (state.kickPromise) return await state.kickPromise

  const promise = refreshCryptoMarketSnapshots()
  state.kickPromise = promise

  try {
    return await promise
  } finally {
    if (state.kickPromise === promise) {
      state.kickPromise = undefined
    }
  }
}

export async function createCryptoQuote(input: {
  userId: string
  pairId: CryptoAsset['id']
  side: 'buy' | 'sell'
  amountNgn: number
  unitRate?: number
  cryptoAmount?: number
  providerPayload?: Record<string, unknown>
}) {
  await ensureDbReady()
  const asset = await getCryptoAssetById(input.pairId)
  if (!asset || asset.isActive === false) {
    throw new Error('Unsupported crypto pair.')
  }

  const unitRate = input.unitRate ?? (input.side === 'buy' ? asset.buyRate : asset.sellRate)
  const cryptoAmount = input.cryptoAmount ?? (input.amountNgn / unitRate)
  // Gas recovery applies to crypto buys only. Deposits/sells credit the displayed sell rate in full.
  const networkFeeNgn = input.side === 'buy' ? getCryptoNetworkFeeNgn(asset, 'buy') : 0
  const now = new Date()
  const quoteTtlSeconds = getEffectiveQuoteTtlSeconds(asset.id, asset.quoteTtlSeconds)
  const expiresAt = new Date(now.getTime() + quoteTtlSeconds * 1000).toISOString()
  const id = `cq_${randomBytes(6).toString('hex')}`

  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoQuoteRow>(`
      INSERT INTO crypto_quotes (id, user_id, pair_id, side, amount_ngn, crypto_amount, unit_rate, network_fee_ngn, provider_payload, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `, [id, input.userId, input.pairId, input.side, input.amountNgn, cryptoAmount, unitRate,
      networkFeeNgn, input.providerPayload ? JSON.stringify(input.providerPayload) : null, expiresAt, now.toISOString()])
    const row = result.rows[0]
    if (!row) throw new Error('Unable to create quote.')
    return { asset, quote: mapCryptoQuoteRow(row) }
  }

  getDb().prepare(`
    INSERT INTO crypto_quotes (
      id, user_id, pair_id, side, amount_ngn, crypto_amount, unit_rate, network_fee_ngn, provider_payload, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.pairId,
    input.side,
    input.amountNgn,
    cryptoAmount,
    unitRate,
    networkFeeNgn,
    input.providerPayload ? JSON.stringify(input.providerPayload) : null,
    expiresAt,
    now.toISOString()
  )

  const row = getDb().prepare('SELECT * FROM crypto_quotes WHERE id = ? LIMIT 1').get(id) as CryptoQuoteRow | undefined
  if (!row) throw new Error('Unable to create quote.')
  return { asset, quote: mapCryptoQuoteRow(row) }
}

export async function getCryptoQuoteById(id: string): Promise<CryptoQuote | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoQuoteRow>('SELECT * FROM crypto_quotes WHERE id = ? LIMIT 1', [id])
    return result.rows[0] ? mapCryptoQuoteRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM crypto_quotes WHERE id = ? LIMIT 1').get(id) as CryptoQuoteRow | undefined
  return row ? mapCryptoQuoteRow(row) : null
}

export async function createCryptoOrder(input: {
  userId: string
  transactionId: string
  quoteId: string
  pairId: CryptoOrder['pairId']
  side: 'buy' | 'sell'
  amountNgn: number
  cryptoAmount: number
  unitRate: number
  destinationType: CryptoOrder['destinationType']
  destinationLabel?: string
  walletAddress?: string
  exchange?: string
  provider?: CryptoOrder['provider']
  providerOrderId?: string
  providerStatus?: string
  providerReference?: string
  providerPayload?: Record<string, unknown>
  executionRail?: CryptoOrder['executionRail']
  executionStatus?: CryptoOrder['executionStatus']
  executionReference?: string
  destinationTxHash?: string
  expiresAt?: string
  fulfilledAt?: string
  webhookReceivedAt?: string
  status?: CryptoOrder['status']
}) {
  await ensureDbReady()
  const now = new Date().toISOString()
  const id = `co_${randomBytes(6).toString('hex')}`
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoOrderRow>(`
      INSERT INTO crypto_orders (id, user_id, transaction_id, quote_id, pair_id, side, amount_ngn, crypto_amount, unit_rate, destination_type, destination_label, wallet_address, exchange, provider, provider_order_id, provider_status, provider_reference, provider_payload, execution_rail, execution_status, execution_reference, destination_tx_hash, expires_at, fulfilled_at, webhook_received_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `, [id, input.userId, input.transactionId, input.quoteId, input.pairId, input.side, input.amountNgn,
      input.cryptoAmount, input.unitRate, input.destinationType, input.destinationLabel ?? null,
      input.walletAddress ?? null, input.exchange ?? null, input.provider ?? null, input.providerOrderId ?? null,
      input.providerStatus ?? null, input.providerReference ?? null,
      input.providerPayload ? JSON.stringify(input.providerPayload) : null, input.executionRail ?? null,
      input.executionStatus ?? null, input.executionReference ?? null, input.destinationTxHash ?? null,
      input.expiresAt ?? null, input.fulfilledAt ?? null, input.webhookReceivedAt ?? null,
      input.status ?? 'fulfilled', now, now])
    const row = result.rows[0]
    if (!row) throw new Error('Unable to create crypto order.')
    return mapCryptoOrderRow(row)
  }
  getDb().prepare(`
    INSERT INTO crypto_orders (
      id, user_id, transaction_id, quote_id, pair_id, side, amount_ngn, crypto_amount, unit_rate, destination_type, destination_label, wallet_address, exchange, provider, provider_order_id, provider_status, provider_reference, provider_payload, execution_rail, execution_status, execution_reference, destination_tx_hash, expires_at, fulfilled_at, webhook_received_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.userId,
    input.transactionId,
    input.quoteId,
    input.pairId,
    input.side,
    input.amountNgn,
    input.cryptoAmount,
    input.unitRate,
    input.destinationType,
    input.destinationLabel ?? null,
    input.walletAddress ?? null,
    input.exchange ?? null,
    input.provider ?? null,
    input.providerOrderId ?? null,
    input.providerStatus ?? null,
    input.providerReference ?? null,
    input.providerPayload ? JSON.stringify(input.providerPayload) : null,
    input.executionRail ?? null,
    input.executionStatus ?? null,
    input.executionReference ?? null,
    input.destinationTxHash ?? null,
    input.expiresAt ?? null,
    input.fulfilledAt ?? null,
    input.webhookReceivedAt ?? null,
    input.status ?? 'fulfilled',
    now,
    now
  )

  const row = getDb().prepare('SELECT * FROM crypto_orders WHERE id = ? LIMIT 1').get(id) as CryptoOrderRow | undefined
  if (!row) throw new Error('Unable to create crypto order.')
  return mapCryptoOrderRow(row)
}

export async function updateCryptoOrderExecution(input: {
  id: string
  executionRail?: CryptoOrder['executionRail'] | null
  executionStatus?: CryptoOrder['executionStatus'] | null
  executionReference?: string | null
  destinationTxHash?: string | null
}) {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`
      UPDATE crypto_orders SET execution_rail = COALESCE(?, execution_rail), execution_status = COALESCE(?, execution_status),
      execution_reference = COALESCE(?, execution_reference), destination_tx_hash = COALESCE(?, destination_tx_hash), updated_at = ? WHERE id = ?
    `, [input.executionRail ?? null, input.executionStatus ?? null, input.executionReference ?? null,
      input.destinationTxHash ?? null, now, input.id])
    return getCryptoOrderById(input.id)
  }
  getDb().prepare(`
    UPDATE crypto_orders
    SET execution_rail = COALESCE(?, execution_rail),
        execution_status = COALESCE(?, execution_status),
        execution_reference = COALESCE(?, execution_reference),
        destination_tx_hash = COALESCE(?, destination_tx_hash),
        updated_at = ?
    WHERE id = ?
  `).run(
    input.executionRail ?? null,
    input.executionStatus ?? null,
    input.executionReference ?? null,
    input.destinationTxHash ?? null,
    now,
    input.id
  )
  return getCryptoOrderById(input.id)
}

export async function getCryptoOrderByTransactionId(transactionId: string): Promise<CryptoOrder | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoOrderRow>('SELECT * FROM crypto_orders WHERE transaction_id = ? LIMIT 1', [transactionId])
    return result.rows[0] ? mapCryptoOrderRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM crypto_orders WHERE transaction_id = ? LIMIT 1').get(transactionId) as CryptoOrderRow | undefined
  return row ? mapCryptoOrderRow(row) : null
}

export async function getCryptoOrderByProviderReference(providerReference: string): Promise<CryptoOrder | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoOrderRow>('SELECT * FROM crypto_orders WHERE provider_reference = ? LIMIT 1', [providerReference])
    return result.rows[0] ? mapCryptoOrderRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM crypto_orders WHERE provider_reference = ? LIMIT 1').get(providerReference) as CryptoOrderRow | undefined
  return row ? mapCryptoOrderRow(row) : null
}

export async function getCryptoOrderByProviderOrderId(providerOrderId: string): Promise<CryptoOrder | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoOrderRow>('SELECT * FROM crypto_orders WHERE provider_order_id = ? LIMIT 1', [providerOrderId])
    return result.rows[0] ? mapCryptoOrderRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM crypto_orders WHERE provider_order_id = ? LIMIT 1').get(providerOrderId) as CryptoOrderRow | undefined
  return row ? mapCryptoOrderRow(row) : null
}

export async function getCryptoOrderById(id: string): Promise<CryptoOrder | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoOrderRow>('SELECT * FROM crypto_orders WHERE id = ? LIMIT 1', [id])
    return result.rows[0] ? mapCryptoOrderRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM crypto_orders WHERE id = ? LIMIT 1').get(id) as CryptoOrderRow | undefined
  return row ? mapCryptoOrderRow(row) : null
}

export async function listCryptoOrders(input?: { status?: CryptoOrder['status']; pairId?: string; side?: CryptoOrder['side']; limit?: number }) {
  await ensureDbReady()
  const limit = Math.max(1, Math.min(100, input?.limit ?? 50))
  const where: string[] = []
  const args: Array<string | number> = []

  if (input?.status) {
    where.push('status = ?')
    args.push(input.status)
  }
  if (input?.pairId?.trim()) {
    where.push('pair_id = ?')
    args.push(input.pairId.trim())
  }
  if (input?.side) {
    where.push('side = ?')
    args.push(input.side)
  }

  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoOrderRow>(`
      SELECT * FROM crypto_orders ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `, [...args, limit])
    return result.rows.map(mapCryptoOrderRow)
  }

  const rows = getDb().prepare(`
    SELECT * FROM crypto_orders
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...args, limit) as CryptoOrderRow[]

  return rows.map(mapCryptoOrderRow)
}

export async function listCryptoOrdersByUser(userId: string, input?: { status?: CryptoOrder['status']; pairId?: string; side?: CryptoOrder['side']; limit?: number }) {
  await ensureDbReady()
  const limit = Math.max(1, Math.min(100, input?.limit ?? 50))
  const where: string[] = ['user_id = ?']
  const args: Array<string | number> = [userId]

  if (input?.status) {
    where.push('status = ?')
    args.push(input.status)
  }
  if (input?.pairId?.trim()) {
    where.push('pair_id = ?')
    args.push(input.pairId.trim())
  }
  if (input?.side) {
    where.push('side = ?')
    args.push(input.side)
  }

  if (isPostgresEnabled()) {
    const result = await queryPostgres<CryptoOrderRow>(`
      SELECT * FROM crypto_orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?
    `, [...args, limit])
    return result.rows.map(mapCryptoOrderRow)
  }

  const rows = getDb().prepare(`
    SELECT * FROM crypto_orders
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...args, limit) as CryptoOrderRow[]

  return rows.map(mapCryptoOrderRow)
}

export async function updateCryptoOrderStatus(id: string, status: CryptoOrder['status']) {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`UPDATE crypto_orders SET status = ?, fulfilled_at = CASE WHEN ? = 'fulfilled' THEN COALESCE(fulfilled_at, ?) ELSE fulfilled_at END, updated_at = ? WHERE id = ?`, [status, status, now, now, id])
    return getCryptoOrderById(id)
  }
  getDb().prepare(`
    UPDATE crypto_orders
    SET status = ?,
        fulfilled_at = CASE WHEN ? = 'fulfilled' THEN COALESCE(fulfilled_at, ?) ELSE fulfilled_at END,
        updated_at = ?
    WHERE id = ?
  `).run(status, status, now, now, id)
  return getCryptoOrderById(id)
}

export async function updateCryptoOrderProviderState(input: {
  id: string
  provider?: CryptoOrder['provider']
  providerOrderId?: string | null
  providerStatus?: string | null
  providerReference?: string | null
  providerPayload?: Record<string, unknown> | null
  expiresAt?: string | null
  webhookReceivedAt?: string | null
  status?: CryptoOrder['status']
}) {
  await ensureDbReady()
  const now = new Date().toISOString()
  if (isPostgresEnabled()) {
    await queryPostgres(`
      UPDATE crypto_orders SET provider = COALESCE(?, provider), provider_order_id = COALESCE(?, provider_order_id),
      provider_status = COALESCE(?, provider_status), provider_reference = COALESCE(?, provider_reference),
      provider_payload = COALESCE(?, provider_payload), expires_at = COALESCE(?, expires_at),
      webhook_received_at = COALESCE(?, webhook_received_at), status = COALESCE(?, status),
      fulfilled_at = CASE WHEN COALESCE(?, status) = 'fulfilled' THEN COALESCE(fulfilled_at, ?) ELSE fulfilled_at END,
      updated_at = ? WHERE id = ?
    `, [input.provider ?? null, input.providerOrderId ?? null, input.providerStatus ?? null,
      input.providerReference ?? null, input.providerPayload === undefined ? null : JSON.stringify(input.providerPayload),
      input.expiresAt ?? null, input.webhookReceivedAt ?? null, input.status ?? null, input.status ?? null, now, now, input.id])
    return getCryptoOrderById(input.id)
  }
  getDb().prepare(`
    UPDATE crypto_orders
    SET provider = COALESCE(?, provider),
        provider_order_id = COALESCE(?, provider_order_id),
        provider_status = COALESCE(?, provider_status),
        provider_reference = COALESCE(?, provider_reference),
        provider_payload = COALESCE(?, provider_payload),
        expires_at = COALESCE(?, expires_at),
        webhook_received_at = COALESCE(?, webhook_received_at),
        status = COALESCE(?, status),
        fulfilled_at = CASE WHEN COALESCE(?, status) = 'fulfilled' THEN COALESCE(fulfilled_at, ?) ELSE fulfilled_at END,
        updated_at = ?
    WHERE id = ?
  `).run(
    input.provider ?? null,
    input.providerOrderId ?? null,
    input.providerStatus ?? null,
    input.providerReference ?? null,
    input.providerPayload === undefined ? null : input.providerPayload ? JSON.stringify(input.providerPayload) : JSON.stringify(null),
    input.expiresAt ?? null,
    input.webhookReceivedAt ?? null,
    input.status ?? null,
    input.status ?? null,
    now,
    now,
    input.id
  )
  return getCryptoOrderById(input.id)
}

export async function consumeCryptoQuote(userId: string, quoteId: string, side: 'buy' | 'sell') {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    return withPostgresTransaction(async client => {
      const result = await queryPostgresClient<CryptoQuoteRow>(client, `
        SELECT * FROM crypto_quotes WHERE id = ? AND user_id = ? AND side = ? LIMIT 1 FOR UPDATE
      `, [quoteId, userId, side])
      const row = result.rows[0]
      if (!row) throw new Error('Quote not found.')
      const quote = mapCryptoQuoteRow(row)
      if (quote.usedAt) throw new Error('Quote has already been used.')
      if (new Date(quote.expiresAt).getTime() <= Date.now()) throw new Error('Quote has expired.')
      const usedAt = new Date().toISOString()
      await queryPostgresClient(client, 'UPDATE crypto_quotes SET used_at = ? WHERE id = ?', [usedAt, quoteId])
      const asset = await getCryptoAssetById(quote.pairId)
      if (!asset) throw new Error('Crypto pair no longer exists.')
      return { asset, quote: { ...quote, usedAt } }
    })
  }
  const row = getDb().prepare(`
    SELECT * FROM crypto_quotes
    WHERE id = ? AND user_id = ? AND side = ?
    LIMIT 1
  `).get(quoteId, userId, side) as CryptoQuoteRow | undefined

  if (!row) {
    throw new Error('Quote not found.')
  }

  const quote = mapCryptoQuoteRow(row)
  if (quote.usedAt) {
    throw new Error('Quote has already been used.')
  }
  if (new Date(quote.expiresAt).getTime() <= Date.now()) {
    throw new Error('Quote has expired.')
  }

  getDb().prepare('UPDATE crypto_quotes SET used_at = ? WHERE id = ?').run(new Date().toISOString(), quoteId)
  const asset = await getCryptoAssetById(quote.pairId)
  if (!asset) throw new Error('Crypto pair no longer exists.')
  return { asset, quote: { ...quote, usedAt: new Date().toISOString() } }
}

export async function getBillProviders(): Promise<BillProvider[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) return (await queryPostgres<BillProviderRow>('SELECT * FROM bill_providers ORDER BY name ASC')).rows.map(mapBillProviderRow)
  const rows = getDb().prepare('SELECT * FROM bill_providers ORDER BY name ASC').all() as BillProviderRow[]
  return rows.map(mapBillProviderRow)
}

export async function upsertBillProviders(providers: BillProvider[]) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await withPostgresTransaction(async client => {
      for (const provider of providers) await queryPostgresClient(client, `
        INSERT INTO bill_providers (id, name, icon, type, account_label, account_placeholder, helper_text, min_amount, max_amount, requires_network, requires_account, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, type = excluded.type, account_label = excluded.account_label, account_placeholder = excluded.account_placeholder, helper_text = excluded.helper_text, min_amount = excluded.min_amount, max_amount = excluded.max_amount, requires_network = excluded.requires_network, requires_account = excluded.requires_account, is_active = excluded.is_active, updated_at = excluded.updated_at
      `, [provider.id, provider.name, provider.icon, provider.type, provider.accountLabel ?? null, provider.accountPlaceholder ?? null, provider.helperText ?? null, provider.minAmount ?? null, provider.maxAmount ?? null, provider.requiresNetwork === true, provider.requiresAccount !== false, provider.isActive !== false, now, now])
    })
    return getBillProviders()
  }
  const db = getDb()
  const now = new Date().toISOString()
  const statement = db.prepare(`
    INSERT INTO bill_providers (
      id, name, icon, type, account_label, account_placeholder, helper_text,
      min_amount, max_amount, requires_network, requires_account, is_active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      icon = excluded.icon,
      type = excluded.type,
      account_label = excluded.account_label,
      account_placeholder = excluded.account_placeholder,
      helper_text = excluded.helper_text,
      min_amount = excluded.min_amount,
      max_amount = excluded.max_amount,
      requires_network = excluded.requires_network,
      requires_account = excluded.requires_account,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `)

  db.exec('BEGIN')
  try {
    for (const provider of providers) {
      statement.run(
        provider.id,
        provider.name,
        provider.icon,
        provider.type,
        provider.accountLabel ?? null,
        provider.accountPlaceholder ?? null,
        provider.helperText ?? null,
        provider.minAmount ?? null,
        provider.maxAmount ?? null,
        provider.requiresNetwork === true ? 1 : 0,
        provider.requiresAccount === false ? 0 : 1,
        provider.isActive === false ? 0 : 1,
        now,
        now
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return getBillProviders()
}

export async function getRewardRules(): Promise<RewardRule[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) return (await queryPostgres<RewardRuleRow>('SELECT * FROM reward_rules ORDER BY created_at DESC, id ASC')).rows.map(mapRewardRuleRow)
  const rows = getDb()
    .prepare('SELECT * FROM reward_rules ORDER BY created_at DESC, id ASC')
    .all() as RewardRuleRow[]
  return rows.map(mapRewardRuleRow)
}

export async function upsertRewardRules(rules: RewardRule[]) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await withPostgresTransaction(async client => {
      for (const rule of rules) {
        if (!rule.id.trim()) throw new Error('Reward rule id is required.')
        if (!rule.name.trim()) throw new Error(`${rule.id}: reward rule name is required.`)
        if (!Number.isFinite(rule.amountNgn) || rule.amountNgn <= 0) throw new Error(`${rule.id}: reward amount must be greater than zero.`)
        if (rule.dailyPayoutCapNgn != null && (!Number.isFinite(rule.dailyPayoutCapNgn) || rule.dailyPayoutCapNgn <= 0)) throw new Error(`${rule.id}: daily payout cap must be greater than zero when set.`)
        if (rule.audience === 'inviter' && rule.requiresReferral !== true) throw new Error(`${rule.id}: inviter rewards must require referral context.`)
        await queryPostgresClient(client, `
          INSERT INTO reward_rules (id, name, description, kind, trigger_event, audience, amount_ngn, requires_referral, allowed_transaction_types, excluded_transaction_types, daily_payout_cap_ngn, manual_approval_required, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, kind = excluded.kind, trigger_event = excluded.trigger_event, audience = excluded.audience, amount_ngn = excluded.amount_ngn, requires_referral = excluded.requires_referral, allowed_transaction_types = excluded.allowed_transaction_types, excluded_transaction_types = excluded.excluded_transaction_types, daily_payout_cap_ngn = excluded.daily_payout_cap_ngn, manual_approval_required = excluded.manual_approval_required, is_active = excluded.is_active, updated_at = excluded.updated_at
        `, [rule.id.trim(), rule.name.trim(), rule.description?.trim() || null, rule.kind, rule.triggerEvent, rule.audience, rule.amountNgn, rule.requiresReferral === true, rule.allowedTransactionTypes?.length ? JSON.stringify(rule.allowedTransactionTypes) : null, rule.excludedTransactionTypes?.length ? JSON.stringify(rule.excludedTransactionTypes) : null, rule.dailyPayoutCapNgn ?? null, rule.manualApprovalRequired === true, rule.isActive !== false, rule.createdAt || now, now])
      }
    })
    return getRewardRules()
  }
  const db = getDb()
  const now = new Date().toISOString()
  const statement = db.prepare(`
    INSERT INTO reward_rules (
      id, name, description, kind, trigger_event, audience, amount_ngn, requires_referral,
      allowed_transaction_types, excluded_transaction_types, daily_payout_cap_ngn, manual_approval_required,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      kind = excluded.kind,
      trigger_event = excluded.trigger_event,
      audience = excluded.audience,
      amount_ngn = excluded.amount_ngn,
      requires_referral = excluded.requires_referral,
      allowed_transaction_types = excluded.allowed_transaction_types,
      excluded_transaction_types = excluded.excluded_transaction_types,
      daily_payout_cap_ngn = excluded.daily_payout_cap_ngn,
      manual_approval_required = excluded.manual_approval_required,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `)

  db.exec('BEGIN')
  try {
    for (const rule of rules) {
      if (!rule.id.trim()) throw new Error('Reward rule id is required.')
      if (!rule.name.trim()) throw new Error(`${rule.id}: reward rule name is required.`)
      if (!Number.isFinite(rule.amountNgn) || rule.amountNgn <= 0) {
        throw new Error(`${rule.id}: reward amount must be greater than zero.`)
      }
      if (rule.dailyPayoutCapNgn != null && (!Number.isFinite(rule.dailyPayoutCapNgn) || rule.dailyPayoutCapNgn <= 0)) {
        throw new Error(`${rule.id}: daily payout cap must be greater than zero when set.`)
      }
      if (rule.audience === 'inviter' && rule.requiresReferral !== true) {
        throw new Error(`${rule.id}: inviter rewards must require referral context.`)
      }

      statement.run(
        rule.id.trim(),
        rule.name.trim(),
        rule.description?.trim() || null,
        rule.kind,
        rule.triggerEvent,
        rule.audience,
        rule.amountNgn,
        rule.requiresReferral === true ? 1 : 0,
        rule.allowedTransactionTypes?.length ? JSON.stringify(rule.allowedTransactionTypes) : null,
        rule.excludedTransactionTypes?.length ? JSON.stringify(rule.excludedTransactionTypes) : null,
        rule.dailyPayoutCapNgn ?? null,
        rule.manualApprovalRequired === true ? 1 : 0,
        rule.isActive === false ? 0 : 1,
        rule.createdAt || now,
        now
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return getRewardRules()
}

export async function getRewardRuleReport(limit = 20): Promise<RewardRuleReport> {
  await ensureDbReady()
  const db = getDb()
  const ruleRows = db
    .prepare('SELECT * FROM reward_rules ORDER BY created_at DESC, id ASC')
    .all() as RewardRuleRow[]
  const rules = ruleRows.map(mapRewardRuleRow)

  const rewardRows = db
    .prepare(`
      SELECT * FROM transactions
      WHERE type IN ('referral_bonus', 'reward_bonus')
      ORDER BY created_at DESC
    `)
    .all() as TransactionRow[]

  const userRows = db.prepare('SELECT * FROM users').all() as UserRow[]
  const userNameById = new Map(userRows.map(user => [user.id, user.name] as const))

  const summaries = new Map<string, RewardRuleSummary>()
  for (const rule of rules) {
    summaries.set(rule.id, {
      ruleId: rule.id,
      ruleName: rule.name,
      isActive: rule.isActive !== false,
      totalAwards: 0,
      totalPayoutNgn: 0,
      pendingManualCount: 0,
      lastAwardAt: undefined,
    })
  }

  const rewardRequestRows = db
    .prepare(`
      SELECT * FROM reward_award_requests
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(limit) as RewardAwardRequestRow[]
  const pendingByRuleRows = db
    .prepare(`
      SELECT reward_rule_id, reward_rule_name, COUNT(*) AS count
      FROM reward_award_requests
      WHERE status = 'pending'
      GROUP BY reward_rule_id, reward_rule_name
    `)
    .all() as Array<{ reward_rule_id: string; reward_rule_name: string; count?: number }>
  const pendingApprovalRow = db
    .prepare(`SELECT COUNT(*) AS count FROM reward_award_requests WHERE status = 'pending'`)
    .get() as { count?: number } | undefined
  const recentRequests = rewardRequestRows.map(row => mapRewardAwardRequestRow(row, userNameById))
  const recentAwards: RewardAwardRecord[] = []
  let totalAwards = 0
  let totalPayoutNgn = 0

  for (const row of pendingByRuleRows) {
    const summary = summaries.get(row.reward_rule_id) ?? {
      ruleId: row.reward_rule_id,
      ruleName: row.reward_rule_name,
      isActive: false,
      totalAwards: 0,
      totalPayoutNgn: 0,
      pendingManualCount: 0,
      lastAwardAt: undefined,
    }
    summary.pendingManualCount = Number(row.count ?? 0)
    summaries.set(row.reward_rule_id, summary)
  }

  for (const row of rewardRows) {
    const metadata = parseJson(row.metadata, {} as Record<string, unknown>)
    const rewardRuleId = typeof metadata.rewardRuleId === 'string' ? metadata.rewardRuleId : 'legacy_reward'
    const rewardRuleName = typeof metadata.rewardRuleName === 'string'
      ? metadata.rewardRuleName
      : (row.type === 'referral_bonus' ? 'Legacy Referral Reward' : 'Legacy Reward')
    const beneficiaryName = userNameById.get(row.user_id) ?? row.user_id
    const sourceUserId = typeof metadata.sourceUserId === 'string' ? metadata.sourceUserId : undefined
    const summary = summaries.get(rewardRuleId) ?? {
      ruleId: rewardRuleId,
      ruleName: rewardRuleName,
      isActive: false,
      totalAwards: 0,
      totalPayoutNgn: 0,
      pendingManualCount: 0,
      lastAwardAt: undefined,
    }

    summary.totalAwards += 1
    if (row.status === 'success') {
      summary.totalPayoutNgn += Number(row.amount)
      totalPayoutNgn += Number(row.amount)
    }
    if (!summary.lastAwardAt || row.created_at > summary.lastAwardAt) {
      summary.lastAwardAt = row.created_at
    }
    summaries.set(rewardRuleId, summary)
    totalAwards += 1

    if (recentAwards.length < limit) {
      recentAwards.push({
        transactionId: row.id,
        rewardRuleId,
        rewardRuleName,
        rewardType: row.type as RewardAwardRecord['rewardType'],
        beneficiaryUserId: row.user_id,
        beneficiaryName,
        sourceUserId,
        sourceUserName: sourceUserId ? userNameById.get(sourceUserId) ?? sourceUserId : undefined,
        amountNgn: Number(row.amount),
        status: row.status,
        createdAt: row.created_at,
        reference: row.reference,
      })
    }
  }

  return {
    totalAwards,
    totalPayoutNgn,
    pendingApprovalCount: Number(pendingApprovalRow?.count ?? 0),
    byRule: Array.from(summaries.values()).sort((a, b) => {
      if (b.totalPayoutNgn !== a.totalPayoutNgn) return b.totalPayoutNgn - a.totalPayoutNgn
      return a.ruleName.localeCompare(b.ruleName)
    }),
    recentAwards,
    recentRequests,
  }
}

export async function reviewRewardAwardRequest(input: {
  requestId: string
  action: 'approve' | 'reject'
  adminUserId: string
  reason?: string
}) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const context = await withPostgresTransaction(async client => {
      const requestResult = await queryPostgresClient<RewardAwardRequestRow>(client, 'SELECT * FROM reward_award_requests WHERE id = ? LIMIT 1 FOR UPDATE', [input.requestId])
      const request = requestResult.rows[0]
      if (!request) throw new Error('Reward award request not found.')
      if (request.status === 'approved') throw new Error('Reward award request is already approved.')
      const users = await queryPostgresClient<UserRow>(client, 'SELECT * FROM users WHERE id IN (?, ?)', [request.source_user_id, request.beneficiary_user_id])
      const sourceUser = users.rows.find(user => user.id === request.source_user_id)
      const beneficiary = users.rows.find(user => user.id === request.beneficiary_user_id)
      if (!sourceUser || !beneficiary) throw new Error('Reward request users could not be loaded.')
      const now = new Date().toISOString()
      if (input.action === 'reject') {
        await queryPostgresClient(client, `UPDATE reward_award_requests SET status = 'rejected', status_reason = ?, reviewed_at = ?, reviewed_by_user_id = ?, updated_at = ? WHERE id = ?`, [input.reason?.trim() || 'Rejected by admin.', now, input.adminUserId, now, input.requestId])
        return { request, sourceUser, beneficiary, approved: false, now }
      }
      const duplicate = await queryPostgresClient<{ id: string }>(client, `SELECT id FROM transactions WHERE user_id = ? AND type = ? AND status = ? AND metadata LIKE ? LIMIT 1`, [beneficiary.id, request.reward_type, 'success', `%"rewardRuleId":"${request.reward_rule_id}"%`])
      if (duplicate.rows[0]) throw new Error('Reward has already been paid for this rule trigger.')
      await queryPostgresClient(client, `UPDATE reward_award_requests SET status = 'approved', status_reason = ?, reviewed_at = ?, reviewed_by_user_id = ?, updated_at = ? WHERE id = ?`, [input.reason?.trim() || 'Approved by admin.', now, input.adminUserId, now, input.requestId])
      return { request, sourceUser, beneficiary, approved: true, now }
    })
    if (!context.approved) {
      await insertAuditLog({ userId: context.beneficiary.id, actorUserId: input.adminUserId, action: 'reward.rule_rejected_manual', entityType: 'reward_award_request', entityId: input.requestId, metadata: { rewardRuleId: context.request.reward_rule_id, sourceUserId: context.sourceUser.id, amount: Number(context.request.amount_ngn), reason: input.reason?.trim() || 'Rejected by admin.' } })
      return getRewardRuleReport()
    }
    const request = context.request
    const rewardTransaction: Transaction = { id: `tx_${randomBytes(6).toString('hex')}`, type: request.reward_type, status: 'success', amount: Number(request.amount_ngn), fee: 0, description: request.reward_kind === 'referral' ? `${request.reward_rule_name} â€” ${context.sourceUser.name}` : request.reward_rule_name, reference: generateRef(), createdAt: context.now, icon: request.reward_kind === 'referral' ? 'â‚¦' : 'ðŸŽ', metadata: { rewardRuleId: request.reward_rule_id, rewardRuleName: request.reward_rule_name, rewardEvent: request.trigger_event, sourceUserId: context.sourceUser.id, sourceReferralCode: context.sourceUser.referredByReferralCode ?? '', triggerTransactionId: request.trigger_transaction_id ?? undefined, role: request.audience, referredUserId: request.audience === 'inviter' ? context.sourceUser.id : undefined, approvalMode: 'manual' } }
    await applyWalletMutation({ userId: context.beneficiary.id, asset: 'NGN', balanceDelta: Number(request.amount_ngn), transaction: rewardTransaction })
    await insertNotification(createNotification({ userId: context.beneficiary.id, title: `${request.reward_rule_name} paid`, message: `You earned â‚¦${Number(request.amount_ngn).toLocaleString('en-NG')} from the "${request.reward_rule_name}" reward rule.`, type: 'success' }))
    await insertAuditLog({ userId: context.beneficiary.id, actorUserId: input.adminUserId, action: 'reward.rule_approved_manual', entityType: 'reward_award_request', entityId: input.requestId, metadata: { rewardRuleId: request.reward_rule_id, sourceUserId: context.sourceUser.id, amount: Number(request.amount_ngn) } })
    return getRewardRuleReport()
  }
  const db = getDb()
  const requestRow = db
    .prepare('SELECT * FROM reward_award_requests WHERE id = ? LIMIT 1')
    .get(input.requestId) as RewardAwardRequestRow | undefined
  if (!requestRow) throw new Error('Reward award request not found.')
  if (requestRow.status === 'approved') throw new Error('Reward award request is already approved.')

  const sourceUser = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(requestRow.source_user_id) as UserRow | undefined
  const beneficiary = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(requestRow.beneficiary_user_id) as UserRow | undefined
  const adminUser = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(input.adminUserId) as UserRow | undefined
  if (!sourceUser || !beneficiary) throw new Error('Reward request users could not be loaded.')

  const now = new Date().toISOString()
  if (input.action === 'reject') {
    db.prepare(`
      UPDATE reward_award_requests
      SET status = 'rejected',
          status_reason = ?,
          reviewed_at = ?,
          reviewed_by_user_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.reason?.trim() || 'Rejected by admin.',
      now,
      input.adminUserId,
      now,
      input.requestId
    )
    await insertAuditLog({
      userId: beneficiary.id,
      actorUserId: input.adminUserId,
      action: 'reward.rule_rejected_manual',
      entityType: 'reward_award_request',
      entityId: input.requestId,
      metadata: {
        rewardRuleId: requestRow.reward_rule_id,
        rewardRuleName: requestRow.reward_rule_name,
        sourceUserId: sourceUser.id,
        amount: Number(requestRow.amount_ngn),
        reason: input.reason?.trim() || 'Rejected by admin.',
      },
    })
    return getRewardRuleReport()
  }

  const existingRewardRows = db
    .prepare('SELECT metadata FROM transactions WHERE user_id = ? AND type = ? AND status = ?')
    .all(beneficiary.id, requestRow.reward_type, 'success') as Array<Pick<TransactionRow, 'metadata'>>
  const alreadyAwarded = existingRewardRows.some(existingRow => {
    const metadata = parseJson(existingRow.metadata, undefined as Record<string, unknown> | undefined)
    return metadata?.rewardRuleId === requestRow.reward_rule_id && metadata?.sourceUserId === sourceUser.id
  })
  if (alreadyAwarded) throw new Error('Reward has already been paid for this rule trigger.')

  const rewardTransaction: Transaction = {
    id: `tx_${randomBytes(6).toString('hex')}`,
    type: requestRow.reward_type,
    status: 'success',
    amount: Number(requestRow.amount_ngn),
    fee: 0,
    description: requestRow.reward_kind === 'referral' ? `${requestRow.reward_rule_name} — ${sourceUser.name}` : requestRow.reward_rule_name,
    reference: generateRef(),
    createdAt: now,
    icon: requestRow.reward_kind === 'referral' ? '₦' : '🎁',
    metadata: {
      rewardRuleId: requestRow.reward_rule_id,
      rewardRuleName: requestRow.reward_rule_name,
      rewardEvent: requestRow.trigger_event,
      sourceUserId: sourceUser.id,
      sourceReferralCode: sourceUser.referredByReferralCode ?? '',
      triggerTransactionId: requestRow.trigger_transaction_id ?? undefined,
      role: requestRow.audience,
      referredUserId: requestRow.audience === 'inviter' ? sourceUser.id : undefined,
      approvalMode: 'manual',
    },
  }

  await applyWalletMutation({
    userId: beneficiary.id,
    asset: 'NGN',
    balanceDelta: Number(requestRow.amount_ngn),
    transaction: rewardTransaction,
  })

  db.prepare(`
    UPDATE reward_award_requests
    SET status = 'approved',
        status_reason = ?,
        reviewed_at = ?,
        reviewed_by_user_id = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    input.reason?.trim() || 'Approved by admin.',
    now,
    input.adminUserId,
    now,
    input.requestId
  )

  await insertNotification(createNotification({
    userId: beneficiary.id,
    title: `${requestRow.reward_rule_name} paid`,
    message: `You earned ₦${Number(requestRow.amount_ngn).toLocaleString('en-NG')} from the "${requestRow.reward_rule_name}" reward rule.`,
    type: 'success',
  }))

  if (requestRow.audience === 'inviter') {
    await insertNotification(createNotification({
      userId: sourceUser.id,
      title: 'Referral tracked',
      message: 'Your qualifying activity triggered your inviter’s referral reward.',
      type: 'info',
    }))
  }

  await insertAuditLog({
    userId: beneficiary.id,
    actorUserId: input.adminUserId,
    action: 'reward.rule_approved_manual',
    entityType: 'reward_award_request',
    entityId: input.requestId,
    metadata: {
      rewardRuleId: requestRow.reward_rule_id,
      rewardRuleName: requestRow.reward_rule_name,
      sourceUserId: sourceUser.id,
      triggerTransactionId: requestRow.trigger_transaction_id ?? undefined,
      amount: Number(requestRow.amount_ngn),
      approvedByName: adminUser?.name ?? input.adminUserId,
    },
  })

  return getRewardRuleReport()
}

export async function getNetworkProviders(): Promise<NetworkProvider[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<NetworkProviderRow>('SELECT * FROM network_providers ORDER BY name ASC')
    return result.rows.map(row => {
      const provider = mapNetworkProviderRow(row)
      return { ...provider, icon: resolveNetworkProviderIcon(provider.name, provider.icon) }
    })
  }
  const rows = getDb().prepare('SELECT * FROM network_providers ORDER BY name ASC').all() as NetworkProviderRow[]
  return rows.map(row => {
    const provider = mapNetworkProviderRow(row)
    return {
      ...provider,
      icon: resolveNetworkProviderIcon(provider.name, provider.icon),
    }
  })
}

export async function getBankDirectory(country = 'NG', provider?: string): Promise<BankDirectoryEntry[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<BankDirectoryRow>(provider
      ? 'SELECT * FROM bank_directory WHERE country = ? AND provider = ? AND is_active = ? ORDER BY name ASC'
      : 'SELECT * FROM bank_directory WHERE country = ? AND is_active = ? ORDER BY name ASC', provider ? [country, provider, true] : [country, true])
    return result.rows.map(mapBankDirectoryRow)
  }
  const rows = (provider
    ? getDb().prepare(`
        SELECT * FROM bank_directory
        WHERE country = ? AND provider = ? AND is_active = 1
        ORDER BY name ASC
      `).all(country, provider)
    : getDb().prepare(`
        SELECT * FROM bank_directory
        WHERE country = ? AND is_active = 1
        ORDER BY name ASC
      `).all(country)
  ) as BankDirectoryRow[]
  return rows.map(mapBankDirectoryRow)
}

export async function getBankDirectoryEntryByCode(code: string, country = 'NG', provider?: string): Promise<BankDirectoryEntry | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<BankDirectoryRow>(provider
      ? 'SELECT * FROM bank_directory WHERE code = ? AND country = ? AND provider = ? LIMIT 1'
      : 'SELECT * FROM bank_directory WHERE code = ? AND country = ? ORDER BY updated_at DESC LIMIT 1', provider ? [code, country, provider] : [code, country])
    return result.rows[0] ? mapBankDirectoryRow(result.rows[0]) : null
  }
  const row = (provider
    ? getDb().prepare(`
        SELECT * FROM bank_directory
        WHERE code = ? AND country = ? AND provider = ?
        LIMIT 1
      `).get(code, country, provider)
    : getDb().prepare(`
        SELECT * FROM bank_directory
        WHERE code = ? AND country = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(code, country)
  ) as BankDirectoryRow | undefined
  return row ? mapBankDirectoryRow(row) : null
}

export async function upsertBankDirectory(entries: BankDirectoryEntry[]) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await withPostgresTransaction(async client => {
      for (const item of entries) {
        await queryPostgresClient(client, `
          INSERT INTO bank_directory (code, country, name, provider, is_active, payload, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(code, country, provider) DO UPDATE SET name = excluded.name, is_active = excluded.is_active, payload = excluded.payload, updated_at = excluded.updated_at
        `, [item.code, item.country, item.name, item.provider, item.isActive !== false, null, now, now])
      }
    })
    return getBankDirectory(entries[0]?.country ?? 'NG', entries[0]?.provider)
  }
  const db = getDb()
  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    for (const item of entries) {
      db.prepare(`
        INSERT INTO bank_directory (
          code, country, name, provider, is_active, payload, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code, country, provider) DO UPDATE SET
          name = excluded.name,
          is_active = excluded.is_active,
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `).run(
        item.code,
        item.country,
        item.name,
        item.provider,
        item.isActive === false ? 0 : 1,
        null,
        now,
        now
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getBankDirectory(entries[0]?.country ?? 'NG', entries[0]?.provider)
}

export async function getLatestKycSubmissionByUserId(userId: string): Promise<KycSubmission | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<KycSubmissionRow>('SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId])
    return result.rows[0] ? mapKycSubmissionRow(result.rows[0]) : null
  }
  const row = getDb()
    .prepare('SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(userId) as KycSubmissionRow | undefined
  return row ? mapKycSubmissionRow(row) : null
}

export async function getLatestSensitiveKycIdentityByUserId(userId: string): Promise<{ submissionId: string; documentType: 'bvn' | 'nin'; documentNumber: string } | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<Pick<KycSensitiveIdentityRow, 'submission_id' | 'document_type' | 'encrypted_document_number'>>(`
      SELECT ks.submission_id, ks.document_type, ks.encrypted_document_number FROM kyc_sensitive_identities ks
      INNER JOIN kyc_submissions k ON k.id = ks.submission_id WHERE ks.user_id = ? ORDER BY k.created_at DESC LIMIT 1
    `, [userId])
    const row = result.rows[0]
    return row ? { submissionId: row.submission_id, documentType: row.document_type, documentNumber: decryptSensitiveValue(row.encrypted_document_number) } : null
  }
  const row = getDb().prepare(`
    SELECT ks.submission_id, ks.document_type, ks.encrypted_document_number
    FROM kyc_sensitive_identities ks
    INNER JOIN kyc_submissions k ON k.id = ks.submission_id
    WHERE ks.user_id = ?
    ORDER BY k.created_at DESC
    LIMIT 1
  `).get(userId) as Pick<KycSensitiveIdentityRow, 'submission_id' | 'document_type' | 'encrypted_document_number'> | undefined

  if (!row) return null

  return {
    submissionId: row.submission_id,
    documentType: row.document_type,
    documentNumber: decryptSensitiveValue(row.encrypted_document_number),
  }
}

export async function getKycSubmissionByDocumentUrl(documentUrl: string): Promise<KycSubmission | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<KycSubmissionRow>('SELECT * FROM kyc_submissions WHERE document_url = ? ORDER BY created_at DESC LIMIT 1', [documentUrl])
    return result.rows[0] ? mapKycSubmissionRow(result.rows[0]) : null
  }
  const row = getDb()
    .prepare('SELECT * FROM kyc_submissions WHERE document_url = ? ORDER BY created_at DESC LIMIT 1')
    .get(documentUrl) as KycSubmissionRow | undefined
  return row ? mapKycSubmissionRow(row) : null
}

export async function listKycSubmissions(): Promise<KycSubmission[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<KycSubmissionRow>('SELECT * FROM kyc_submissions ORDER BY created_at DESC')
    return result.rows.map(mapKycSubmissionRow)
  }
  const rows = getDb()
    .prepare('SELECT * FROM kyc_submissions ORDER BY created_at DESC')
    .all() as KycSubmissionRow[]
  return rows.map(mapKycSubmissionRow)
}

export async function createKycSubmission(input: {
  userId: string
  documentType: KycSubmission['documentType']
  documentNumber: string
  documentUrl: string
  documentName?: string
  mimeType?: string
  fileSize?: number
}): Promise<KycSubmission> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    const id = `kyc_${randomBytes(6).toString('hex')}`
    const storedDocumentNumber = (input.documentType === 'bvn' || input.documentType === 'nin') ? maskDocumentNumber(input.documentType, input.documentNumber.trim()) : input.documentNumber.trim()
    await withPostgresTransaction(async client => {
      await queryPostgresClient(client, `
        INSERT INTO kyc_submissions (id, user_id, document_type, document_number, document_url, document_name, mime_type, file_size, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, input.userId, input.documentType, storedDocumentNumber, input.documentUrl.trim(), input.documentName?.trim() || null, input.mimeType?.trim() || null, input.fileSize ?? null, 'pending', now, now])
      if (input.documentType === 'bvn' || input.documentType === 'nin') {
        const encrypted = encryptSensitiveValue(input.documentNumber.trim())
        await queryPostgresClient(client, `INSERT INTO kyc_sensitive_identities (submission_id, user_id, document_type, encrypted_document_number, key_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, input.userId, input.documentType, encrypted.payload, encrypted.keyVersion, now, now])
      }
      await queryPostgresClient(client, 'UPDATE users SET "kycStatus" = ?, tier = ? WHERE id = ?', ['pending', 'basic', input.userId])
    })
    const submission = await getLatestKycSubmissionByUserId(input.userId)
    if (!submission) throw new Error('Unable to create KYC submission')
    await insertAuditLog({ userId: input.userId, actorUserId: input.userId, action: 'kyc.submitted', entityType: 'kyc_submission', entityId: submission.id, metadata: { documentType: submission.documentType, documentName: submission.documentName, documentUrl: submission.documentUrl } })
    return submission
  }
  const db = getDb()
  const now = new Date().toISOString()
  const id = `kyc_${randomBytes(6).toString('hex')}`

  db.exec('BEGIN')
  try {
    const storedDocumentNumber = (input.documentType === 'bvn' || input.documentType === 'nin')
      ? maskDocumentNumber(input.documentType, input.documentNumber.trim())
      : input.documentNumber.trim()
    db.prepare(`
      INSERT INTO kyc_submissions (
        id, user_id, document_type, document_number, document_url, document_name, mime_type, file_size, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.userId,
      input.documentType,
      storedDocumentNumber,
      input.documentUrl.trim(),
      input.documentName?.trim() || null,
      input.mimeType?.trim() || null,
      input.fileSize ?? null,
      'pending',
      now,
      now
    )

    if (input.documentType === 'bvn' || input.documentType === 'nin') {
      const encrypted = encryptSensitiveValue(input.documentNumber.trim())
      db.prepare(`
        INSERT INTO kyc_sensitive_identities (
          submission_id, user_id, document_type, encrypted_document_number, key_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.userId,
        input.documentType,
        encrypted.payload,
        encrypted.keyVersion,
        now,
        now
      )
    }

    db.prepare('UPDATE users SET kycStatus = ?, tier = ? WHERE id = ?')
      .run('pending', 'basic', input.userId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const submission = await getLatestKycSubmissionByUserId(input.userId)
  if (!submission) throw new Error('Unable to create KYC submission')
  await insertAuditLog({
    userId: input.userId,
    actorUserId: input.userId,
    action: 'kyc.submitted',
    entityType: 'kyc_submission',
    entityId: submission.id,
    metadata: {
      documentType: submission.documentType,
      documentName: submission.documentName,
      documentUrl: submission.documentUrl,
    },
  })
  return submission
}

export async function reviewKycSubmission(input: {
  submissionId: string
  reviewerUserId: string
  status: 'approved' | 'rejected'
  notes?: string
}): Promise<KycSubmission | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    const updated = await withPostgresTransaction(async client => {
      const selected = await queryPostgresClient<KycSubmissionRow>(client, 'SELECT * FROM kyc_submissions WHERE id = ? LIMIT 1 FOR UPDATE', [input.submissionId])
      const row = selected.rows[0]
      if (!row) return null
      const result = await queryPostgresClient<KycSubmissionRow>(client, `UPDATE kyc_submissions SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? RETURNING *`, [input.status, input.notes?.trim() || null, input.reviewerUserId, now, now, input.submissionId])
      await queryPostgresClient(client, 'UPDATE users SET "kycStatus" = ?, tier = ? WHERE id = ?', [input.status === 'approved' ? 'verified' : 'rejected', input.status === 'approved' ? 'verified' : 'basic', row.user_id])
      return result.rows[0] ? mapKycSubmissionRow(result.rows[0]) : null
    })
    if (updated) await insertAuditLog({ userId: updated.userId, actorUserId: input.reviewerUserId, action: input.status === 'approved' ? 'kyc.approved' : 'kyc.rejected', entityType: 'kyc_submission', entityId: updated.id, metadata: { notes: input.notes?.trim() || undefined } })
    return updated
  }
  const db = getDb()
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    const row = db
      .prepare('SELECT * FROM kyc_submissions WHERE id = ? LIMIT 1')
      .get(input.submissionId) as KycSubmissionRow | undefined

    if (!row) {
      db.exec('ROLLBACK')
      return null
    }

    db.prepare(`
      UPDATE kyc_submissions
      SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.notes?.trim() || null,
      input.reviewerUserId,
      now,
      now,
      input.submissionId
    )

    db.prepare('UPDATE users SET kycStatus = ?, tier = ? WHERE id = ?')
      .run(
        input.status === 'approved' ? 'verified' : 'rejected',
        input.status === 'approved' ? 'verified' : 'basic',
        row.user_id
      )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const updated = db
    .prepare('SELECT * FROM kyc_submissions WHERE id = ? LIMIT 1')
    .get(input.submissionId) as KycSubmissionRow | undefined
  const submission = updated ? mapKycSubmissionRow(updated) : null
  if (submission) {
    await insertAuditLog({
      userId: submission.userId,
      actorUserId: input.reviewerUserId,
      action: input.status === 'approved' ? 'kyc.approved' : 'kyc.rejected',
      entityType: 'kyc_submission',
      entityId: submission.id,
      metadata: {
        notes: input.notes?.trim() || undefined,
      },
    })
  }

  return submission
}

export async function upsertNetworkProviders(providers: NetworkProvider[]) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await withPostgresTransaction(async client => {
      for (const provider of providers) {
        await queryPostgresClient(client, `INSERT INTO network_providers (name, icon, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET icon = excluded.icon, updated_at = excluded.updated_at`, [provider.name, resolveNetworkProviderIcon(provider.name, provider.icon), now, now])
      }
    })
    return getNetworkProviders()
  }
  const db = getDb()
  const now = new Date().toISOString()
  const statement = db.prepare(`
    INSERT INTO network_providers (name, icon, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      icon = excluded.icon,
      updated_at = excluded.updated_at
  `)

  db.exec('BEGIN')
  try {
    for (const provider of providers) {
      statement.run(provider.name, resolveNetworkProviderIcon(provider.name, provider.icon), now, now)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return getNetworkProviders()
}

export async function upsertCryptoAssets(assets: CryptoAsset[]) {
  await ensureDbReady()
  if (isPostgresEnabled()) return upsertCryptoAssetsPostgres(assets)
  const db = getDb()
  const now = new Date().toISOString()
  const statement = db.prepare(`
    INSERT INTO crypto_pairs (
      id, symbol, name, network, icon, market_source_id, market_price_source, market_price_usd, market_price_updated_at, market_rate, buy_rate, sell_rate, buy_spread_bps, sell_spread_bps, buy_margin_ngn_per_usd, sell_margin_ngn_per_usd, buy_network_fee_ngn, sell_network_fee_ngn, quote_ttl_seconds, is_active, base_execution_enabled, execution_rail, routed_to_chain, routed_to_token, routed_decimals, routed_address_family, minimum_buy_ngn, max_quote_drift_percent, change_24h, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      symbol = excluded.symbol,
      network = excluded.network,
      icon = excluded.icon,
      market_source_id = excluded.market_source_id,
      market_price_source = excluded.market_price_source,
      market_price_usd = excluded.market_price_usd,
      market_price_updated_at = excluded.market_price_updated_at,
      market_rate = excluded.market_rate,
      buy_rate = excluded.buy_rate,
      sell_rate = excluded.sell_rate,
      buy_margin_ngn_per_usd = excluded.buy_margin_ngn_per_usd,
      sell_margin_ngn_per_usd = excluded.sell_margin_ngn_per_usd,
      buy_network_fee_ngn = excluded.buy_network_fee_ngn,
      sell_network_fee_ngn = excluded.sell_network_fee_ngn,
      quote_ttl_seconds = excluded.quote_ttl_seconds,
      is_active = excluded.is_active,
      base_execution_enabled = excluded.base_execution_enabled,
      execution_rail = excluded.execution_rail,
      routed_to_chain = excluded.routed_to_chain,
      routed_to_token = excluded.routed_to_token,
      routed_decimals = excluded.routed_decimals,
      routed_address_family = excluded.routed_address_family,
      minimum_buy_ngn = excluded.minimum_buy_ngn,
      max_quote_drift_percent = excluded.max_quote_drift_percent,
      change_24h = excluded.change_24h,
      updated_at = excluded.updated_at
  `)

  db.exec('BEGIN')
  try {
    for (const asset of assets) {
      const marketSourceId = asset.marketSourceId?.trim() || getDefaultCryptoMarketSourceId(asset.symbol)
      const marketRate = Number.isFinite(asset.marketRate) && asset.marketRate > 0 ? asset.marketRate : 0
      const marketPriceUsd = Number.isFinite(asset.marketPriceUsd) && (asset.marketPriceUsd ?? 0) > 0
        ? Number(asset.marketPriceUsd)
        : 0
      const buyMargin = Number.isFinite(asset.buyMarginNgnPerUsd)
        ? Math.max(0, asset.buyMarginNgnPerUsd)
        : DEFAULT_USD_MARGIN_NGN
      const sellMargin = Number.isFinite(asset.sellMarginNgnPerUsd)
        ? Math.max(0, asset.sellMarginNgnPerUsd)
        : DEFAULT_USD_MARGIN_NGN
      const buyRate = marketRate > 0 ? computeBuyRate(marketPriceUsd, marketRate, buyMargin) : 0
      const sellRate = marketRate > 0 ? computeSellRate(marketPriceUsd, marketRate, sellMargin) : 0
      const buyNetworkFeeNgn = asset.buyNetworkFeeNgn != null && Number.isFinite(asset.buyNetworkFeeNgn)
        ? Math.max(0, asset.buyNetworkFeeNgn)
        : getDefaultNetworkFeeNgn(asset.network, 'buy', asset.id)
      // Retain the column for backwards-compatible data, but sell/deposit fees are no longer supported.
      const sellNetworkFeeNgn = 0
      const executionRail = asset.executionRail ?? getConfigurableAssetExecutionRail(asset)
      assertSupportedAssetExecutionRail(asset, executionRail)
      const routedConfig = executionRail === 'routed_treasury'
        ? getRoutedTreasuryPairConfigForAsset({
            ...asset,
            executionRail,
          })
        : null
      statement.run(
        asset.id,
        asset.symbol,
        asset.name,
        asset.network,
        asset.icon,
        marketSourceId,
        asset.marketSnapshotSource ?? asset.pricingSource ?? 'seed',
        asset.marketPriceUsd ?? null,
        asset.marketPriceUpdatedAt ?? null,
        marketRate,
        buyRate,
        sellRate,
        buyMargin,
        sellMargin,
        buyNetworkFeeNgn,
        sellNetworkFeeNgn,
        asset.quoteTtlSeconds,
        asset.isActive === false ? 0 : 1,
        asset.baseExecutionEnabled === true ? 1 : 0,
        executionRail ?? null,
        routedConfig?.toChain ?? null,
        routedConfig?.toToken ?? null,
        routedConfig?.decimals ?? null,
        routedConfig?.addressFamily ?? null,
        routedConfig?.minimumBuyNgn ?? null,
        routedConfig?.maxQuoteDriftPercent ?? null,
        asset.change24h,
        now,
        now
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return getCryptoAssets()
}

async function upsertCryptoAssetsPostgres(assets: CryptoAsset[]) {
  const now = new Date().toISOString()
  const sql = `
    INSERT INTO crypto_pairs (
      id, symbol, name, network, icon, market_source_id, market_price_source, market_price_usd, market_price_updated_at, market_rate, buy_rate, sell_rate, buy_spread_bps, sell_spread_bps, buy_margin_ngn_per_usd, sell_margin_ngn_per_usd, buy_network_fee_ngn, sell_network_fee_ngn, quote_ttl_seconds, is_active, base_execution_enabled, execution_rail, routed_to_chain, routed_to_token, routed_decimals, routed_address_family, minimum_buy_ngn, max_quote_drift_percent, change_24h, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, symbol = excluded.symbol, network = excluded.network, icon = excluded.icon,
      market_source_id = excluded.market_source_id, market_price_source = excluded.market_price_source,
      market_price_usd = excluded.market_price_usd, market_price_updated_at = excluded.market_price_updated_at,
      market_rate = excluded.market_rate, buy_rate = excluded.buy_rate, sell_rate = excluded.sell_rate,
      buy_spread_bps = excluded.buy_spread_bps, sell_spread_bps = excluded.sell_spread_bps,
      buy_margin_ngn_per_usd = excluded.buy_margin_ngn_per_usd, sell_margin_ngn_per_usd = excluded.sell_margin_ngn_per_usd,
      buy_network_fee_ngn = excluded.buy_network_fee_ngn, sell_network_fee_ngn = excluded.sell_network_fee_ngn,
      quote_ttl_seconds = excluded.quote_ttl_seconds, is_active = excluded.is_active,
      base_execution_enabled = excluded.base_execution_enabled, execution_rail = excluded.execution_rail,
      routed_to_chain = excluded.routed_to_chain, routed_to_token = excluded.routed_to_token,
      routed_decimals = excluded.routed_decimals, routed_address_family = excluded.routed_address_family,
      minimum_buy_ngn = excluded.minimum_buy_ngn, max_quote_drift_percent = excluded.max_quote_drift_percent,
      change_24h = excluded.change_24h, updated_at = excluded.updated_at
  `
  await withPostgresTransaction(async client => {
    for (const asset of assets) {
      const marketSourceId = asset.marketSourceId?.trim() || getDefaultCryptoMarketSourceId(asset.symbol)
      const marketRate = Number.isFinite(asset.marketRate) && asset.marketRate > 0 ? asset.marketRate : 0
      const marketPriceUsd = Number.isFinite(asset.marketPriceUsd) && (asset.marketPriceUsd ?? 0) > 0 ? Number(asset.marketPriceUsd) : 0
      const buyMargin = Number.isFinite(asset.buyMarginNgnPerUsd) ? Math.max(0, asset.buyMarginNgnPerUsd) : DEFAULT_USD_MARGIN_NGN
      const sellMargin = Number.isFinite(asset.sellMarginNgnPerUsd) ? Math.max(0, asset.sellMarginNgnPerUsd) : DEFAULT_USD_MARGIN_NGN
      const buyNetworkFeeNgn = asset.buyNetworkFeeNgn != null && Number.isFinite(asset.buyNetworkFeeNgn)
        ? Math.max(0, asset.buyNetworkFeeNgn) : getDefaultNetworkFeeNgn(asset.network, 'buy', asset.id)
      const executionRail = asset.executionRail ?? getConfigurableAssetExecutionRail(asset)
      assertSupportedAssetExecutionRail(asset, executionRail)
      const routedConfig = executionRail === 'routed_treasury'
        ? getRoutedTreasuryPairConfigForAsset({ ...asset, executionRail }) : null
      await queryPostgresClient(client, sql, [
        asset.id, asset.symbol, asset.name, asset.network, asset.icon, marketSourceId,
        asset.marketSnapshotSource ?? asset.pricingSource ?? 'seed', asset.marketPriceUsd ?? null,
        asset.marketPriceUpdatedAt ?? null, marketRate,
        marketRate > 0 ? computeBuyRate(marketPriceUsd, marketRate, buyMargin) : 0,
        marketRate > 0 ? computeSellRate(marketPriceUsd, marketRate, sellMargin) : 0,
        0, 0, buyMargin, sellMargin, buyNetworkFeeNgn, 0, asset.quoteTtlSeconds,
        asset.isActive !== false, asset.baseExecutionEnabled === true, executionRail ?? null,
        routedConfig?.toChain ?? null, routedConfig?.toToken ?? null, routedConfig?.decimals ?? null,
        routedConfig?.addressFamily ?? null, routedConfig?.minimumBuyNgn ?? null,
        routedConfig?.maxQuoteDriftPercent ?? null, asset.change24h, now, now,
      ])
    }
  })
  return getCryptoAssets()
}

export async function getSecuritySettingsByUserId(userId: string): Promise<SecuritySettingsRecord | null> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<SecuritySettingsRow>('SELECT * FROM security_settings WHERE user_id = ? LIMIT 1', [userId])
    const row = result.rows[0]
    if (!row) return null
    const [summary, latest] = await Promise.all([
      queryPostgres<{ count: string; last_used_at: string | null }>('SELECT COUNT(*) AS count, MAX(last_used_at) AS last_used_at FROM biometric_credentials WHERE user_id = ?', [userId]),
      queryPostgres<{ label: string | null }>('SELECT label FROM biometric_credentials WHERE user_id = ? ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT 1', [userId]),
    ])
    const count = Number(summary.rows[0]?.count ?? 0)
    return { ...mapSecuritySettingsRow(row), hasBiometricCredential: count > 0, biometricCredentialCount: count, biometricCredentialLabel: latest.rows[0]?.label ?? undefined, biometricLastVerifiedAt: summary.rows[0]?.last_used_at ?? undefined }
  }
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM security_settings WHERE user_id = ? LIMIT 1')
    .get(userId) as SecuritySettingsRow | undefined
  if (!row) return null

  const base = mapSecuritySettingsRow(row)
  const summary = db.prepare(`
    SELECT COUNT(*) AS count, MAX(last_used_at) AS last_used_at
    FROM biometric_credentials
    WHERE user_id = ?
  `).get(userId) as { count?: number; last_used_at?: string | null } | undefined
  const latestCredential = db.prepare(`
    SELECT label
    FROM biometric_credentials
    WHERE user_id = ?
    ORDER BY COALESCE(last_used_at, created_at) DESC
    LIMIT 1
  `).get(userId) as { label?: string | null } | undefined

  return {
    ...base,
    hasBiometricCredential: Number(summary?.count ?? 0) > 0,
    biometricCredentialCount: Number(summary?.count ?? 0),
    biometricCredentialLabel: latestCredential?.label ?? undefined,
    biometricLastVerifiedAt: summary?.last_used_at ?? undefined,
  }
}

function cleanupExpiredWebAuthnArtifacts(db: DatabaseSync) {
  const now = new Date().toISOString()
  db.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ? OR used_at IS NOT NULL').run(now)
  db.prepare('DELETE FROM biometric_approvals WHERE expires_at <= ? OR used_at IS NOT NULL').run(now)
}

export async function getBiometricCredentialsByUserId(userId: string): Promise<BiometricCredentialRecord[]> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await Promise.all([
      queryPostgres('DELETE FROM webauthn_challenges WHERE expires_at <= ? OR used_at IS NOT NULL', [now]),
      queryPostgres('DELETE FROM biometric_approvals WHERE expires_at <= ? OR used_at IS NOT NULL', [now]),
    ])
    const result = await queryPostgres<BiometricCredentialRow>('SELECT * FROM biometric_credentials WHERE user_id = ? ORDER BY COALESCE(last_used_at, created_at) DESC', [userId])
    return result.rows.map(mapBiometricCredentialRow)
  }
  const db = getDb()
  cleanupExpiredWebAuthnArtifacts(db)
  const rows = db.prepare(`
    SELECT *
    FROM biometric_credentials
    WHERE user_id = ?
    ORDER BY COALESCE(last_used_at, created_at) DESC
  `).all(userId) as BiometricCredentialRow[]
  return rows.map(mapBiometricCredentialRow)
}

export async function saveWebAuthnChallenge(input: {
  userId: string
  purpose: string
  challenge: string
  rpId: string
  origin: string
}) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MINUTES * 60_000).toISOString()
    await withPostgresTransaction(async client => {
      await queryPostgresClient(client, 'DELETE FROM webauthn_challenges WHERE expires_at <= ? OR used_at IS NOT NULL', [now])
      await queryPostgresClient(client, 'UPDATE webauthn_challenges SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [now, input.userId, input.purpose])
      await queryPostgresClient(client, 'INSERT INTO webauthn_challenges (id, user_id, purpose, challenge, rp_id, origin, expires_at, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)', [`wch_${randomBytes(6).toString('hex')}`, input.userId, input.purpose, input.challenge, input.rpId, input.origin, expiresAt, now])
    })
    return
  }
  const db = getDb()
  cleanupExpiredWebAuthnArtifacts(db)
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MINUTES * 60_000).toISOString()
  db.prepare('UPDATE webauthn_challenges SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(now, input.userId, input.purpose)
  db.prepare(`
    INSERT INTO webauthn_challenges (id, user_id, purpose, challenge, rp_id, origin, expires_at, created_at, used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    `wch_${randomBytes(6).toString('hex')}`,
    input.userId,
    input.purpose,
    input.challenge,
    input.rpId,
    input.origin,
    expiresAt,
    now
  )
}

export async function consumeWebAuthnChallenge(userId: string, purpose: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) return withPostgresTransaction(async client => {
    const now = new Date().toISOString()
    await queryPostgresClient(client, 'DELETE FROM webauthn_challenges WHERE expires_at <= ? OR used_at IS NOT NULL', [now])
    const result = await queryPostgresClient<WebAuthnChallengeRow>(client, 'SELECT * FROM webauthn_challenges WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [userId, purpose])
    const row = result.rows[0]
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) throw new Error('Biometric challenge expired. Try again.')
    await queryPostgresClient(client, 'UPDATE webauthn_challenges SET used_at = ? WHERE id = ?', [now, row.id])
    return row
  })
  const db = getDb()
  cleanupExpiredWebAuthnArtifacts(db)
  const row = db.prepare(`
    SELECT *
    FROM webauthn_challenges
    WHERE user_id = ? AND purpose = ? AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, purpose) as WebAuthnChallengeRow | undefined
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new Error('Biometric challenge expired. Try again.')
  }
  db.prepare('UPDATE webauthn_challenges SET used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)
  return row
}

export async function saveBiometricCredential(input: {
  userId: string
  credentialId: string
  publicKey: string
  counter: number
  transports?: string[]
  deviceType?: string
  backedUp?: boolean
  label?: string
}) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres(`INSERT INTO biometric_credentials (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(credential_id) DO UPDATE SET public_key = excluded.public_key, counter = excluded.counter, transports = excluded.transports, device_type = excluded.device_type, backed_up = excluded.backed_up, label = excluded.label`, [`bio_${randomBytes(6).toString('hex')}`, input.userId, input.credentialId, input.publicKey, Number(input.counter ?? 0), input.transports?.length ? JSON.stringify(input.transports) : null, input.deviceType ?? null, input.backedUp === true, input.label ?? null, new Date().toISOString()])
    return
  }
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO biometric_credentials (
      id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(credential_id) DO UPDATE SET
      public_key = excluded.public_key,
      counter = excluded.counter,
      transports = excluded.transports,
      device_type = excluded.device_type,
      backed_up = excluded.backed_up,
      label = excluded.label
  `).run(
    `bio_${randomBytes(6).toString('hex')}`,
    input.userId,
    input.credentialId,
    input.publicKey,
    Number(input.counter ?? 0),
    input.transports?.length ? JSON.stringify(input.transports) : null,
    input.deviceType ?? null,
    input.backedUp ? 1 : 0,
    input.label ?? null,
    now
  )
}

export async function getBiometricCredentialByCredentialId(credentialId: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres<BiometricCredentialRow>('SELECT * FROM biometric_credentials WHERE credential_id = ? LIMIT 1', [credentialId])
    return result.rows[0] ? mapBiometricCredentialRow(result.rows[0]) : null
  }
  const row = getDb().prepare('SELECT * FROM biometric_credentials WHERE credential_id = ? LIMIT 1').get(credentialId) as BiometricCredentialRow | undefined
  return row ? mapBiometricCredentialRow(row) : null
}

export async function touchBiometricCredential(credentialId: string, counter: number) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE biometric_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?', [counter, new Date().toISOString(), credentialId])
    return
  }
  getDb().prepare(`
    UPDATE biometric_credentials
    SET counter = ?, last_used_at = ?
    WHERE credential_id = ?
  `).run(counter, new Date().toISOString(), credentialId)
}

export async function removeBiometricCredential(userId: string, credentialId: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const result = await queryPostgres('DELETE FROM biometric_credentials WHERE user_id = ? AND credential_id = ?', [userId, credentialId])
    if (!(result.rowCount ?? 0)) throw new Error('Biometric credential not found.')
    return
  }
  const db = getDb()
  const result = db.prepare('DELETE FROM biometric_credentials WHERE user_id = ? AND credential_id = ?').run(userId, credentialId) as { changes?: number }
  if (!Number(result.changes ?? 0)) {
    throw new Error('Biometric credential not found.')
  }
}

export async function createBiometricApproval(userId: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const token = `bioap_${randomBytes(24).toString('hex')}`
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + BIOMETRIC_APPROVAL_TTL_MINUTES * 60_000).toISOString()
    await withPostgresTransaction(async client => {
      await queryPostgresClient(client, 'DELETE FROM biometric_approvals WHERE expires_at <= ? OR used_at IS NOT NULL', [now])
      await queryPostgresClient(client, 'INSERT INTO biometric_approvals (token, user_id, expires_at, created_at, used_at) VALUES (?, ?, ?, ?, NULL)', [token, userId, expiresAt, now])
    })
    return { token, expiresAt }
  }
  const db = getDb()
  cleanupExpiredWebAuthnArtifacts(db)
  const token = `bioap_${randomBytes(24).toString('hex')}`
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + BIOMETRIC_APPROVAL_TTL_MINUTES * 60_000).toISOString()
  db.prepare(`
    INSERT INTO biometric_approvals (token, user_id, expires_at, created_at, used_at)
    VALUES (?, ?, ?, ?, NULL)
  `).run(token, userId, expiresAt, now)
  return { token, expiresAt }
}

export async function consumeBiometricApproval(userId: string, token: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await withPostgresTransaction(async client => {
      const now = new Date().toISOString()
      await queryPostgresClient(client, 'DELETE FROM biometric_approvals WHERE expires_at <= ? OR used_at IS NOT NULL', [now])
      const result = await queryPostgresClient<BiometricApprovalRow>(client, 'SELECT * FROM biometric_approvals WHERE token = ? AND user_id = ? LIMIT 1 FOR UPDATE', [token, userId])
      const row = result.rows[0]
      if (!row || row.used_at) throw new Error('Biometric approval is invalid or already used.')
      if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error('Biometric approval expired. Try again.')
      await queryPostgresClient(client, 'UPDATE biometric_approvals SET used_at = ? WHERE token = ?', [now, token])
    })
    return
  }
  const db = getDb()
  cleanupExpiredWebAuthnArtifacts(db)
  const row = db.prepare('SELECT * FROM biometric_approvals WHERE token = ? AND user_id = ? LIMIT 1').get(token, userId) as BiometricApprovalRow | undefined
  if (!row || row.used_at) {
    throw new Error('Biometric approval is invalid or already used.')
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new Error('Biometric approval expired. Try again.')
  }
  db.prepare('UPDATE biometric_approvals SET used_at = ? WHERE token = ?').run(new Date().toISOString(), token)
}

export async function upsertSecuritySettings(
  userId: string,
  updates: Partial<Pick<SecuritySettingsRecord, 'transactionPinEnabled' | 'twoFactorEnabled' | 'biometricEnabled'>>
): Promise<SecuritySettingsRecord> {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await withPostgresTransaction(async client => {
      const selected = await queryPostgresClient<SecuritySettingsRow>(client, 'SELECT * FROM security_settings WHERE user_id = ? LIMIT 1 FOR UPDATE', [userId])
      const row = selected.rows[0]
      const existing = row ? mapSecuritySettingsRow(row) : null
      const count = await queryPostgresClient<{ count: string }>(client, 'SELECT COUNT(*) AS count FROM biometric_credentials WHERE user_id = ?', [userId])
      const hasPin = Boolean(row?.transaction_pin_hash && row?.transaction_pin_salt)
      const credentialCount = Number(count.rows[0]?.count ?? 0)
      const next = {
        transactionPinEnabled: hasPin ? (typeof updates.transactionPinEnabled === 'boolean' ? updates.transactionPinEnabled : existing?.transactionPinEnabled ?? false) : false,
        twoFactorEnabled: updates.twoFactorEnabled ?? existing?.twoFactorEnabled ?? false,
        biometricEnabled: credentialCount > 0 ? (updates.biometricEnabled ?? existing?.biometricEnabled ?? true) : false,
      }
      await queryPostgresClient(client, `
        INSERT INTO security_settings (user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET transaction_pin_enabled = excluded.transaction_pin_enabled, two_factor_enabled = excluded.two_factor_enabled, biometric_enabled = excluded.biometric_enabled, updated_at = excluded.updated_at
      `, [userId, next.transactionPinEnabled, row?.transaction_pin_hash ?? null, row?.transaction_pin_salt ?? null, Number(row?.transaction_pin_failed_attempts ?? 0), row?.transaction_pin_locked_until ?? null, next.twoFactorEnabled, next.biometricEnabled, existing?.createdAt ?? now, now])
    })
    const record = await getSecuritySettingsByUserId(userId)
    if (!record) throw new Error('Unable to persist security settings')
    return record
  }
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM security_settings WHERE user_id = ? LIMIT 1')
    .get(userId) as SecuritySettingsRow | undefined
  const existing = row ? mapSecuritySettingsRow(row) : null
  const now = new Date().toISOString()
  const hasTransactionPin = Boolean(row?.transaction_pin_hash && row?.transaction_pin_salt)
  const biometricCredentialCount = Number((db.prepare('SELECT COUNT(*) AS count FROM biometric_credentials WHERE user_id = ?').get(userId) as { count?: number } | undefined)?.count ?? 0)
  const requestedPinEnabled = typeof updates.transactionPinEnabled === 'boolean'
    ? updates.transactionPinEnabled
    : existing?.transactionPinEnabled ?? false
  const next = {
    transactionPinEnabled: hasTransactionPin ? requestedPinEnabled : false,
    twoFactorEnabled: updates.twoFactorEnabled ?? existing?.twoFactorEnabled ?? false,
    biometricEnabled: biometricCredentialCount > 0
      ? (updates.biometricEnabled ?? existing?.biometricEnabled ?? true)
      : false,
  }

  db.prepare(`
    INSERT INTO security_settings (
      user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      transaction_pin_enabled = excluded.transaction_pin_enabled,
      two_factor_enabled = excluded.two_factor_enabled,
      biometric_enabled = excluded.biometric_enabled,
      updated_at = excluded.updated_at
  `).run(
    userId,
    next.transactionPinEnabled ? 1 : 0,
    row?.transaction_pin_hash ?? null,
    row?.transaction_pin_salt ?? null,
    Number(row?.transaction_pin_failed_attempts ?? 0),
    row?.transaction_pin_locked_until ?? null,
    next.twoFactorEnabled ? 1 : 0,
    next.biometricEnabled ? 1 : 0,
    existing?.createdAt ?? now,
    now
  )

  const record = await getSecuritySettingsByUserId(userId)
  if (!record) throw new Error('Unable to persist security settings')
  return record
}

export async function upsertTransactionPin(userId: string, nextPin: string, currentPin?: string) {
  await ensureDbReady()
  assertValidTransactionPin(nextPin)
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await withPostgresTransaction(async client => {
      const selected = await queryPostgresClient<SecuritySettingsRow>(client, 'SELECT * FROM security_settings WHERE user_id = ? LIMIT 1 FOR UPDATE', [userId])
      const row = selected.rows[0]
      if (row?.transaction_pin_hash && row.transaction_pin_salt) {
        if (!currentPin) throw new Error('Current transaction PIN is required.')
        assertValidTransactionPin(currentPin)
        if (hashTransactionPin(currentPin, row.transaction_pin_salt) !== row.transaction_pin_hash) throw new Error('Current transaction PIN is incorrect.')
      }
      const pin = createTransactionPinRecord(nextPin)
      await queryPostgresClient(client, `INSERT INTO security_settings (user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET transaction_pin_enabled = excluded.transaction_pin_enabled, transaction_pin_hash = excluded.transaction_pin_hash, transaction_pin_salt = excluded.transaction_pin_salt, transaction_pin_failed_attempts = excluded.transaction_pin_failed_attempts, transaction_pin_locked_until = excluded.transaction_pin_locked_until, updated_at = excluded.updated_at`, [userId, true, pin.transactionPinHash, pin.transactionPinSalt, 0, null, row?.two_factor_enabled ?? false, row?.biometric_enabled ?? true, row?.created_at ?? now, now])
    })
    const record = await getSecuritySettingsByUserId(userId)
    if (!record) throw new Error('Unable to save transaction PIN.')
    return record
  }
  const db = getDb()
  const row = db.prepare('SELECT * FROM security_settings WHERE user_id = ? LIMIT 1').get(userId) as SecuritySettingsRow | undefined
  const now = new Date().toISOString()

  if (row?.transaction_pin_hash && row?.transaction_pin_salt) {
    if (!currentPin) {
      throw new Error('Current transaction PIN is required.')
    }
    assertValidTransactionPin(currentPin)
    const currentHash = hashTransactionPin(currentPin, row.transaction_pin_salt)
    if (currentHash !== row.transaction_pin_hash) {
      throw new Error('Current transaction PIN is incorrect.')
    }
  }

  const { transactionPinHash, transactionPinSalt } = createTransactionPinRecord(nextPin)
  db.prepare(`
    INSERT INTO security_settings (
      user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      transaction_pin_enabled = excluded.transaction_pin_enabled,
      transaction_pin_hash = excluded.transaction_pin_hash,
      transaction_pin_salt = excluded.transaction_pin_salt,
      transaction_pin_failed_attempts = excluded.transaction_pin_failed_attempts,
      transaction_pin_locked_until = excluded.transaction_pin_locked_until,
      updated_at = excluded.updated_at
  `).run(
    userId,
    1,
    transactionPinHash,
    transactionPinSalt,
    0,
    null,
    row?.two_factor_enabled ?? 0,
    row?.biometric_enabled ?? 1,
    row?.created_at ?? now,
    now
  )

  const record = await getSecuritySettingsByUserId(userId)
  if (!record) throw new Error('Unable to save transaction PIN.')
  return record
}

export async function resetTransactionPin(userId: string, nextPin: string) {
  await ensureDbReady()
  assertValidTransactionPin(nextPin)
  if (isPostgresEnabled()) {
    const now = new Date().toISOString()
    await withPostgresTransaction(async client => {
      const selected = await queryPostgresClient<SecuritySettingsRow>(client, 'SELECT * FROM security_settings WHERE user_id = ? LIMIT 1 FOR UPDATE', [userId])
      const row = selected.rows[0]
      const pin = createTransactionPinRecord(nextPin)
      await queryPostgresClient(client, `INSERT INTO security_settings (user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET transaction_pin_enabled = excluded.transaction_pin_enabled, transaction_pin_hash = excluded.transaction_pin_hash, transaction_pin_salt = excluded.transaction_pin_salt, transaction_pin_failed_attempts = excluded.transaction_pin_failed_attempts, transaction_pin_locked_until = excluded.transaction_pin_locked_until, updated_at = excluded.updated_at`, [userId, true, pin.transactionPinHash, pin.transactionPinSalt, 0, null, row?.two_factor_enabled ?? false, row?.biometric_enabled ?? true, row?.created_at ?? now, now])
    })
    const record = await getSecuritySettingsByUserId(userId)
    if (!record) throw new Error('Unable to reset transaction PIN.')
    return record
  }
  const db = getDb()
  const row = db.prepare('SELECT * FROM security_settings WHERE user_id = ? LIMIT 1').get(userId) as SecuritySettingsRow | undefined
  const now = new Date().toISOString()
  const { transactionPinHash, transactionPinSalt } = createTransactionPinRecord(nextPin)

  db.prepare(`
    INSERT INTO security_settings (
      user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      transaction_pin_enabled = excluded.transaction_pin_enabled,
      transaction_pin_hash = excluded.transaction_pin_hash,
      transaction_pin_salt = excluded.transaction_pin_salt,
      transaction_pin_failed_attempts = excluded.transaction_pin_failed_attempts,
      transaction_pin_locked_until = excluded.transaction_pin_locked_until,
      updated_at = excluded.updated_at
  `).run(
    userId,
    1,
    transactionPinHash,
    transactionPinSalt,
    0,
    null,
    row?.two_factor_enabled ?? 0,
    row?.biometric_enabled ?? 1,
    row?.created_at ?? now,
    now
  )

  const record = await getSecuritySettingsByUserId(userId)
  if (!record) throw new Error('Unable to reset transaction PIN.')
  return record
}

export async function disableTransactionPin(userId: string, currentPin: string) {
  await ensureDbReady()
  assertValidTransactionPin(currentPin)
  if (isPostgresEnabled()) {
    const current = await queryPostgres<SecuritySettingsRow>('SELECT * FROM security_settings WHERE user_id = ? LIMIT 1', [userId])
    const row = current.rows[0]
    if (!row?.transaction_pin_hash || !row.transaction_pin_salt) throw new Error('Transaction PIN is not set.')
    if (hashTransactionPin(currentPin, row.transaction_pin_salt) !== row.transaction_pin_hash) throw new Error('Current transaction PIN is incorrect.')
    await queryPostgres('UPDATE security_settings SET transaction_pin_enabled = ?, transaction_pin_hash = NULL, transaction_pin_salt = NULL, transaction_pin_failed_attempts = ?, transaction_pin_locked_until = NULL, updated_at = ? WHERE user_id = ?', [false, 0, new Date().toISOString(), userId])
    const record = await getSecuritySettingsByUserId(userId)
    if (!record) throw new Error('Unable to update transaction PIN.')
    return record
  }
  const db = getDb()
  const row = db.prepare('SELECT * FROM security_settings WHERE user_id = ? LIMIT 1').get(userId) as SecuritySettingsRow | undefined
  if (!row?.transaction_pin_hash || !row.transaction_pin_salt) {
    throw new Error('Transaction PIN is not set.')
  }

  const currentHash = hashTransactionPin(currentPin, row.transaction_pin_salt)
  if (currentHash !== row.transaction_pin_hash) {
    throw new Error('Current transaction PIN is incorrect.')
  }

  db.prepare(`
    UPDATE security_settings
    SET transaction_pin_enabled = 0,
        transaction_pin_hash = NULL,
        transaction_pin_salt = NULL,
        transaction_pin_failed_attempts = 0,
        transaction_pin_locked_until = NULL,
        updated_at = ?
    WHERE user_id = ?
  `).run(new Date().toISOString(), userId)

  const record = await getSecuritySettingsByUserId(userId)
  if (!record) throw new Error('Unable to update transaction PIN.')
  return record
}

export async function verifyTransactionPinForUser(userId: string, pin: string) {
  await ensureDbReady()
  assertValidTransactionPin(pin)
  if (isPostgresEnabled()) return withPostgresTransaction(async client => {
    const selected = await queryPostgresClient<SecuritySettingsRow>(client, 'SELECT * FROM security_settings WHERE user_id = ? LIMIT 1 FOR UPDATE', [userId])
    const row = selected.rows[0]
    if (!row?.transaction_pin_hash || !row.transaction_pin_salt) throw new Error('Set up a transaction PIN before continuing.')
    if (row.transaction_pin_locked_until && new Date(row.transaction_pin_locked_until).getTime() > Date.now()) throw new Error(`Transaction PIN is temporarily locked until ${new Date(row.transaction_pin_locked_until).toLocaleString('en-NG')}.`)
    const now = new Date().toISOString()
    if (hashTransactionPin(pin, row.transaction_pin_salt) !== row.transaction_pin_hash) {
      const failedAttempts = Number(row.transaction_pin_failed_attempts ?? 0) + 1
      const lockedUntil = failedAttempts >= TRANSACTION_PIN_MAX_FAILED_ATTEMPTS ? new Date(Date.now() + TRANSACTION_PIN_LOCK_MINUTES * 60_000).toISOString() : null
      await queryPostgresClient(client, 'UPDATE security_settings SET transaction_pin_failed_attempts = ?, transaction_pin_locked_until = ?, updated_at = ? WHERE user_id = ?', [failedAttempts, lockedUntil, now, userId])
      if (lockedUntil) throw new Error(`Too many failed PIN attempts. Try again after ${new Date(lockedUntil).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}.`)
      throw new Error('Transaction PIN is incorrect.')
    }
    const updated = await queryPostgresClient<SecuritySettingsRow>(client, 'UPDATE security_settings SET transaction_pin_failed_attempts = ?, transaction_pin_locked_until = NULL, transaction_pin_enabled = ?, updated_at = ? WHERE user_id = ? RETURNING *', [0, true, now, userId])
    if (!updated.rows[0]) throw new Error('Unable to validate transaction PIN.')
    return mapSecuritySettingsRow(updated.rows[0])
  })
  const db = getDb()
  const row = db.prepare('SELECT * FROM security_settings WHERE user_id = ? LIMIT 1').get(userId) as SecuritySettingsRow | undefined
  if (!row?.transaction_pin_hash || !row.transaction_pin_salt) {
    throw new Error('Set up a transaction PIN before continuing.')
  }

  if (row.transaction_pin_locked_until && new Date(row.transaction_pin_locked_until).getTime() > Date.now()) {
    throw new Error(`Transaction PIN is temporarily locked until ${new Date(row.transaction_pin_locked_until).toLocaleString('en-NG')}.`)
  }

  const nextHash = hashTransactionPin(pin, row.transaction_pin_salt)
  if (nextHash !== row.transaction_pin_hash) {
    const failedAttempts = Number(row.transaction_pin_failed_attempts ?? 0) + 1
    const lockedUntil = failedAttempts >= TRANSACTION_PIN_MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + TRANSACTION_PIN_LOCK_MINUTES * 60_000).toISOString()
      : null

    db.prepare(`
      UPDATE security_settings
      SET transaction_pin_failed_attempts = ?,
          transaction_pin_locked_until = ?,
          updated_at = ?
      WHERE user_id = ?
    `).run(failedAttempts, lockedUntil, new Date().toISOString(), userId)

    if (lockedUntil) {
      throw new Error(`Too many failed PIN attempts. Try again after ${new Date(lockedUntil).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}.`)
    }
    throw new Error('Transaction PIN is incorrect.')
  }

  db.prepare(`
    UPDATE security_settings
    SET transaction_pin_failed_attempts = 0,
        transaction_pin_locked_until = NULL,
        transaction_pin_enabled = 1,
        updated_at = ?
    WHERE user_id = ?
  `).run(new Date().toISOString(), userId)

  const record = await getSecuritySettingsByUserId(userId)
  if (!record) throw new Error('Unable to validate transaction PIN.')
  return record
}

export async function verifySensitiveActionAuthorization(
  userId: string,
  input: {
    transactionPin?: string
    biometricApprovalToken?: string
    /** Device already verified fingerprint/face in the native app; session cookie still required. */
    confirmWithBiometric?: boolean
  }
) {
  const transactionPin = typeof input.transactionPin === 'string' ? input.transactionPin.trim() : ''
  const biometricApprovalToken = typeof input.biometricApprovalToken === 'string' ? input.biometricApprovalToken.trim() : ''

  if (transactionPin) {
    return verifyTransactionPinForUser(userId, transactionPin)
  }

  if (input.confirmWithBiometric === true) {
    const settings = await getSecuritySettingsByUserId(userId)
    if (!settings) throw new Error('Unable to validate biometric approval.')
    return settings
  }

  if (biometricApprovalToken) {
    await consumeBiometricApproval(userId, biometricApprovalToken)
    const settings = await getSecuritySettingsByUserId(userId)
    if (!settings?.hasBiometricCredential || !settings.biometricEnabled) {
      throw new Error('Biometric approval is not enabled for this account.')
    }
    return settings
  }

  throw new Error('Transaction PIN or biometric approval is required.')
}

export async function markNotificationsReadByUserId(userId: string) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres('UPDATE notifications SET read = ? WHERE user_id = ?', [true, userId])
    return getNotificationsForUser(userId)
  }
  getDb().prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId)
  return getNotificationsForUser(userId)
}

export async function insertAuditLog(input: {
  userId?: string
  actorUserId?: string
  action: string
  entityType: string
  entityId: string
  metadata?: Record<string, unknown>
}) {
  await ensureDbReady()
  if (isPostgresEnabled()) {
    await queryPostgres(`
      INSERT INTO audit_logs (id, user_id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      `audit_${randomBytes(6).toString('hex')}`, input.userId ?? null, input.actorUserId ?? null,
      input.action, input.entityType, input.entityId, input.metadata ? JSON.stringify(input.metadata) : null,
      new Date().toISOString(),
    ])
    return
  }
  getDb().prepare(`
    INSERT INTO audit_logs (id, user_id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `audit_${randomBytes(6).toString('hex')}`,
    input.userId ?? null,
    input.actorUserId ?? null,
    input.action,
    input.entityType,
    input.entityId,
    input.metadata ? JSON.stringify(input.metadata) : null,
    new Date().toISOString()
  )
}

export async function listAuditLogs(input?: { limit?: number; reference?: string }): Promise<AuditLog[]> {
  await ensureDbReady()
  const limit = Math.max(1, Math.min(100, input?.limit ?? 50))
  if (isPostgresEnabled()) {
    const result = input?.reference?.trim()
      ? await queryPostgres<AuditLogRow>('SELECT * FROM audit_logs WHERE entity_id = ? OR metadata LIKE ? ORDER BY created_at DESC LIMIT ?', [input.reference.trim(), `%${input.reference.trim()}%`, limit])
      : await queryPostgres<AuditLogRow>('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit])
    return result.rows.map(mapAuditLogRow)
  }
  const rows = input?.reference?.trim()
    ? getDb()
      .prepare(`
        SELECT * FROM audit_logs
        WHERE entity_id = ?
           OR metadata LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(input.reference.trim(), `%${input.reference.trim()}%`, limit) as AuditLogRow[]
    : getDb()
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as AuditLogRow[]
  return rows.map(mapAuditLogRow)
}

export function sanitizeUser(user: StoredUser): User {
  const { passwordHash, passwordSalt, ...safeUser } = user
  void passwordHash
  void passwordSalt
  return {
    ...safeUser,
    accountStatus: safeUser.accountStatus ?? 'active',
    isAdmin: isAdminEmail(safeUser.email),
  }
}

export function maskDocumentNumber(documentType: string, documentNumber: string) {
  const trimmed = documentNumber.trim()
  if (!trimmed) return ''
  if (documentType !== 'bvn' && documentType !== 'nin') return trimmed
  if (trimmed.length <= 4) return trimmed
  return `${'*'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`
}

export function verifyPassword(user: StoredUser, password: string): boolean {
  return hashPassword(password, user.passwordSalt) === user.passwordHash
}

export function buildHandle(name: string, email: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || email.split('@')[0]
  return `@${base.slice(0, 16)}`
}

export function buildReferralCode(name: string): string {
  const prefix = name.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5).padEnd(5, 'X')
  return `${prefix}${randomBytes(2).toString('hex').toUpperCase()}`
}

export function buildVirtualAccount(userName: string, sequence: number): Wallet['virtualAccounts'][number] {
  const accountNumber = `90${String(23450000 + sequence).padStart(8, '0')}`.slice(0, 10)

  return {
    bank: 'Moniepoint',
    accountNumber,
    accountName: `${userName.toUpperCase()} MAFITAPAY`,
    provider: 'moniepoint',
  }
}

export async function createUser(input: { name: string; email: string; phone: string; password: string; referralCode?: string }) {
  const email = input.email.trim().toLowerCase()
  const phone = input.phone.trim()
  const referralCodeInput = typeof (input as { referralCode?: string }).referralCode === 'string'
    ? (input as { referralCode?: string }).referralCode?.trim().toUpperCase() || ''
    : ''

  const existingUser = await getUserByEmail(email)
  if (existingUser) {
    throw new Error('An account with this email already exists.')
  }

  const existingPhoneUser = await getUserByPhone(phone)
  if (existingPhoneUser) {
    throw new Error('An account with this phone number already exists.')
  }

  let inviter: StoredUser | null = null
  if (referralCodeInput) {
    inviter = await getUserByReferralCode(referralCodeInput)
    if (!inviter) {
      throw new Error('Referral code is invalid.')
    }
  }

  const { passwordHash, passwordSalt } = createPasswordRecord(input.password)
  const id = `u_${randomBytes(6).toString('hex')}`
  const now = new Date().toISOString()
  const user: StoredUser = {
    id,
    name: input.name.trim(),
    email,
    phone,
    handle: buildHandle(input.name, email),
    referralCode: buildReferralCode(input.name),
    referredByUserId: inviter?.id,
    referredByReferralCode: inviter?.referralCode,
    referredAt: inviter ? now : undefined,
    accountStatus: 'pending_verification',
    kycStatus: 'pending',
    tier: 'basic',
    createdAt: now,
    passwordHash,
    passwordSalt,
  }
  await ensureDbReady()
  const db = getDb()
  const wallet = {
    balance: 0,
    lockedBalance: 0,
    reserveBalance: 0,
    reserveLockedBalance: 0,
    currency: 'NGN' as const,
    virtualAccounts: [],
  }

  if (isPostgresEnabled()) {
    await withPostgresTransaction(async client => {
      await queryPostgresClient(client, `
        INSERT INTO users (id, name, email, phone, handle, "referralCode", "referredByUserId", "referredByReferralCode", "referredAt", "accountStatus", "kycStatus", tier, "createdAt", "passwordHash", "passwordSalt")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        user.id, user.name, user.email, user.phone, user.handle, user.referralCode,
        user.referredByUserId ?? null, user.referredByReferralCode ?? null, user.referredAt ?? null,
        user.accountStatus, user.kycStatus, user.tier, user.createdAt, user.passwordHash, user.passwordSalt,
      ])
      await queryPostgresClient(client, `
        INSERT INTO wallets (user_id, balance, locked_balance, currency, virtual_accounts) VALUES (?, ?, ?, ?, ?)
      `, [user.id, wallet.balance, wallet.lockedBalance, wallet.currency, JSON.stringify(wallet.virtualAccounts)])
      await queryPostgresClient(client, `
        INSERT INTO security_settings (user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [user.id, 0, null, null, 0, null, 0, 1, now, now])
    })
    await maybeApplySignupRewardsForUser(user.id)
    return user
  }

  db.exec('BEGIN')
  try {
    db.prepare(`
      INSERT INTO users (
        id, name, email, phone, handle, referralCode, referredByUserId, referredByReferralCode, referredAt, accountStatus, kycStatus, tier, createdAt, passwordHash, passwordSalt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.name,
      user.email,
      user.phone,
      user.handle,
      user.referralCode,
      user.referredByUserId ?? null,
      user.referredByReferralCode ?? null,
      user.referredAt ?? null,
      user.accountStatus,
      user.kycStatus,
      user.tier,
      user.createdAt,
      user.passwordHash,
      user.passwordSalt
    )
    db.prepare(`
      INSERT INTO wallets (user_id, balance, locked_balance, currency, virtual_accounts)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, wallet.balance, wallet.lockedBalance, wallet.currency, JSON.stringify(wallet.virtualAccounts))
    db.prepare(`
      INSERT INTO security_settings (
        user_id, transaction_pin_enabled, transaction_pin_hash, transaction_pin_salt, transaction_pin_failed_attempts, transaction_pin_locked_until, two_factor_enabled, biometric_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, 0, null, null, 0, null, 0, 1, now, now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  await maybeApplySignupRewardsForUser(user.id)
  return user
}

export function createNotification(
  input: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'> &
    Partial<Pick<NotificationRecord, 'id' | 'createdAt' | 'read'>>
) {
  return {
    id: input.id ?? `n_${randomBytes(6).toString('hex')}`,
    userId: input.userId,
    title: input.title,
    message: input.message,
    type: input.type,
    read: input.read ?? false,
    createdAt: input.createdAt ?? new Date().toISOString(),
  } satisfies NotificationRecord
}
