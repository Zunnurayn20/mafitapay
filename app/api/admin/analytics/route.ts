import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import {
  getWalletByUserId,
  listCryptoOrders,
  listDepositIntents,
  listPayoutRequests,
  listProviderEvents,
  listRecentTransactions,
  listUsers,
} from '@/lib/server/data'
import type { Transaction, TransactionStatus, TransactionType } from '@/types'

const BILL_TYPES = new Set<TransactionType>(['airtime', 'data', 'electric', 'cable', 'education', 'gas', 'insurance', 'water'])
const MONEY_IN_TYPES = new Set<TransactionType>(['deposit', 'transfer_in', 'p2p_deposit', 'admin_credit', 'crypto_sell', 'reward_bonus', 'referral_bonus'])
const MONEY_OUT_TYPES = new Set<TransactionType>(['withdrawal', 'transfer_out', 'p2p_withdrawal', 'admin_debit', 'crypto_buy', ...BILL_TYPES])
const DAY_MS = 24 * 60 * 60 * 1000

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function formatDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })
}

function getTransactionBucket(type: TransactionType) {
  if (type === 'deposit' || type === 'p2p_deposit') return 'deposits'
  if (type === 'withdrawal' || type === 'p2p_withdrawal') return 'withdrawals'
  if (type === 'transfer_in' || type === 'transfer_out') return 'transfers'
  if (type === 'crypto_buy' || type === 'crypto_sell') return 'crypto'
  if (BILL_TYPES.has(type)) return 'bills'
  if (type === 'admin_credit' || type === 'admin_debit') return 'admin'
  if (type === 'referral_bonus' || type === 'reward_bonus') return 'rewards'
  return 'other'
}

