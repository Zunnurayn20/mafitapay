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
  listUsers,
} from '@/lib/server/data'
import { getFlutterwaveBalance } from '@/lib/server/flutterwave-collections'
import { getAmigoBalance } from '@/lib/server/amigo-bills'
import { getAsbdataBalance } from '@/lib/server/asbdata-bills'
import { getBardetechBalance } from '@/lib/server/bardetech-bills'
import type { ProviderBalance } from '@/lib/server/provider-balance'
import type { User, Wallet } from '@/types'

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
  const [users, wallets, transactions, events, notifications, deposits, payouts, totalLiability, flutterwaveBalance, amigoBalance, asbdataBalance, bardetechBalance] = await Promise.all([
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
