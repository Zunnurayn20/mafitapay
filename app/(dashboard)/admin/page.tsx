'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  Boxes,
  CheckCircle2,
  DatabaseZap,
  Filter,
  HeartPulse,
  Search,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  WalletCards,
} from 'lucide-react'

const PRIORITY_CARDS = [
  {
    href: '/analytics',
    label: 'Analytics',
    value: 'Live',
    detail: 'Money movement, wallet float, user growth, provider reliability, and product mix.',
    Icon: Activity,
    tone: 'text-[var(--green)]',
  },
  {
    href: '/admin/operations/settlements',
    label: 'Settlement Queue',
    value: 'Review',
    detail: 'Deposit intents, payout requests, provider references, retries, and manual resolution.',
    Icon: BadgeDollarSign,
    tone: 'text-[var(--gold2)]',
  },
  {
    href: '/admin/users/kyc',
    label: 'KYC Queue',
    value: 'Verify',
    detail: 'Approve or reject identity submissions before higher-risk account activity.',
    Icon: ShieldCheck,
    tone: 'text-sky-300',
  },
  {
    href: '/admin/operations/events',
    label: 'Provider Events',
    value: 'Inspect',
    detail: 'Webhook failures, pending callbacks, retry queues, and processing state.',
    Icon: RadioTower,
    tone: 'text-[var(--red2)]',
  },
] as const

const MODULE_GROUPS = [
  {
    href: '/admin/operations',
    label: 'Operations',
    summary: 'Operate the live money rails. Review settlement cases, provider events, crypto order execution, and reference support from one area.',
    Icon: DatabaseZap,
    links: [
      { href: '/admin/operations/orders', label: 'Crypto Orders', detail: 'Broadcasts, swaps, receipts, stuck order resolution.' },
      { href: '/admin/operations/settlements', label: 'Settlements', detail: 'Deposits, payouts, manual success/failure, requeues.' },
      { href: '/admin/operations/events', label: 'Provider Events', detail: 'Webhook events, failures, retries, payload inspection.' },
      { href: '/admin/operations/support', label: 'Support Tools', detail: 'Ledger traces, webhook tests, full reference cases.' },
    ],
  },
  {
    href: '/admin/users',
    label: 'Users',
    summary: 'Manage customer risk and access. Inspect KYC, account state, audit activity, wallet control, and user-level investigation paths.',
    Icon: Users,
    links: [
      { href: '/admin/users/kyc', label: 'KYC Queue', detail: 'Identity review and approval decisions.' },
      { href: '/admin/users/accounts', label: 'Accounts', detail: 'Activate, restrict, or review user access.' },
      { href: '/admin/users/audit', label: 'Audit Trail', detail: 'Operator and system activity records.' },
      { href: '/admin', label: 'Wallet Control', detail: 'Use Superuser Control Center for manual wallet actions.' },
    ],
  },
  {
    href: '/admin/catalogs',
    label: 'Catalogs',
    summary: 'Control the products users see. Manage crypto assets, bill provider catalogs, rewards, network providers, and raw configuration.',
    Icon: Boxes,
    links: [
      { href: '/admin/catalogs/assets', label: 'Crypto Assets', detail: 'Pricing, spreads, rails, network asset setup.' },
      { href: '/admin/catalogs/bills', label: 'Bill Providers', detail: 'Airtime, data, utility, cable provider controls.' },
      { href: '/admin/catalogs/rewards', label: 'Reward Rules', detail: 'Referral and bonus campaign configuration.' },
      { href: '/admin/catalogs/raw', label: 'Raw Catalog Data', detail: 'Low-level JSON editors for remaining catalogs.' },
    ],
  },
  {
    href: '/admin/health',
    label: 'Health',
    summary: 'Check readiness before issues become user-facing. Inspect provider health, market data freshness, Base rails, treasury, and executor status.',
    Icon: HeartPulse,
    links: [
      { href: '/admin/health/rails', label: 'Rails', detail: 'Base executor, treasury, 0x, onchain readiness.' },
      { href: '/admin/health/providers', label: 'Providers', detail: 'Flutterwave and provider-side operational health.' },
      { href: '/admin/health/market', label: 'Market', detail: 'Crypto price cache freshness and live feed state.' },
      { href: '/analytics', label: 'Analytics', detail: 'Provider reliability and money movement overview.' },
    ],
  },
] as const

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'operations', label: 'Operations' },
  { value: 'users', label: 'Users' },
  { value: 'catalogs', label: 'Catalogs' },
  { value: 'health', label: 'Health' },
] as const

const WORKFLOW_STEPS = [
  { label: 'Monitor', detail: 'Start from analytics and provider event health.', Icon: Activity },
  { label: 'Investigate', detail: 'Open settlement, provider, or reference cases.', Icon: SlidersHorizontal },
  { label: 'Resolve', detail: 'Requeue, sync, approve, restrict, or manually settle.', Icon: CheckCircle2 },
  { label: 'Audit', detail: 'Confirm traceability through audit logs and ledger records.', Icon: WalletCards },
] as const

function matchesQuery(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase().trim())
}

