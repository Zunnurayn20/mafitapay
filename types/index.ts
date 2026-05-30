// ═══════════════════════════════════════════
// MAFITAPAY — Core Types
// ═══════════════════════════════════════════

export interface User {
  id: string
  name: string
  email: string
  phone: string
  handle: string
  referralCode: string
  referredByUserId?: string
  referredByReferralCode?: string
  referredAt?: string
  accountStatus: 'active' | 'pending_verification' | 'deactivated'
  kycStatus: 'pending' | 'verified' | 'rejected'
  tier: 'basic' | 'verified' | 'premium'
  isAdmin?: boolean
  createdAt: string
}

export interface ReferralEntry {
  userId: string
  name: string
  joinedAt: string
  transactionCount: number
  earnedAmount: number
  rewardPaid: boolean
}

export interface ReferralOverview {
  referralCode: string
  totalReferrals: number
  totalEarned: number
  entries: ReferralEntry[]
}

export type RewardRuleKind = 'referral' | 'bonus'
export type RewardTriggerEvent = 'user_signup' | 'first_successful_transaction'
export type RewardAudience = 'actor' | 'inviter'
export type RewardAwardRequestStatus = 'pending' | 'approved' | 'rejected'

export interface RewardRule {
  id: string
  name: string
  description?: string
  kind: RewardRuleKind
  triggerEvent: RewardTriggerEvent
  audience: RewardAudience
  amountNgn: number
  requiresReferral?: boolean
  allowedTransactionTypes?: TransactionType[]
  excludedTransactionTypes?: TransactionType[]
  dailyPayoutCapNgn?: number
  manualApprovalRequired?: boolean
  isActive?: boolean
  createdAt: string
  updatedAt: string
}

export interface RewardRuleSummary {
  ruleId: string
  ruleName: string
  isActive: boolean
  totalAwards: number
  totalPayoutNgn: number
  pendingManualCount: number
  lastAwardAt?: string
}

export interface RewardAwardRecord {
  transactionId: string
  rewardRuleId: string
  rewardRuleName: string
  rewardType: 'referral_bonus' | 'reward_bonus'
  beneficiaryUserId: string
  beneficiaryName: string
  sourceUserId?: string
  sourceUserName?: string
  amountNgn: number
  status: TransactionStatus
  createdAt: string
  reference: string
}

export interface RewardAwardRequest {
  id: string
  rewardRuleId: string
  rewardRuleName: string
  rewardType: 'referral_bonus' | 'reward_bonus'
  rewardKind: RewardRuleKind
  triggerEvent: RewardTriggerEvent
  audience: RewardAudience
  beneficiaryUserId: string
  beneficiaryName: string
  sourceUserId: string
  sourceUserName: string
  triggerTransactionId?: string
  amountNgn: number
  status: RewardAwardRequestStatus
  statusReason?: string
  reviewedAt?: string
  reviewedByUserId?: string
  reviewedByName?: string
  createdAt: string
  updatedAt: string
}

export interface RewardRuleReport {
  totalAwards: number
  totalPayoutNgn: number
  pendingApprovalCount: number
  byRule: RewardRuleSummary[]
  recentAwards: RewardAwardRecord[]
  recentRequests: RewardAwardRequest[]
}

export interface Wallet {
  balance: number
  lockedBalance: number
  reserveBalance: number
  reserveLockedBalance: number
  currency: 'NGN'
  virtualAccounts: VirtualAccount[]
}

export interface VirtualAccount {
  bank: string
  accountNumber: string
  accountName: string
  provider: 'flutterwave' | 'moniepoint' | 'opay' | 'palmpay'
  isPermanent?: boolean
  reference?: string
  expiresAt?: string
}

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer_in'
  | 'transfer_out'
  | 'airtime'
  | 'data'
  | 'electric'
  | 'cable'
  | 'education'
  | 'gas'
  | 'insurance'
  | 'water'
  | 'crypto_buy'
  | 'crypto_sell'
  | 'referral_bonus'
  | 'reward_bonus'
  | 'admin_credit'
  | 'admin_debit'
  | 'p2p_deposit'
  | 'p2p_withdrawal'
export type TransactionStatus = 'pending' | 'success' | 'failed' | 'processing'

export interface Transaction {
  id: string
  type: TransactionType
  status: TransactionStatus
  amount: number
  fee: number
  description: string
  reference: string
  recipient?: string
  narration?: string
  createdAt: string
  icon?: string
  metadata?: Record<string, unknown>
}

