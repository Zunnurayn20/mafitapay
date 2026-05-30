'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Activity, AlertTriangle, ArrowDownLeft, ArrowUpRight, BadgeDollarSign, BarChart3, CheckCircle2, Clock3, CreditCard, RadioTower, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { ReactNode } from 'react'
import type { Transaction } from '@/types'

type DailyPoint = {
  day: string
  label: string
  count: number
  successfulCount: number
  volume: number
  moneyIn: number
  moneyOut: number
  fees: number
  newUsers: number
}

type AnalyticsPayload = {
  generatedAt: string
  data: {
    summary: {
      users: number
      activeUsers: number
      verifiedUsers: number
      pendingKyc: number
      walletBalance: number
      lockedBalance: number
      fundingAccountCoverage: number
      transactionCount: number
      successfulVolume: number
      moneyIn: number
      moneyOut: number
      fees: number
      deposits: number
      withdrawals: number
      crypto: number
      bills: number
      pendingSettlements: number
      providerFailures: number
      pendingCryptoOrders: number
    }
    daily: DailyPoint[]
    byType: Array<{ bucket: string; count: number; volume: number; success: number; failed: number }>
    statusCounts: Record<string, number>
    providerStatuses: Record<string, number>
    providerBreakdown: Array<{ provider: string; total: number; failed: number; pending: number; processed: number }>
    settlementSummary: {
      deposits: { total: number; pending: number; success: number; failed: number; volume: number }
      payouts: { total: number; pending: number; success: number; failed: number; volume: number }
    }
    topWallets: Array<{ userId: string; name: string; email: string; balance: number; lockedBalance: number; fundingAccounts: number }>
    latestTransactions: Array<{ userId: string; transaction: Transaction }>
    cryptoOrders: { total: number; pending: number; success: number; failed: number }
  }
}

const emptyPayload: AnalyticsPayload['data'] = {
  summary: {
    users: 0,
    activeUsers: 0,
    verifiedUsers: 0,
    pendingKyc: 0,
    walletBalance: 0,
    lockedBalance: 0,
    fundingAccountCoverage: 0,
    transactionCount: 0,
    successfulVolume: 0,
    moneyIn: 0,
    moneyOut: 0,
    fees: 0,
    deposits: 0,
    withdrawals: 0,
    crypto: 0,
    bills: 0,
    pendingSettlements: 0,
    providerFailures: 0,
    pendingCryptoOrders: 0,
  },
  daily: [],
  byType: [],
  statusCounts: {},
  providerStatuses: {},
  providerBreakdown: [],
  settlementSummary: {
    deposits: { total: 0, pending: 0, success: 0, failed: 0, volume: 0 },
    payouts: { total: 0, pending: 0, success: 0, failed: 0, volume: 0 },
  },
  topWallets: [],
  latestTransactions: [],
  cryptoOrders: { total: 0, pending: 0, success: 0, failed: 0 },
}