export default function AdminIndexPage() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all')
  const normalizedQuery = query.trim()

  const visiblePriorityCards = useMemo(() => PRIORITY_CARDS.filter(card => {
    if (!normalizedQuery) return true
    return matchesQuery(`${card.label} ${card.value} ${card.detail}`, normalizedQuery)
  }), [normalizedQuery])

  const visibleModules = useMemo(() => MODULE_GROUPS
    .filter(module => filter === 'all' || module.label.toLowerCase() === filter)
    .map(module => {
      if (!normalizedQuery) return module
      const moduleMatches = matchesQuery(`${module.label} ${module.summary}`, normalizedQuery)
      const links = module.links.filter(link => matchesQuery(`${link.label} ${link.detail}`, normalizedQuery))
      return moduleMatches ? module : { ...module, links }
    })
    .filter(module => {
      if (!normalizedQuery) return true
      return matchesQuery(`${module.label} ${module.summary}`, normalizedQuery) || module.links.length > 0
    }), [filter, normalizedQuery])

  return (
    <div className="space-y-4">
      <section className="overflow-hidden border border-[var(--border)] bg-[var(--coal)]">
        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_.8fr]">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[1.3px] text-[var(--gold2)]">
              <ShieldCheck size={14} />
              Admin Dashboard
            </div>
            <h1 className="mt-2 text-[24px] font-black tracking-tight text-[var(--text)] md:text-[32px]">
              Control room for users, money movement, provider rails, and product catalogs.
            </h1>
            <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
              Use the Superuser Control Center above for instant actions, then use this dashboard to move through the deeper admin modules with a clear operational path.
            </p>
          </div>
          <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recommended workflow</div>
            <div className="mt-3 grid gap-2">
              {WORKFLOW_STEPS.map(step => (
                <div key={step.label} className="grid grid-cols-[1.75rem_1fr] gap-3">
                  <div className="pt-0.5 text-[var(--gold2)]">
                    <step.Icon size={16} />
                  </div>
                  <div>
                    <div className="text-[11px] font-black text-[var(--text)]">{step.label}</div>
                    <div className="mt-0.5 text-[10px] leading-relaxed text-[var(--muted)]">{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border border-[var(--border)] bg-[var(--coal)] p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search admin tools, settlements, users, KYC, providers, catalogs..."
              className="w-full border border-[var(--border)] bg-[var(--clay)] py-3 pl-9 pr-3 text-[11px] font-semibold text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--gold)]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(item => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={`inline-flex items-center gap-1.5 border px-3 py-2 text-[9px] font-bold uppercase tracking-[.9px] transition-colors ${
                  filter === item.value
                    ? 'border-[var(--gold)] bg-[rgba(202,165,96,.14)] text-[var(--gold2)]'
                    : 'border-[var(--border)] bg-[var(--clay)] text-[var(--muted)] hover:border-[var(--gold2)] hover:text-[var(--text)]'
                }`}
              >
                <Filter size={12} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {(normalizedQuery || filter !== 'all') && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]">
            <span>{visibleModules.length} module group{visibleModules.length === 1 ? '' : 's'} matched</span>
            <span>·</span>
            <button type="button" onClick={() => { setQuery(''); setFilter('all') }} className="font-bold text-[var(--gold2)] hover:text-[var(--green2)]">
              Clear filters
            </button>
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {visiblePriorityCards.map(card => (
          <Link
            key={card.href}
            href={card.href}
            className="group border border-[var(--border)] bg-[var(--coal)] p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--gold2)] hover:bg-[rgba(255,255,255,.03)]"
          >
            <div className={`flex items-center gap-2 ${card.tone}`}>
              <card.Icon size={18} />
              <div className="text-[9px] font-black uppercase tracking-[1px]">{card.label}</div>
            </div>
            <div className="mt-3 text-[20px] font-black tracking-tight text-[var(--text)]">{card.value}</div>
            <div className="mt-2 min-h-12 text-[10px] leading-relaxed text-[var(--muted)]">{card.detail}</div>
            <div className="mt-4 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">
              Open
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </section>

      {visiblePriorityCards.length === 0 && visibleModules.length === 0 && (
        <section className="border border-dashed border-[var(--border)] bg-[var(--coal)] p-8 text-center">
          <div className="text-[13px] font-black text-[var(--text)]">No admin tools matched.</div>
          <button type="button" onClick={() => { setQuery(''); setFilter('all') }} className="mt-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">
            Clear search
          </button>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        {visibleModules.map(module => (
          <div key={module.href} className="border border-[var(--border)] bg-[var(--coal)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <div className="pt-0.5 text-[var(--gold2)]">
                  <module.Icon size={20} />
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-black text-[var(--text)]">{module.label}</div>
                  <div className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">{module.summary}</div>
                </div>
              </div>
              <Link href={module.href} className="shrink-0 text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)] hover:text-[var(--green2)]">
                Open Module
              </Link>
            </div>
            <div className="mt-4 grid gap-2">
              {module.links.map(link => (
                <Link
                  key={`${module.label}-${link.href}-${link.label}`}
                  href={link.href}
                  className="grid gap-2 border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5 transition-colors hover:border-[var(--gold2)] sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="text-[11px] font-bold text-[var(--text)]">{link.label}</div>
                  <div className="text-[10px] leading-relaxed text-[var(--muted)]">{link.detail}</div>
                  <ArrowRight size={13} className="text-[var(--gold2)]" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
