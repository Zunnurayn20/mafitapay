import Link from 'next/link'

const ADMIN_MODULES = [
  {
    href: '/admin/analytics',
    label: 'Analytics',
    summary: 'Track money movement, user growth, wallet float, product mix, and provider reliability.',
    items: ['Volume', 'Wallets', 'Users', 'Provider risk'],
  },
  {
    href: '/admin/catalogs',
    label: 'Catalogs',
    summary: 'Manage crypto assets, reward rules, bill providers, and network catalogs.',
    items: ['Crypto assets', 'Reward rules', 'Bill providers', 'Network providers'],
  },
  {
    href: '/admin/users',
    label: 'Users',
    summary: 'Review customers, KYC, audit history, and account-level investigation data.',
    items: ['Users', 'KYC reviews', 'Audit logs', 'Ledger traces'],
  },
  {
    href: '/admin/operations',
    label: 'Operations',
    summary: 'Handle crypto order execution, settlement cases, provider events, and requeues.',
    items: ['Crypto orders', 'Settlement actions', 'Provider events', 'Manual syncs'],
  },
  {
    href: '/admin/health',
    label: 'Health',
    summary: 'Inspect executor health, provider readiness, market freshness, and treasury status.',
    items: ['Base executor', 'Crypto market', 'Flutterwave rails', 'Treasury balances'],
  },
] as const

export default function AdminIndexPage() {
  return (
    <div className="space-y-4">
      <section className="border border-[var(--border)] bg-[var(--coal)] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">Administration</div>
            <div className="mt-1 text-[16px] font-black text-[var(--text)]">Site Administration</div>
          </div>
          <div className="max-w-xl text-[10px] leading-relaxed text-[var(--muted)]">
            Pick a module or use the superuser cards above for direct operational access.
          </div>
        </div>
      </section>

      <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {ADMIN_MODULES.map(module => (
          <Link
            key={module.href}
            href={module.href}
            className="border border-[var(--border)] bg-[var(--coal)] p-3 transition-all hover:-translate-y-0.5 hover:border-[var(--gold2)] hover:bg-[rgba(255,255,255,.03)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-[12px] font-bold text-[var(--text)]">{module.label}</div>
              <div className="text-[9px] font-bold uppercase tracking-[.8px] text-[var(--gold2)]">Open</div>
            </div>
            <div className="mt-2 line-clamp-2 min-h-8 text-[10px] leading-relaxed text-[var(--muted)]">{module.summary}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {module.items.map(item => (
                <span
                  key={item}
                  className="border border-[var(--border)] bg-[var(--clay)] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[.7px] text-[var(--muted)]"
                >
                  {item}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </section>
    </div>
  )
}
