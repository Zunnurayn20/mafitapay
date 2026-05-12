import Link from 'next/link'

const ADMIN_MODULES = [
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
    <div className="space-y-6">
      <section className="border border-[var(--border)] bg-[var(--coal)] p-5">
        <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">Administration</div>
        <div className="mt-2 text-[16px] font-black text-[var(--text)]">Site Administration</div>
        <div className="mt-2 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
          Select a module below. Each module is isolated so operators are not working inside one oversized page anymore.
        </div>
      </section>

      <section className="overflow-hidden border border-[var(--border)] bg-[var(--coal)]">
        <div className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,20rem)] border-b border-[var(--border)] bg-[rgba(255,255,255,.02)] px-4 py-3 text-[9px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">
          <div>Module</div>
          <div>Purpose</div>
          <div>Includes</div>
        </div>
        {ADMIN_MODULES.map(module => (
          <Link
            key={module.href}
            href={module.href}
            className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,20rem)] gap-4 border-b border-[var(--border)] px-4 py-4 transition-colors last:border-b-0 hover:bg-[rgba(255,255,255,.03)]"
          >
            <div className="text-[12px] font-bold text-[var(--text)]">{module.label}</div>
            <div className="text-[11px] leading-relaxed text-[var(--muted)]">{module.summary}</div>
            <div className="flex flex-wrap gap-2">
              {module.items.map(item => (
                <span
                  key={item}
                  className="border border-[var(--border)] bg-[var(--coal)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.8px] text-[var(--muted)]"
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