function formatNgn(value: number) {
  return `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
}

function formatNumber(value: number) {
  return value.toLocaleString('en-NG')
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
}

async function fetchAnalytics(): Promise<AnalyticsPayload> {
  const response = await fetch('/api/admin/analytics', { credentials: 'include', cache: 'no-store' })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`/api/admin/analytics returned ${response.status} ${response.statusText || 'non-JSON response'}. Restart dev server if this is local.`)
  }
  const payload = await response.json()
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || 'Unable to load analytics.')
  }
  return payload
}

export function AdminAnalyticsDashboard() {
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadAnalytics() {
    setLoading(true)
    setError('')
    try {
      setPayload(await fetchAnalytics())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load analytics.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAnalytics()
  }, [])

  const data = payload?.data ?? emptyPayload
  const summary = data.summary
  const maxDailyVolume = useMemo(() => Math.max(1, ...data.daily.map(item => item.volume)), [data.daily])
  const maxBucketVolume = useMemo(() => Math.max(1, ...data.byType.map(item => item.volume)), [data.byType])
  const lastUpdated = payload?.generatedAt
    ? new Date(payload.generatedAt).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Not loaded'

  return (
    <div className="space-y-4">
      <section className="overflow-hidden border border-[var(--border)] bg-[var(--coal)]">
        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_.8fr]">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[1.3px] text-[var(--gold2)]">
              <BarChart3 size={14} />
              Analytics Dashboard
            </div>
            <h1 className="mt-2 text-[24px] font-black tracking-tight text-[var(--text)] md:text-[32px]">
              Money movement, users, providers, and operational risk in one place.
            </h1>
            <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
              Built from live app data: transactions, wallets, KYC, provider events, settlements, bills, and crypto orders. Figures use the latest available records and are refreshed on demand.
            </p>
          </div>
          <div className="flex flex-col justify-between gap-3 border border-[var(--border)] bg-[var(--clay)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Last generated</div>
            <div className="text-[18px] font-black text-[var(--text)]">{lastUpdated}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void loadAnalytics()} loading={loading}>Refresh</Button>
              <Link href="/admin/operations">
                <Button size="sm" variant="ghost">Operations</Button>
              </Link>
            </div>
            {error && <div className="border border-[var(--red2)] bg-[rgba(196,52,26,.1)] p-2 text-[10px] font-bold text-[var(--red2)]">{error}</div>}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<BadgeDollarSign size={18} />} label="Successful Volume" value={formatNgn(summary.successfulVolume)} detail={`${formatNumber(summary.transactionCount)} recent txs`} tone="gold" />
        <MetricCard icon={<ArrowDownLeft size={18} />} label="Money In" value={formatNgn(summary.moneyIn)} detail={`${formatNgn(summary.deposits)} deposits`} tone="green" />
        <MetricCard icon={<ArrowUpRight size={18} />} label="Money Out" value={formatNgn(summary.moneyOut)} detail={`${formatNgn(summary.withdrawals)} withdrawals`} tone="red" />
        <MetricCard icon={<CreditCard size={18} />} label="Wallet Float" value={formatNgn(summary.walletBalance)} detail={`${formatNgn(summary.lockedBalance)} locked`} tone="blue" />
        <MetricCard icon={<Users size={18} />} label="Users" value={formatNumber(summary.users)} detail={`${formatNumber(summary.activeUsers)} active · ${formatNumber(summary.verifiedUsers)} verified`} tone="plain" />
        <MetricCard icon={<ShieldCheck size={18} />} label="KYC Pending" value={formatNumber(summary.pendingKyc)} detail={`${summary.fundingAccountCoverage}% funding account coverage`} tone="gold" />
        <MetricCard icon={<RadioTower size={18} />} label="Provider Failures" value={formatNumber(summary.providerFailures)} detail={`${formatNumber(summary.pendingSettlements)} pending settlements`} tone={summary.providerFailures > 0 ? 'red' : 'green'} />
        <MetricCard icon={<Activity size={18} />} label="Fees Captured" value={formatNgn(summary.fees)} detail={`${formatNgn(summary.crypto)} crypto · ${formatNgn(summary.bills)} bills`} tone="green" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <Card className="p-4" pattern="soft">
          <SectionHeader title="14-Day Money Movement" detail="Successful volume, money in, money out, fees, and signups." />
          <div className="mt-4 flex h-64 items-end gap-2 overflow-x-auto pb-2">
            {data.daily.map(point => (
              <div key={point.day} className="flex min-w-14 flex-1 flex-col items-center gap-2">
                <div className="flex h-48 w-full items-end gap-1">
                  <div className="flex-1 bg-[var(--gold)]" style={{ height: `${Math.max(4, (point.volume / maxDailyVolume) * 100)}%` }} title={`Volume ${formatNgn(point.volume)}`} />
                  <div className="flex-1 bg-[var(--green)]" style={{ height: `${Math.max(4, (point.moneyIn / maxDailyVolume) * 100)}%` }} title={`In ${formatNgn(point.moneyIn)}`} />
                  <div className="flex-1 bg-[var(--red2)]" style={{ height: `${Math.max(4, (point.moneyOut / maxDailyVolume) * 100)}%` }} title={`Out ${formatNgn(point.moneyOut)}`} />
                </div>
                <div className="text-center text-[9px] font-bold uppercase text-[var(--muted)]">{point.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[.8px] text-[var(--muted)]">
            <Legend color="bg-[var(--gold)]" label="Volume" />
            <Legend color="bg-[var(--green)]" label="Money In" />
            <Legend color="bg-[var(--red2)]" label="Money Out" />
          </div>
        </Card>

        <Card className="p-4" pattern="soft">
          <SectionHeader title="Status Mix" detail="Recent transaction and provider event status." />
          <div className="mt-4 space-y-3">
            <StatusRow icon={<CheckCircle2 size={15} />} label="Successful Transactions" value={data.statusCounts.success ?? 0} tone="green" />
            <StatusRow icon={<Clock3 size={15} />} label="Pending Transactions" value={(data.statusCounts.pending ?? 0) + (data.statusCounts.processing ?? 0)} tone="gold" />
            <StatusRow icon={<AlertTriangle size={15} />} label="Failed Transactions" value={data.statusCounts.failed ?? 0} tone="red" />
            <StatusRow icon={<RadioTower size={15} />} label="Pending Crypto Orders" value={data.cryptoOrders.pending} tone="gold" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <MiniStat label="Deposit Settled" value={formatNgn(data.settlementSummary.deposits.volume)} />
            <MiniStat label="Payout Settled" value={formatNgn(data.settlementSummary.payouts.volume)} />
            <MiniStat label="Deposit Queue" value={formatNumber(data.settlementSummary.deposits.pending)} />
            <MiniStat label="Payout Queue" value={formatNumber(data.settlementSummary.payouts.pending)} />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <SectionHeader title="Revenue & Product Mix" detail="Volume by product bucket from recent successful transactions." />
          <div className="mt-4 space-y-3">
            {data.byType.length === 0 ? (
              <EmptyAnalytics label="No transaction buckets available." />
            ) : data.byType.map(item => (
              <div key={item.bucket} className="grid gap-2 sm:grid-cols-[8rem_1fr_7rem] sm:items-center">
                <div className="text-[10px] font-black uppercase tracking-[.8px] text-[var(--text)]">{titleCase(item.bucket)}</div>
                <div className="h-3 overflow-hidden bg-[var(--clay)]">
                  <div className="h-full bg-[linear-gradient(90deg,var(--gold),var(--green))]" style={{ width: `${Math.max(3, (item.volume / maxBucketVolume) * 100)}%` }} />
                </div>
                <div className="text-right text-[10px] font-bold text-[var(--muted)]">{formatNgn(item.volume)}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <SectionHeader title="Provider Reliability" detail="Recent webhook/event processing." />
          <div className="mt-4 space-y-3">
            {data.providerBreakdown.length === 0 ? (
              <EmptyAnalytics label="No provider events recorded." />
            ) : data.providerBreakdown.map(provider => (
              <div key={provider.provider} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-black uppercase tracking-[.8px] text-[var(--text)]">{provider.provider}</div>
                  <div className="text-[10px] font-bold text-[var(--muted)]">{provider.total} events</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <MiniStat label="Processed" value={formatNumber(provider.processed)} />
                  <MiniStat label="Pending" value={formatNumber(provider.pending)} />
                  <MiniStat label="Failed" value={formatNumber(provider.failed)} danger={provider.failed > 0} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <SectionHeader title="Top Wallets" detail="Highest wallet balances for operational review." />
          <div className="mt-4 space-y-2">
            {data.topWallets.length === 0 ? (
              <EmptyAnalytics label="No wallet balances available." />
            ) : data.topWallets.map(wallet => (
              <div key={wallet.userId} className="grid grid-cols-[1fr_auto] gap-3 border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-black text-[var(--text)]">{wallet.name}</div>
                  <div className="truncate text-[10px] text-[var(--muted)]">{wallet.email}</div>
                </div>
                <div className="text-right">
                  <div className="text-[12px] font-black text-[var(--gold2)]">{formatNgn(wallet.balance)}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[.7px] text-[var(--muted)]">{wallet.fundingAccounts} accounts</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <SectionHeader title="Latest Transactions" detail="Newest activity across all users." />
          <div className="mt-4 space-y-2">
            {data.latestTransactions.length === 0 ? (
              <EmptyAnalytics label="No recent transactions available." />
            ) : data.latestTransactions.map(item => (
              <div key={item.transaction.id} className="grid grid-cols-[1fr_auto] gap-3 border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-black text-[var(--text)]">{item.transaction.description}</div>
                  <div className="truncate text-[10px] text-[var(--muted)]">{item.transaction.type} · {new Date(item.transaction.createdAt).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className="text-right">
                  <div className="text-[12px] font-black text-[var(--gold2)]">{formatNgn(item.transaction.amount)}</div>
                  <div className="text-[9px] font-bold uppercase tracking-[.7px] text-[var(--muted)]">{item.transaction.status}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  )
}

function MetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: 'gold' | 'green' | 'red' | 'blue' | 'plain' }) {
  const toneClass = tone === 'green'
    ? 'text-[var(--green)]'
    : tone === 'red'
      ? 'text-[var(--red2)]'
      : tone === 'blue'
        ? 'text-sky-300'
        : tone === 'gold'
          ? 'text-[var(--gold2)]'
          : 'text-[var(--text)]'

  return (
    <Card className="p-4">
      <div className={`flex items-center gap-2 ${toneClass}`}>
        {icon}
        <div className="text-[9px] font-black uppercase tracking-[1px]">{label}</div>
      </div>
      <div className="mt-3 text-[20px] font-black tracking-tight text-[var(--text)]">{value}</div>
      <div className="mt-1 text-[10px] font-bold text-[var(--muted)]">{detail}</div>
    </Card>
  )
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="text-[13px] font-black text-[var(--text)]">{title}</div>
      <div className="text-[10px] text-[var(--muted)]">{detail}</div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 ${color}`} />
      {label}
    </span>
  )
}

function StatusRow({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'green' | 'gold' | 'red' }) {
  const color = tone === 'green' ? 'text-[var(--green)]' : tone === 'red' ? 'text-[var(--red2)]' : 'text-[var(--gold2)]'
  return (
    <div className="flex items-center justify-between border border-[var(--border)] bg-[var(--clay)] p-3">
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-[.8px]">{label}</span>
      </div>
      <span className="text-[13px] font-black text-[var(--text)]">{formatNumber(value)}</span>
    </div>
  )
}

function MiniStat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="border border-[var(--border)] bg-[rgba(255,255,255,.025)] p-2">
      <div className={`text-[11px] font-black ${danger ? 'text-[var(--red2)]' : 'text-[var(--text)]'}`}>{value}</div>
      <div className="mt-1 text-[8px] font-bold uppercase tracking-[.7px] text-[var(--muted)]">{label}</div>
    </div>
  )
}

function EmptyAnalytics({ label }: { label: string }) {
  return <div className="border border-dashed border-[var(--border)] p-6 text-center text-[11px] text-[var(--muted)]">{label}</div>
}
