'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Activity, AlertTriangle, ArrowDownLeft, ArrowUpRight, BadgeDollarSign, BarChart3, CheckCircle2, Clock3, CreditCard, RadioTower, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { CSSProperties, ReactNode } from 'react'
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
    cryptoDeposits: { total: number; matched: number; unmatched: number; ignored: number; swept: number; direct: number; volumes: Array<{ asset: string; network: string; pairId: string; amount: number }> }
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
  cryptoDeposits: { total: 0, matched: 0, unmatched: 0, ignored: 0, swept: 0, direct: 0, volumes: [] },
}

const VOLUME_COLORS = ['var(--gold)', 'var(--green)', 'var(--red2)', '#38bdf8', '#a78bfa', '#f97316', '#e879f9', '#94a3b8']

function getVolumeColor(index: number) {
  return VOLUME_COLORS[index % VOLUME_COLORS.length]
}

function formatNgn(value: number) {
  return `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
}

function formatNumber(value: number) {
  return value.toLocaleString('en-NG')
}

function formatCrypto(value: number) {
  return value.toLocaleString('en-NG', { maximumFractionDigits: 8 })
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
  const maxBucketVolume = useMemo(() => Math.max(1, ...data.byType.map(item => item.volume)), [data.byType])
  const volumeSlices = useMemo(() => data.byType.filter(item => item.volume > 0), [data.byType])
  const volumeTotal = useMemo(() => volumeSlices.reduce((total, item) => total + item.volume, 0), [volumeSlices])
  const maxDailyMovement = useMemo(() => Math.max(1, ...data.daily.flatMap(item => [item.volume, item.moneyIn, item.moneyOut])), [data.daily])
  const volumePieStyle = useMemo<CSSProperties>(() => {
    if (volumeTotal <= 0) return { background: 'var(--clay)' }
    let angle = 0
    const stops = volumeSlices.map((item, index) => {
      const start = angle
      angle += item.volume / volumeTotal * 360
      return `${getVolumeColor(index)} ${start}deg ${angle}deg`
    })
    return { background: `conic-gradient(${stops.join(', ')})` }
  }, [volumeSlices, volumeTotal])
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
              All-time totals use full database aggregates. The chart covers the last 14 UTC days, and the activity list shows the 10 newest transactions.
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
        <MetricCard icon={<BadgeDollarSign size={18} />} label="All-Time Transaction Volume" value={formatNgn(summary.successfulVolume)} detail="Successful customer transactions; internal transfers counted once" tone="gold" />
        <MetricCard icon={<ArrowDownLeft size={18} />} label="All-Time Wallet Credits" value={formatNgn(summary.moneyIn)} detail="Deposits, transfers, rewards, and admin credits" tone="green" />
        <MetricCard icon={<ArrowUpRight size={18} />} label="All-Time Wallet Debits" value={formatNgn(summary.moneyOut)} detail="Payouts, transfers, bills, crypto buys, and admin debits" tone="red" />
        <MetricCard icon={<CreditCard size={18} />} label="Customer NGN Balance" value={formatNgn(summary.walletBalance)} detail={`${formatNgn(summary.lockedBalance)} locked`} tone="blue" />
        <MetricCard icon={<Users size={18} />} label="Users" value={formatNumber(summary.users)} detail={`${formatNumber(summary.activeUsers)} active · ${formatNumber(summary.verifiedUsers)} verified`} tone="plain" />
        <MetricCard icon={<ShieldCheck size={18} />} label="KYC Pending" value={formatNumber(summary.pendingKyc)} detail={`${summary.fundingAccountCoverage}% funding account coverage`} tone="gold" />
        <MetricCard icon={<RadioTower size={18} />} label="Provider Failures" value={formatNumber(summary.providerFailures)} detail={`${formatNumber(summary.pendingSettlements)} pending settlements`} tone={summary.providerFailures > 0 ? 'red' : 'green'} />
        <MetricCard icon={<Activity size={18} />} label="Recorded Transaction Fees" value={formatNgn(summary.fees)} detail="Success-only fees; not net platform revenue" tone="green" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <Card className="p-4" pattern="soft">
          <SectionHeader title="14-Day Money Movement" detail="Successful customer transaction volume and wallet credits/debits, by UTC date." />
          <div className="mt-4 flex h-64 items-end gap-2 overflow-x-auto pb-2">
            {data.daily.map(point => (
              <div key={point.day} className="flex min-w-14 flex-1 flex-col items-center gap-2">
                <div className="flex h-48 w-full items-end gap-1">
                  <div className="flex-1 bg-[var(--gold)]" style={{ height: `${Math.max(4, (point.volume / maxDailyMovement) * 100)}%` }} title={`Transaction volume ${formatNgn(point.volume)}`} />
                  <div className="flex-1 bg-[var(--green)]" style={{ height: `${Math.max(4, (point.moneyIn / maxDailyMovement) * 100)}%` }} title={`Wallet credits ${formatNgn(point.moneyIn)}`} />
                  <div className="flex-1 bg-[var(--red2)]" style={{ height: `${Math.max(4, (point.moneyOut / maxDailyMovement) * 100)}%` }} title={`Wallet debits ${formatNgn(point.moneyOut)}`} />
                </div>
                <div className="text-center text-[9px] font-bold uppercase text-[var(--muted)]">{point.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[.8px] text-[var(--muted)]">
            <Legend color="bg-[var(--gold)]" label="Volume" />
            <Legend color="bg-[var(--green)]" label="Wallet Credits" />
            <Legend color="bg-[var(--red2)]" label="Wallet Debits" />
          </div>
        </Card>

        <Card className="p-4" pattern="soft">
          <SectionHeader title="All-Time Status Mix" detail="Full transaction history; provider and settlement totals are also all-time." />
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
            <MiniStat label="Crypto Detections" value={formatNumber(data.cryptoDeposits.total)} />
            <MiniStat label="Unmatched Deposits" value={formatNumber(data.cryptoDeposits.unmatched)} danger={data.cryptoDeposits.unmatched > 0} />
            <MiniStat label="Swept" value={formatNumber(data.cryptoDeposits.swept)} />
            <MiniStat label="Direct Credits" value={formatNumber(data.cryptoDeposits.direct)} />
            {data.cryptoDeposits.volumes.map(item => (
              <MiniStat key={`${item.asset}-${item.network}`} label={`${item.asset} · ${item.network}`} value={formatCrypto(item.amount)} />
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <SectionHeader title="Transaction Volume by Product" detail="Successful customer transaction amounts in NGN. Internal transfers are counted once; rewards and admin adjustments are excluded." />
          {volumeSlices.length === 0 ? (
            <div className="mt-4"><EmptyAnalytics label="No successful transaction volume recorded." /></div>
          ) : (
            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-center">
              <div className="space-y-3">
                {data.byType.filter(item => item.volume > 0).map((item, index) => (
                  <div key={item.bucket} className="grid gap-2 sm:grid-cols-[8rem_1fr_7rem] sm:items-center">
                    <div className="text-[10px] font-black uppercase tracking-[.8px] text-[var(--text)]">{titleCase(item.bucket)}</div>
                    <div className="h-3 overflow-hidden bg-[var(--clay)]">
                      <div className="h-full" style={{ width: `${Math.max(1, (item.volume / maxBucketVolume) * 100)}%`, background: getVolumeColor(index) }} />
                    </div>
                    <div className="text-right text-[10px] font-bold text-[var(--muted)]">{formatNgn(item.volume)}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col items-center gap-4">
                <div
                  className="h-40 w-40 rounded-full border border-[var(--border)] shadow-[0_0_40px_rgba(0,0,0,.25)]"
                  style={volumePieStyle}
                  role="img"
                  aria-label={`Pie chart showing product transaction volume totalling ${formatNgn(volumeTotal)}`}
                />
                <div className="grid w-full grid-cols-2 gap-x-3 gap-y-2">
                  {volumeSlices.map((item, index) => (
                    <div key={item.bucket} className="flex min-w-0 items-center gap-1.5" title={`${titleCase(item.bucket)}: ${formatNgn(item.volume)}`}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: getVolumeColor(index) }} />
                      <span className="truncate text-[9px] font-bold text-[var(--muted)]">{titleCase(item.bucket)}</span>
                      <span className="ml-auto text-[9px] font-black text-[var(--text)]">{Math.round(item.volume / volumeTotal * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <SectionHeader title="Provider Reliability" detail="All recorded provider events." />
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
                  <MiniStat label="Unprocessed" value={formatNumber(provider.pending)} />
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
          <SectionHeader title="Latest Transactions" detail="10 newest transactions across all users." />
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
