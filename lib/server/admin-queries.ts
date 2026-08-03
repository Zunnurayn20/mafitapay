import { redirect } from 'next/navigation'
import { requireAdminUser } from '@/lib/server/auth'
import {
  getWalletByUserId,
  listAuditLogs,
  listDepositIntents,
  listPayoutRequests,
  listProviderEvents,
  listRecentNotifications,
  listRecentTransactions,
  listUsers,
} from '@/lib/server/data'
import type { User, Wallet } from '@/types'

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
  const [users, wallets, transactions, events, notifications, deposits, payouts] = await Promise.all([
    listUsers(),
    listAdminWalletRows(100),
    listRecentTransactions(100),
    listProviderEvents({ limit: 50 }),
    listRecentNotifications(80),
    listDepositIntents({ limit: 50 }),
    listPayoutRequests({ limit: 50 }),
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

  return {
    users,
    wallets,
    transactions,
    events,
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
