import Link from 'next/link'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Landmark,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react'
import {
  AdminEmpty,
  AdminPageCard,
  AdminStatusPill,
  AdminTable,
  AdminThead,
  formatDate,
  formatNaira,
} from '@/components/admin/AdminUi'
import { loadAdminOverviewData, requireAdminPageUser } from '@/lib/server/admin-queries'

type MetricTone = 'blue' | 'emerald' | 'amber' | 'slate'

const metricTone: Record<MetricTone, { icon: string; accent: string }> = {
  blue: { icon: 'bg-sky-50 text-sky-700', accent: 'bg-sky-600' },
  emerald: { icon: 'bg-emerald-50 text-emerald-700', accent: 'bg-emerald-600' },
  amber: { icon: 'bg-amber-50 text-amber-700', accent: 'bg-amber-500' },
  slate: { icon: 'bg-slate-100 text-slate-700', accent: 'bg-slate-500' },
}

function Metric({
  label,
  value,
  caption,
  Icon,
  tone,
}: {
  label: string
  value: string | number
  caption: string
  Icon: typeof Users
  tone: MetricTone
}) {
  const colors = metricTone[tone]
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
      <div className={`absolute inset-x-0 top-0 h-1 ${colors.accent}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 break-words text-2xl font-bold text-slate-900 sm:text-[1.7rem]">{value}</div>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colors.icon}`}>
          <Icon size={20} />
        </div>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-slate-500">{caption}</div>
    </div>
  )
}

