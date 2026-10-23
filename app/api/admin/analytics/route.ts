import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getAdminAnalyticsSnapshot, listRecentTransactions } from '@/lib/server/data'
import type { Transaction, TransactionStatus, TransactionType } from '@/types'

const BILL_TYPES = new Set<TransactionType>(['airtime', 'data', 'electric', 'cable', 'education', 'gas', 'insurance', 'water'])
const MONEY_IN_TYPES = new Set<TransactionType>(['deposit', 'transfer_in', 'p2p_deposit', 'admin_credit', 'crypto_sell', 'reward_bonus', 'referral_bonus'])
const MONEY_OUT_TYPES = new Set<TransactionType>(['withdrawal', 'transfer_out', 'p2p_withdrawal', 'admin_debit', 'crypto_buy', ...BILL_TYPES])
// This metric represents customer transaction activity, not every ledger entry. Internal
// transfers are counted once from the sender's transfer_out record; transfer_in is the other
// ledger side of the same movement. Admin adjustments and rewards are wallet funding/adjustment
// entries rather than customer transaction volume.
const NON_VOLUME_TYPES = new Set<TransactionType>(['transfer_in', 'admin_credit', 'admin_debit', 'reward_bonus', 'referral_bonus'])
const DAY_MS = 24 * 60 * 60 * 1000

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function formatDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', timeZone: 'UTC' })
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

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const now = new Date()
  const days = Array.from({ length: 14 }, (_, index) => formatDay(new Date(now.getTime() - (13 - index) * DAY_MS)))
  const [snapshot, latestTransactions] = await Promise.all([
    getAdminAnalyticsSnapshot(days),
    listRecentTransactions(10),
  ])

  const successfulTransactions = snapshot.transactions.filter(item => item.status === 'success')
  const sumTypes = (types: Set<TransactionType>) => roundMoney(successfulTransactions
    .filter(item => types.has(item.type))
    .reduce((total, item) => total + Math.abs(item.amount), 0))
  const successfulVolume = (rows: typeof successfulTransactions) => roundMoney(rows
    .filter(item => !NON_VOLUME_TYPES.has(item.type))
    .reduce((total, item) => total + Math.abs(item.amount), 0))
  const feeTotal = roundMoney(successfulTransactions.reduce((total, item) => total + item.fee, 0))

  const daily = days.map(day => {
    const records = snapshot.dailyTransactions.filter(item => item.day === day)
    const successful = records.filter(item => item.status === 'success')
    const amountForTypes = (types: Set<TransactionType>) => successful
      .filter(item => types.has(item.type))
      .reduce((total, item) => total + Math.abs(item.amount), 0)
    return {
      day,
      label: dayLabel(day),
      count: records.reduce((total, item) => total + item.count, 0),
      successfulCount: successful.reduce((total, item) => total + item.count, 0),
      volume: successfulVolume(successful),
      moneyIn: roundMoney(amountForTypes(MONEY_IN_TYPES)),
      moneyOut: roundMoney(amountForTypes(MONEY_OUT_TYPES)),
      fees: roundMoney(successful.reduce((total, item) => total + item.fee, 0)),
      newUsers: snapshot.users.daily.get(day) ?? 0,
    }
  })

  const statusCounts = snapshot.transactions.reduce<Record<TransactionStatus, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + item.count
    return acc
  }, { pending: 0, processing: 0, success: 0, failed: 0 })

  const bucketMap = snapshot.transactions.reduce<Record<string, { count: number; volume: number; success: number; failed: number }>>((acc, item) => {
    const bucket = getTransactionBucket(item.type)
    acc[bucket] ??= { count: 0, volume: 0, success: 0, failed: 0 }
    acc[bucket].count += item.count
    if (item.status === 'success') {
      acc[bucket].success += item.count
      if (!NON_VOLUME_TYPES.has(item.type)) acc[bucket].volume += Math.abs(item.amount)
    }
    if (item.status === 'failed') acc[bucket].failed += item.count
    return acc
  }, {})

  const byType = Object.entries(bucketMap)
    .map(([bucket, value]) => ({ bucket, ...value, volume: roundMoney(value.volume) }))
    .sort((a, b) => b.volume - a.volume)

  const providerStatuses = snapshot.providerEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.status] = (acc[event.status] ?? 0) + event.count
    return acc
  }, {})
  const providerBreakdown = snapshot.providerEvents.reduce<Record<string, { total: number; failed: number; pending: number; processed: number }>>((acc, event) => {
    acc[event.provider] ??= { total: 0, failed: 0, pending: 0, processed: 0 }
    acc[event.provider].total += event.count
    if (event.status === 'failed') acc[event.provider].failed += event.count
    if (!event.processed) acc[event.provider].pending += event.count
    if (event.processed) acc[event.provider].processed += event.count
    return acc
  }, {})

  const summarizeStatuses = (rows: Array<{ status: string; count: number; volume: number }>) => {
    const result = { total: 0, pending: 0, success: 0, failed: 0, volume: 0 }
    for (const row of rows) {
      result.total += row.count
      if (row.status in result && row.status !== 'total' && row.status !== 'volume') {
        result[row.status as 'pending' | 'success' | 'failed'] += row.count
      }
      result.volume += row.volume
    }
    result.volume = roundMoney(result.volume)
    return result
  }

  const settlementSummary = {
    deposits: summarizeStatuses(snapshot.deposits),
    payouts: summarizeStatuses(snapshot.payouts),
  }

  const cryptoDepositSummary = {
    total: snapshot.cryptoDeposits.reduce((sum, row) => sum + row.count, 0),
    matched: snapshot.cryptoDeposits.filter(row => row.status === 'matched').reduce((sum, row) => sum + row.count, 0),
    unmatched: snapshot.cryptoDeposits.filter(row => row.status === 'unmatched').reduce((sum, row) => sum + row.count, 0),
    ignored: snapshot.cryptoDeposits.filter(row => row.status === 'ignored').reduce((sum, row) => sum + row.count, 0),
    swept: snapshot.cryptoDeposits.filter(row => row.sweep_status === 'swept').reduce((sum, row) => sum + row.count, 0),
    direct: snapshot.cryptoDeposits.filter(row => row.status === 'matched' && !row.crypto_order_id).reduce((sum, row) => sum + row.count, 0),
    volumes: Object.values(snapshot.cryptoDeposits
      .filter(row => row.status === 'matched')
      .reduce<Record<string, { asset: string; network: string; pairId: string; amount: number }>>((acc, row) => {
        const network = row.network || row.pair_id
        const key = `${row.asset_symbol}:${network}`
        acc[key] ??= { asset: row.asset_symbol, network, pairId: row.pair_id, amount: 0 }
        acc[key].amount += row.amount
        return acc
      }, {}))
      .sort((a, b) => b.amount - a.amount),
  }

  const cryptoOrders = {
    total: snapshot.cryptoOrders.reduce((sum, row) => sum + row.count, 0),
    pending: snapshot.cryptoOrders.filter(row => row.status === 'pending').reduce((sum, row) => sum + row.count, 0),
    success: snapshot.cryptoOrders.filter(row => row.status === 'fulfilled').reduce((sum, row) => sum + row.count, 0),
    failed: snapshot.cryptoOrders.filter(row => row.status === 'failed').reduce((sum, row) => sum + row.count, 0),
  }

  const transactionCount = Object.values(statusCounts).reduce((total, count) => total + count, 0)
  const walletSummary = {
    balance: roundMoney(snapshot.wallets.balance),
    locked: roundMoney(snapshot.wallets.locked),
    fundingAccountCoverage: snapshot.users.total > 0 ? Math.round((snapshot.wallets.withFundingAccount / snapshot.users.total) * 100) : 0,
  }
  const topWallets = snapshot.wallets.top.map(row => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    balance: roundMoney(row.balance),
    lockedBalance: roundMoney(row.locked),
    fundingAccounts: row.fundingAccounts,
  }))

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    data: {
      summary: {
        users: snapshot.users.total,
        activeUsers: snapshot.users.active,
        verifiedUsers: snapshot.users.verified,
        pendingKyc: snapshot.users.pendingKyc,
        walletBalance: walletSummary.balance,
        lockedBalance: walletSummary.locked,
        fundingAccountCoverage: walletSummary.fundingAccountCoverage,
        transactionCount,
        successfulVolume: successfulVolume(successfulTransactions),
        moneyIn: sumTypes(MONEY_IN_TYPES),
        moneyOut: sumTypes(MONEY_OUT_TYPES),
        fees: feeTotal,
        deposits: sumTypes(new Set<TransactionType>(['deposit', 'p2p_deposit'])),
        withdrawals: sumTypes(new Set<TransactionType>(['withdrawal', 'p2p_withdrawal'])),
        crypto: sumTypes(new Set<TransactionType>(['crypto_buy', 'crypto_sell'])),
        bills: sumTypes(BILL_TYPES),
        pendingSettlements: settlementSummary.deposits.pending + settlementSummary.payouts.pending,
        providerFailures: snapshot.providerEvents.filter(event => event.status === 'failed').reduce((sum, event) => sum + event.count, 0),
        pendingCryptoOrders: cryptoOrders.pending,
        cryptoDepositDetections: cryptoDepositSummary.total,
        unmatchedCryptoDeposits: cryptoDepositSummary.unmatched,
        sweptCryptoDeposits: cryptoDepositSummary.swept,
        directCryptoCredits: cryptoDepositSummary.direct,
      },
      daily,
      byType,
      statusCounts,
      providerStatuses,
      providerBreakdown: Object.entries(providerBreakdown).map(([provider, value]) => ({ provider, ...value })),
      settlementSummary,
      topWallets,
      latestTransactions,
      cryptoOrders,
      cryptoDeposits: cryptoDepositSummary,
    },
  })
}