export interface P2PMerchant {
  id: string
  name: string
  initial: string
  bank: string
  accountNumber: string
  accountName: string
  completionRate: number
  totalTrades: number
  minAmount: number
  maxAmount: number
  availableBalance: number
  isOnline: boolean
}

export type KnownCryptoPairId =
  | 'USDT_BSC'
  | 'USDC_BASE'
  | 'USDC_SOLANA'
  | 'ETH_BASE'
  | 'ETH_ETHEREUM'
  | 'ETH_ARB'
  | 'ETH_OP'
  | 'ETH_LINEA'
  | 'POL_POLYGON'
  | 'SOL_SOLANA'
  | 'BNB_BSC'
  | 'TON_TON'
  | 'SUI_SUI'
  | 'NEAR_NEAR'
export type CryptoPairId = KnownCryptoPairId | (string & {})
export type KnownCryptoSymbol = 'USDT' | 'USDC' | 'ETH' | 'SOL' | 'BNB' | 'TON' | 'SUI' | 'NEAR' | 'POL'
export type CryptoSymbol = KnownCryptoSymbol | (string & {})
export type KnownCryptoNetwork = 'BSC' | 'Base' | 'Ethereum' | 'Arbitrum' | 'Optimism' | 'Polygon' | 'Linea' | 'Solana' | 'TON' | 'Sui' | 'NEAR'
export type CryptoNetwork = KnownCryptoNetwork | (string & {})

export interface CryptoAsset {
  id: CryptoPairId
  symbol: CryptoSymbol
  name: string
  network: CryptoNetwork
  icon: string
  marketSourceId: string
  marketSnapshotSource?: 'live' | 'backup' | 'safe' | 'seed'
  pricingSource?: 'live' | 'backup' | 'safe'
  refreshDirection?: 'up' | 'down' | 'flat'
  marketPriceUsd?: number
  marketPriceUpdatedAt?: string
  marketRate: number
  buyRate: number
  sellRate: number
  buySpreadBps: number
  sellSpreadBps: number
  quoteTtlSeconds: number
  isActive?: boolean
  baseExecutionEnabled?: boolean
  executionRail?: 'base_treasury' | 'routed_treasury' | 'sui_treasury' | 'ton_treasury' | 'near_intents'
  routedToChain?: string
  routedToToken?: string
  routedDecimals?: number
  routedAddressFamily?: 'evm' | 'solana'
  minimumBuyNgn?: number
  maxQuoteDriftPercent?: number
  change24h: number
}

export interface CryptoQuote {
  id: string
  userId: string
  pairId: CryptoPairId
  side: 'buy' | 'sell'
  amountNgn: number
  cryptoAmount: number
  unitRate: number
  providerPayload?: Record<string, unknown>
  expiresAt: string
  usedAt?: string
  createdAt: string
}

export interface CryptoOrder {
  id: string
  userId: string
  transactionId: string
  quoteId: string
  pairId: CryptoPairId
  side: 'buy' | 'sell'
  amountNgn: number
  cryptoAmount: number
  unitRate: number
  destinationType: 'wallet' | 'exchange'
  destinationLabel?: string
  walletAddress?: string
  exchange?: string
  provider?: '0x' | 'lifi' | 'ston' | 'near_intents'
  providerOrderId?: string
  providerStatus?: string
  providerReference?: string
  providerPayload?: Record<string, unknown>
  executionRail?: 'base_legacy' | 'base_treasury' | 'bsc_treasury' | 'routed_treasury' | 'sui_treasury' | 'ton_treasury' | 'near_intents'
  executionStatus?: 'awaiting_swap' | 'broadcasted' | 'settled' | 'failed'
  executionReference?: string
  destinationTxHash?: string
  expiresAt?: string
  fulfilledAt?: string
  webhookReceivedAt?: string
  status: 'pending' | 'fulfilled' | 'failed' | 'expired'
  createdAt: string
  updatedAt: string
}

export interface BillProvider {
  id: string
  name: string
  icon: string
  type: 'airtime' | 'data' | 'electric' | 'cable' | 'education' | 'gas' | 'insurance' | 'water'
  accountLabel?: string
  accountPlaceholder?: string
  helperText?: string
  minAmount?: number
  maxAmount?: number
  requiresNetwork?: boolean
  requiresAccount?: boolean
  isActive?: boolean
  billers?: BillCatalogBiller[]
}

export interface BillCatalogItem {
  label: string
  amount: number
  itemCode: string
  billerCode: string
  itemName: string
  accountLabel?: string
}

