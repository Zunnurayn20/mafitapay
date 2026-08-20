import { redirect } from 'next/navigation'
import { requireAdminUser } from '@/lib/server/auth'
import {
  getTotalWalletLiability,
  getWalletByUserId,
  listAuditLogs,
  listDepositIntents,
  listPayoutRequests,
  listProviderEvents,
  listRecentNotifications,
  listRecentTransactions,
  listTransactionsByStatuses,
  listUsers,
} from '@/lib/server/data'
import { getFlutterwaveBalance } from '@/lib/server/flutterwave-collections'
import { getAmigoBalance } from '@/lib/server/amigo-bills'
import { getAsbdataBalance } from '@/lib/server/asbdata-bills'
import { getBardetechBalance } from '@/lib/server/bardetech-bills'
import { runEvmTreasuryBatchConversion } from '@/lib/server/crypto-deposit-sweeper'
import { getBaseTreasuryBalances } from '@/lib/server/base-executor'
import type { ProviderBalance } from '@/lib/server/provider-balance'
import type { ProviderEvent, Transaction, User, Wallet } from '@/types'

const CREDIT_TYPES = new Set([
  'deposit',
  'transfer_in',
  'crypto_sell',
  'referral_bonus',
  'reward_bonus',
  'admin_credit',
  'p2p_deposit',
])
const STALE_PENDING_MS = 15 * 60 * 1000

function isFailedProviderEvent(event: ProviderEvent) {
  return event.status.toLowerCase() === 'failed' || Boolean(event.failureReason)
}

function transactionReferenceKeys(transaction: Transaction) {
  const keys = [transaction.reference]
  const metadata = transaction.metadata ?? {}
  for (const value of [metadata.providerReference, metadata.txRef, metadata.depositTxHash]) {
    if (typeof value === 'string' && value.trim()) keys.push(value.trim())
  }
  return keys
}

function pickProviderEvent(events: ProviderEvent[]) {
  if (events.length === 0) return null
  const failed = events.find(isFailedProviderEvent)
  return failed ?? events[0]
}

export type AdminTransactionBoardRow = {
  id: string
  kind: 'transaction' | 'provider_only'
  userId: string | null
  customerName: string
  customerContact: string
  type: string
  description: string
  reference: string
  amount: number | null
  isCredit: boolean
  status: string
  provider: string | null
  failureReason: string | null
  createdAt: string
  needsAttention: boolean
}

export async function loadAdminTransactionBoard() {
  const [recent, failed, pending, processing, users, events] = await Promise.all([
    listRecentTransactions(200),
    listTransactionsByStatuses(['failed'], 120),
    listTransactionsByStatuses(['pending'], 80),
    listTransactionsByStatuses(['processing'], 80),
    listUsers(),
    listProviderEvents({ limit: 200 }),
  ])

  const userById = new Map(users.map(user => [user.id, user]))
  const txnById = new Map<string, { userId: string; transaction: Transaction }>()
  for (const row of [...recent, ...failed, ...pending, ...processing]) {
    txnById.set(row.transaction.id, row)
  }

  const eventsByReference = new Map<string, ProviderEvent[]>()
  for (const event of events) {
    const key = event.reference.trim()
    if (!key) continue
    const list = eventsByReference.get(key) ?? []
    list.push(event)
    eventsByReference.set(key, list)
  }

  const matchedEventIds = new Set<string>()
  const rows: AdminTransactionBoardRow[] = []

  for (const row of txnById.values()) {
    const txn = row.transaction
    const user = userById.get(row.userId)
    const related: ProviderEvent[] = []
    for (const key of transactionReferenceKeys(txn)) {
      const matches = eventsByReference.get(key)
      if (!matches) continue
      related.push(...matches)
    }
    for (const event of related) matchedEventIds.add(event.id)
    const providerEvent = pickProviderEvent(related)
    const createdAtMs = new Date(txn.createdAt).getTime()
    const stalePending = (txn.status === 'pending' || txn.status === 'processing')
      && Number.isFinite(createdAtMs)
      && Date.now() - createdAtMs > STALE_PENDING_MS
    const failed = txn.status === 'failed' || Boolean(providerEvent && isFailedProviderEvent(providerEvent))
    rows.push({
      id: txn.id,
      kind: 'transaction',
      userId: row.userId,
      customerName: user?.name || row.userId,
      customerContact: user?.phone || user?.email || 'No contact',
      type: txn.type,
      description: txn.description || txn.type,
      reference: txn.reference,
      amount: txn.amount,
      isCredit: CREDIT_TYPES.has(txn.type),
      status: txn.status,
      provider: providerEvent?.provider
        ?? (typeof txn.metadata?.providerName === 'string' ? txn.metadata.providerName : null)
        ?? (typeof txn.metadata?.provider === 'string' ? txn.metadata.provider : null),
      failureReason: providerEvent?.failureReason || (failed && txn.status === 'failed' ? 'Transaction marked failed' : null),
      createdAt: txn.createdAt,
      needsAttention: failed || stalePending,
    })
  }

  for (const event of events) {
    if (matchedEventIds.has(event.id)) continue
    if (!isFailedProviderEvent(event) && event.status.toLowerCase() !== 'pending') continue
    if (!isFailedProviderEvent(event) && event.processedAt) continue
    rows.push({
      id: `event:${event.id}`,
      kind: 'provider_only',
      userId: null,
      customerName: 'Unmatched provider event',
      customerContact: 'No wallet transaction found',
      type: 'provider_event',
      description: `${event.provider} reported ${event.status}`,
      reference: event.reference,
      amount: null,
      isCredit: false,
      status: isFailedProviderEvent(event) ? 'failed' : 'pending',
      provider: event.provider,
      failureReason: event.failureReason || 'Provider event has no matching customer transaction',
      createdAt: event.createdAt,
      needsAttention: true,
    })
  }

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return {
    rows,
    counts: {
      total: rows.filter(item => item.kind === 'transaction').length,
      failed: rows.filter(item => item.status === 'failed').length,
      pending: rows.filter(item => item.status === 'pending' || item.status === 'processing').length,
      attention: rows.filter(item => item.needsAttention).length,
    },
  }
}