function MiniMetric({
  label,
  value,
  Icon,
  tone,
}: {
  label: string
  value: string
  Icon: typeof Bell
  tone: MetricTone
}) {
  const colors = metricTone[tone]
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors.icon}`}>
          <Icon size={15} />
        </span>
        {label}
      </div>
      <div className="mt-3 text-xl font-bold text-slate-900">{value}</div>
    </div>
  )
}

export default async function AdminOverviewPage() {
  await requireAdminPageUser()
  const { users, wallets, transactions, stats, liquidity } = await loadAdminOverviewData()

  const walletByUserId = new Map(wallets.map(row => [row.user.id, row.wallet]))
  const userById = new Map(users.map(user => [user.id, user]))
  const recentUsers = users.slice(0, 12)
  const recentTxns = transactions.slice(0, 12)

  const liquidityTone: 'emerald' | 'amber' | 'red' = liquidity.gap == null
    ? 'amber'
    : liquidity.gap >= 0 ? 'emerald' : 'red'
  const liquidityVerdict = liquidity.gap == null
    ? 'Float unavailable'
    : liquidity.gap >= 0
      ? (liquidity.partial ? 'Covered so far' : 'Covered')
      : (liquidity.partial ? 'Gap (incomplete)' : 'Funding gap')
  const liquidityPill = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }[liquidityTone]
  const liquidityValueText = {
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  }[liquidityTone]
  const cryptoTreasuryItems = (liquidity.cryptoTreasury?.conversions ?? []).filter((item: any) => item.ready || item.skipped === 'below_threshold')

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)] sm:px-5">
        <h2 className="text-xl font-bold text-slate-900">Overview</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
          High-level operational health across customers, wallets, transactions, and funding providers.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Users" value={users.length} caption={`${stats.usersToday} joined today`} Icon={Users} tone="blue" />
        <Metric label="Wallet liability" value={formatNaira(stats.walletLiability)} caption="Total customer wallet balance" Icon={Wallet} tone="emerald" />
        <Metric label="Transactions" value={transactions.length} caption={`${stats.pendingTxns} pending, ${stats.failedTxns} failed`} Icon={Activity} tone="amber" />
        <Metric label="Virtual accounts" value={stats.virtualAccounts} caption={`${stats.unprocessedEvents} unprocessed provider events`} Icon={Landmark} tone="slate" />
      </section>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Landmark size={18} className="text-sky-700" />
              <h3 className="font-bold text-slate-900">Liquidity match</h3>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
              Customer wallet liability against every place we hold float — the Flutterwave payout
              rail plus the Amigo and ASBDATA prepaid balances that bills and airtime vend against.
              Liability counts all accounts and includes funds locked mid-payout.
            </p>
          </div>
          <div className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${liquidityPill}`}>
            <ShieldAlert size={16} />
            {liquidityVerdict}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer liability</div>
            <div className="mt-2 font-mono text-xl font-bold text-slate-900">{formatNaira(liquidity.customerLiability)}</div>
            <div className="mt-1 text-xs text-slate-500">Owed across all wallets</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Total float</div>
            <div className="mt-2 font-mono text-xl font-bold text-slate-900">
              {liquidity.providerFloat == null ? 'Unavailable' : formatNaira(liquidity.providerFloat)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {liquidity.providerFloat == null
                ? 'No provider balance could be read'
                : liquidity.partial
                  ? 'At least one provider did not answer'
                  : 'All configured providers'}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Coverage</div>
            <div className={`mt-2 font-mono text-xl font-bold ${liquidityValueText}`}>
              {liquidity.coverage == null ? 'Unknown' : `${liquidity.coverage}%`}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {liquidity.gap == null
                ? 'Connect a provider balance to calculate the gap'
                : `${formatNaira(Math.abs(liquidity.gap))} ${liquidity.gap >= 0 ? 'surplus' : 'short'}`}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">By provider</div>
            <div className="mt-2 space-y-1.5">
              {liquidity.providers.map(entry => (
                <div key={entry.provider} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs text-slate-500">{entry.label}</span>
                  <span
                    className={`shrink-0 font-mono text-xs font-bold ${entry.balance == null ? 'text-slate-400' : 'text-slate-900'}`}
                    title={entry.balance == null ? (entry.message ?? '') : undefined}
                  >
                    {entry.balance == null
                      ? (entry.configured ? 'Error' : 'Off')
                      : formatNaira(entry.balance)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {liquidity.partial && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Float is a floor, not a total — a configured provider did not return a balance, so
            coverage may read lower than reality. Hover a provider marked <strong>Error</strong> for the reason.
          </div>
        )}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Crypto treasury balances</div>
          <p className="mt-1 text-xs text-slate-500">Local BSC and Polygon inventory, separate from the NGN liquidity-match calculation. The quote shows estimated Base USDC if manually converted now.</p>
          {cryptoTreasuryItems.length === 0 ? (
            <div className="mt-2 text-xs text-slate-500">No readable BSC or Polygon treasury balance.</div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {cryptoTreasuryItems.map((item: any) => (
                <div key={item.pairId} className="rounded-md bg-white p-2">
                  <div className="text-[11px] font-bold text-slate-700">{item.pairId}</div>
                  <div className="mt-1 font-mono text-xs font-bold text-slate-900">≈ ${(Number(item.quotedUsdcUnits || 0) / 1_000_000).toFixed(4)} USDC</div>
                  <div className="mt-1 text-[10px] text-slate-500">{Number(item.quotedUsdcUnits || 0) < 20_000_000 ? 'Below auto threshold' : 'Eligible for auto conversion'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <MiniMetric label="Today successful credits" value={formatNaira(stats.todayCredit)} Icon={ArrowDownRight} tone="blue" />
        <MiniMetric label="Today successful debits" value={formatNaira(stats.todayDebit)} Icon={ArrowUpRight} tone="amber" />
        <MiniMetric label="Unread notifications" value={String(stats.unreadNotifications)} Icon={Bell} tone="emerald" />
      </section>

      <AdminPageCard
        title="Recent users"
        description="Newest customer accounts — inline list, same style as Users."
        actions={(
          <Link href="/admin/users" className="text-sm font-semibold text-[#8c6b31] hover:underline">
            View all
          </Link>
        )}
      >
        {recentUsers.length === 0 ? <AdminEmpty label="No users yet." /> : (
          <AdminTable>
            <AdminThead columns={['User', 'Contact', 'Wallet', 'Status', 'Joined']} />
            <tbody className="divide-y divide-slate-200">
              {recentUsers.map(user => {
                const wallet = walletByUserId.get(user.id)
                return (
                  <tr key={user.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{user.name}</div>
                      <div className="text-xs text-slate-500">{user.referralCode}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      <div>{user.phone || 'No phone'}</div>
                      <div>{user.email || 'No email'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                      {formatNaira(wallet?.balance ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <AdminStatusPill status={user.accountStatus} />
                        <AdminStatusPill status={user.kycStatus} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(user.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </AdminTable>
        )}
      </AdminPageCard>

      <AdminPageCard
        title="Recent transactions"
        description="Latest customer activity across the platform."
        actions={(
          <Link href="/admin/transactions" className="text-sm font-semibold text-[#8c6b31] hover:underline">
            View all
          </Link>
        )}
      >
        {recentTxns.length === 0 ? <AdminEmpty label="No transactions yet." /> : (
          <AdminTable>
            <AdminThead columns={['Customer', 'Transaction', 'Amount', 'Status', 'Date']} />
            <tbody className="divide-y divide-slate-200">
              {recentTxns.map(row => {
                const user = userById.get(row.userId)
                const txn = row.transaction
                const isCredit = ['deposit', 'transfer_in', 'crypto_sell', 'referral_bonus', 'reward_bonus', 'admin_credit', 'p2p_deposit'].includes(txn.type)
                return (
                  <tr key={txn.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{user?.name || row.userId}</div>
                      <div className="text-xs text-slate-500">{user?.phone || user?.email || 'No contact'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{txn.description || txn.type}</div>
                      <div className="text-xs text-slate-500">{txn.type} / {txn.reference}</div>
                    </td>
                    <td className={`px-4 py-3 font-mono font-semibold ${isCredit ? 'text-emerald-700' : 'text-red-700'}`}>
                      {isCredit ? '+' : '-'}{formatNaira(txn.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <AdminStatusPill status={txn.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(txn.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </AdminTable>
        )}
      </AdminPageCard>
    </div>
  )
}