export interface BillCatalogBiller {
  name: string
  shortName?: string
  billerCode: string
  accountLabel?: string
  items: BillCatalogItem[]
}

export interface BillDataBundle {
  label: string
  amount: number
  itemCode: string
  billerCode: string
  itemName: string
  validity?: string
  provider?: 'flutterwave' | 'amigo'
  providerPlanId?: string
  providerNetworkId?: number
  efficiencyPercent?: number
  efficiencyLabel?: string
}

export interface NetworkProvider {
  name: string
  icon: string
  dataBundles?: BillDataBundle[]
}

export interface BankDirectoryEntry {
  code: string
  name: string
  country: string
  provider: string
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface KycSubmission {
  id: string
  userId: string
  documentType: 'nin' | 'bvn' | 'passport' | 'drivers_license' | 'voters_card'
  documentNumber: string
  documentUrl: string
  documentName?: string
  mimeType?: string
  fileSize?: number
  status: 'pending' | 'approved' | 'rejected'
  notes?: string
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}

export interface FundingAccountEligibility {
  eligible: boolean
  reason:
    | 'ready'
    | 'approved_identity_required'
    | 'identity_under_review'
    | 'identity_rejected'
    | 'unsupported_identity_type'
    | 'account_already_assigned'
  identityType?: 'bvn' | 'nin'
  hasPermanentAccount: boolean
  message: string
}

export interface AuditLog {
  id: string
  userId?: string
  actorUserId?: string
  action: string
  entityType: string
  entityId: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface LedgerEntry {
  id: string
  userId: string
  transactionId?: string
  asset: 'NGN' | 'RESERVE'
  account: 'available' | 'locked'
  direction: 'credit' | 'debit'
  amount: number
  description?: string
  createdAt: string
}

export interface ProviderEvent {
  id: string
  externalEventId: string
  provider: string
  reference: string
  status: string
  payload?: Record<string, unknown>
  processedAt?: string
  retryCount?: number
  failureReason?: string
  createdAt: string
}

export interface ProviderEventRecentFailure {
  provider: string
  externalEventId: string
  reference: string
  status: string
  failureReason?: string
  retryCount?: number
  createdAt: string
}

export interface ProviderHealthSummary {
  provider: string
  totalEvents24h: number
  pendingCount: number
  failedCount: number
  retryingCount: number
  lastEventAt?: string
  lastProcessedAt?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  lastFailureReason?: string
  topFailureReasons: Array<{ reason: string; count: number }>
}

export interface ProviderDiagnosticsReport {
  totalPendingEvents: number
  totalFailedEvents24h: number
  totalRetryingEvents: number
  providers: ProviderHealthSummary[]
  recentFailures: ProviderEventRecentFailure[]
}

export interface DepositIntent {
  id: string
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
  status: 'pending' | 'success' | 'failed'
  retryCount?: number
  failureReason?: string
  createdAt: string
  updatedAt: string
}

export interface PayoutRequest {
  id: string
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
  status: 'pending' | 'success' | 'failed'
  retryCount?: number
  failureReason?: string
  createdAt: string
  updatedAt: string
}

export interface Beneficiary {
  id: string
  userId: string
  kind: 'bank' | 'internal'
  label: string
  bankCode?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
  internalUserId?: string
  handle?: string
  verifiedAt?: string
  isDefault?: boolean
  verificationProvider?: string
  verificationStatus?: 'pending' | 'verified' | 'rejected'
  verificationReference?: string
  verificationCheckedAt?: string
  verificationReason?: string
  lastUsedAt?: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface BeneficiaryVerification {
  id: string
  beneficiaryId: string
  userId: string
  kind: 'bank' | 'internal'
  provider: string
  status: 'pending' | 'verified' | 'rejected'
  reference?: string
  bankCode?: string
  accountNumber?: string
  accountName?: string
  bankName?: string
  handle?: string
  errorCode?: string
  payload?: Record<string, unknown>
  reason?: string
  checkedAt: string
  createdAt: string
}

export interface SendFormData {
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
  amount: number
  narration: string
}

export interface BuyFormData {
  asset: CryptoSymbol
  amountNGN: number
  walletAddress: string
}

export interface SellFormData {
  asset: CryptoSymbol
  amountNGN: number
  receiveMethod: 'exchange' | 'wallet'
  exchange?: string
  walletAddress?: string
}

export type Theme = 'dark' | 'light'

export interface AppState {
  theme: Theme
  user: User | null
  wallet: Wallet | null
  isAuthenticated: boolean
}