/** Kobo-round. Float sums drift, and a coverage percent built on drifted money reads badly. */
function roundNaira(value: number) {
  return Math.round(value * 100) / 100
}

export async function requireAdminPageUser() {
  const admin = await requireAdminUser()
  if (!admin) redirect('/dashboard')
  return admin
}

export type AdminWalletRow = { user: User; wallet: Wallet | null }

export async function listAdminWalletRows(limit = 100): Promise<AdminWalletRow[]> {
  const users = (await listUsers()).slice(0, limit)
  return Promise.all(
    users.map(async user => ({
      user,
      wallet: await getWalletByUserId(user.id),
    })),
  )
}

export async function loadAdminOverviewData() {
  const [users, wallets, transactions, events, notifications, deposits, payouts, totalLiability, flutterwaveBalance, amigoBalance, asbdataBalance, bardetechBalance, cryptoTreasury, baseTreasury] = await Promise.all([
    listUsers(),
    listAdminWalletRows(100),
    listRecentTransactions(100),
    listProviderEvents({ limit: 50 }),
    listRecentNotifications(80),
    listDepositIntents({ limit: 50 }),
    listPayoutRequests({ limit: 50 }),
    getTotalWalletLiability(),
    getFlutterwaveBalance('NGN'),
    getAmigoBalance(),
    getAsbdataBalance(),
    getBardetechBalance(),
    runEvmTreasuryBatchConversion({ dryRun: true, allowBelowThreshold: true }).catch(() => null),
    getBaseTreasuryBalances().catch(() => null),
  ])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const usersToday = users.filter(user => new Date(user.createdAt) >= today).length
  const walletLiability = wallets.reduce((sum, row) => sum + (row.wallet?.balance ?? 0), 0)
  const pendingTxns = transactions.filter(item =>
    item.transaction.status === 'pending' || item.transaction.status === 'processing',
  ).length
  const failedTxns = transactions.filter(item => item.transaction.status === 'failed').length
  const unprocessedEvents = events.filter(event => !event.processedAt).length
  const virtualAccounts = wallets.reduce((sum, row) => sum + (row.wallet?.virtualAccounts?.length ?? 0), 0)

  let todayCredit = 0
  let todayDebit = 0
  for (const row of transactions) {
    const txn = row.transaction
    if (txn.status !== 'success') continue
    if (new Date(txn.createdAt) < today) continue
    const isCredit = ['deposit', 'transfer_in', 'crypto_sell', 'referral_bonus', 'reward_bonus', 'admin_credit', 'p2p_deposit'].includes(txn.type)
    if (isCredit) todayCredit += txn.amount
    else todayDebit += txn.amount
  }

  // Every place customer money sits: the payout rail plus the prepaid VTU floats that bills and
  // airtime are vended against.
  const providerBalances: ProviderBalance[] = [
    {
      provider: 'flutterwave',
      label: 'Flutterwave NGN',
      configured: flutterwaveBalance.configured,
      balance: flutterwaveBalance.success ? (flutterwaveBalance.balance ?? 0) : null,
      message: flutterwaveBalance.success ? undefined : flutterwaveBalance.message,
    },
    amigoBalance,
    asbdataBalance,
    bardetechBalance,
  ]

  // Only providers we could actually read count toward the total. A configured provider that
  // failed to answer makes the total a floor rather than a figure, so the card is told the
  // coverage number is incomplete instead of showing a shortfall that may not exist. Providers
  // that were never configured are simply not part of this business and are ignored.
  const readable = providerBalances.filter(entry => entry.balance != null)
  const unreadable = providerBalances.filter(entry => entry.configured && entry.balance == null)
  const totalProviderFloat = readable.length > 0
    ? roundNaira(readable.reduce((sum, entry) => sum + (entry.balance ?? 0), 0))
    : null

  const liquidityGap = totalProviderFloat == null ? null : roundNaira(totalProviderFloat - totalLiability)
  const liquidityCoverage = totalProviderFloat == null
    ? null
    : totalLiability > 0
      ? Math.round((totalProviderFloat / totalLiability) * 100)
      : 100

  return {
    users,
    wallets,
    transactions,
    events,
    liquidity: {
      customerLiability: totalLiability,
      providerFloat: totalProviderFloat,
      providers: providerBalances,
      // True when at least one configured provider did not answer, so the float is a floor.
      partial: unreadable.length > 0,
      gap: liquidityGap,
      coverage: liquidityCoverage,
      cryptoTreasury,
      baseTreasury,
    },
    stats: {
      usersToday,
      walletLiability,
      pendingTxns,
      failedTxns,
      unprocessedEvents,
      virtualAccounts,
      todayCredit,
      todayDebit,
      unreadNotifications: notifications.filter(item => !item.read).length,
      pendingSettlements:
        deposits.filter(item => item.status === 'pending').length
        + payouts.filter(item => item.status === 'pending').length,
    },
  }
}

export async function loadAdminAuditLogs(limit = 100) {
  return listAuditLogs({ limit })
}