function sumTransactions(transactions: Array<{ transaction: Transaction }>, predicate: (transaction: Transaction) => boolean) {
  return roundMoney(transactions.reduce((total, item) => {
    const transaction = item.transaction
    return predicate(transaction) ? total + transaction.amount : total
  }, 0))
}

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const [
    users,
    recentTransactions,
    depositIntents,
    payoutRequests,
    providerEvents,
    cryptoOrders,
  ] = await Promise.all([
    listUsers(),
    listRecentTransactions(500),
    listDepositIntents({ limit: 100 }),
    listPayoutRequests({ limit: 100 }),
    listProviderEvents({ limit: 100 }),
    listCryptoOrders({ limit: 100 }),
  ])

  const walletRows = await Promise.all(users.map(async user => ({
    user,
    wallet: await getWalletByUserId(user.id),
  })))

  const now = new Date()
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(now.getTime() - (13 - index) * DAY_MS)
    return formatDay(date)
  })

  const daily = days.map(day => {
    const dayTransactions = recentTransactions.filter(item => item.transaction.createdAt.slice(0, 10) === day)
    const newUsers = users.filter(user => user.createdAt.slice(0, 10) === day).length
    const successful = dayTransactions.filter(item => item.transaction.status === 'success')
    return {
      day,
      label: dayLabel(day),
      count: dayTransactions.length,
      successfulCount: successful.length,
      volume: sumTransactions(successful, transaction => true),
      moneyIn: sumTransactions(successful, transaction => MONEY_IN_TYPES.has(transaction.type)),
      moneyOut: sumTransactions(successful, transaction => MONEY_OUT_TYPES.has(transaction.type)),
      fees: roundMoney(successful.reduce((total, item) => total + (item.transaction.fee || 0), 0)),
      newUsers,
    }
  })

  const statusCounts = recentTransactions.reduce<Record<TransactionStatus, number>>((acc, item) => {
    acc[item.transaction.status] = (acc[item.transaction.status] ?? 0) + 1
    return acc
  }, { pending: 0, processing: 0, success: 0, failed: 0 })

  const bucketMap = recentTransactions.reduce<Record<string, { count: number; volume: number; success: number; failed: number }>>((acc, item) => {
    const bucket = getTransactionBucket(item.transaction.type)
    acc[bucket] ??= { count: 0, volume: 0, success: 0, failed: 0 }
    acc[bucket].count += 1
    if (item.transaction.status === 'success') {
      acc[bucket].success += 1
      acc[bucket].volume = roundMoney(acc[bucket].volume + item.transaction.amount)
    }
    if (item.transaction.status === 'failed') acc[bucket].failed += 1
    return acc
  }, {})

  const byType = Object.entries(bucketMap)
    .map(([bucket, value]) => ({ bucket, ...value }))
    .sort((a, b) => b.volume - a.volume)

  const providerStatuses = providerEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.status] = (acc[event.status] ?? 0) + 1
    return acc
  }, {})

  const providerBreakdown = providerEvents.reduce<Record<string, { total: number; failed: number; pending: number; processed: number }>>((acc, event) => {
    acc[event.provider] ??= { total: 0, failed: 0, pending: 0, processed: 0 }
    acc[event.provider].total += 1
    if (event.status === 'failed') acc[event.provider].failed += 1
    if (!event.processedAt) acc[event.provider].pending += 1
    if (event.processedAt) acc[event.provider].processed += 1
    return acc
  }, {})

  const settlementSummary = {
    deposits: {
      total: depositIntents.length,
      pending: depositIntents.filter(item => item.status === 'pending').length,
      success: depositIntents.filter(item => item.status === 'success').length,
      failed: depositIntents.filter(item => item.status === 'failed').length,
      volume: roundMoney(depositIntents.filter(item => item.status === 'success').reduce((total, item) => total + item.netAmount, 0)),
    },
    payouts: {
      total: payoutRequests.length,
      pending: payoutRequests.filter(item => item.status === 'pending').length,
      success: payoutRequests.filter(item => item.status === 'success').length,
      failed: payoutRequests.filter(item => item.status === 'failed').length,
      volume: roundMoney(payoutRequests.filter(item => item.status === 'success').reduce((total, item) => total + item.amount, 0)),
    },
  }

  const walletSummary = walletRows.reduce((acc, row) => {
    acc.balance += row.wallet?.balance ?? 0
    acc.locked += row.wallet?.lockedBalance ?? 0
    if ((row.wallet?.virtualAccounts ?? []).length > 0) acc.withFundingAccount += 1
    return acc
  }, { balance: 0, locked: 0, withFundingAccount: 0 })

  const topWallets = walletRows
    .filter(row => row.wallet)
    .sort((a, b) => (b.wallet?.balance ?? 0) - (a.wallet?.balance ?? 0))
    .slice(0, 8)
    .map(row => ({
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      balance: roundMoney(row.wallet?.balance ?? 0),
      lockedBalance: roundMoney(row.wallet?.lockedBalance ?? 0),
      fundingAccounts: row.wallet?.virtualAccounts?.length ?? 0,
    }))

  const successfulTransactions = recentTransactions.filter(item => item.transaction.status === 'success')

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    data: {
      summary: {
        users: users.length,
        activeUsers: users.filter(user => user.accountStatus === 'active').length,
        verifiedUsers: users.filter(user => user.kycStatus === 'verified').length,
        pendingKyc: users.filter(user => user.kycStatus === 'pending').length,
        walletBalance: roundMoney(walletSummary.balance),
        lockedBalance: roundMoney(walletSummary.locked),
        fundingAccountCoverage: users.length > 0 ? Math.round((walletSummary.withFundingAccount / users.length) * 100) : 0,
        transactionCount: recentTransactions.length,
        successfulVolume: sumTransactions(successfulTransactions, transaction => true),
        moneyIn: sumTransactions(successfulTransactions, transaction => MONEY_IN_TYPES.has(transaction.type)),
        moneyOut: sumTransactions(successfulTransactions, transaction => MONEY_OUT_TYPES.has(transaction.type)),
        fees: roundMoney(successfulTransactions.reduce((total, item) => total + (item.transaction.fee || 0), 0)),
        deposits: sumTransactions(successfulTransactions, transaction => transaction.type === 'deposit' || transaction.type === 'p2p_deposit'),
        withdrawals: sumTransactions(successfulTransactions, transaction => transaction.type === 'withdrawal' || transaction.type === 'p2p_withdrawal'),
        crypto: sumTransactions(successfulTransactions, transaction => transaction.type === 'crypto_buy' || transaction.type === 'crypto_sell'),
        bills: sumTransactions(successfulTransactions, transaction => BILL_TYPES.has(transaction.type)),
        pendingSettlements: settlementSummary.deposits.pending + settlementSummary.payouts.pending,
        providerFailures: providerEvents.filter(event => event.status === 'failed').length,
        pendingCryptoOrders: cryptoOrders.filter(order => order.status === 'pending').length,
      },
      daily,
      byType,
      statusCounts,
      providerStatuses,
      providerBreakdown: Object.entries(providerBreakdown).map(([provider, value]) => ({ provider, ...value })),
      settlementSummary,
      topWallets,
      latestTransactions: recentTransactions.slice(0, 10),
      cryptoOrders: {
        total: cryptoOrders.length,
        pending: cryptoOrders.filter(order => order.status === 'pending').length,
        success: cryptoOrders.filter(order => order.status === 'fulfilled').length,
        failed: cryptoOrders.filter(order => order.status === 'failed').length,
      },
    },
  })
}
