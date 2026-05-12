'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ADMIN_SECTIONS = [
  { href: '/admin', label: 'Overview', description: 'Administration index and module shortcuts.' },
  { href: '/admin/catalogs', label: 'Catalogs', description: 'Assets, rewards, bill services, and network catalog data.' },
  { href: '/admin/users', label: 'Users', description: 'Users, KYC, audit activity, and ledger traces.' },
  { href: '/admin/operations', label: 'Operations', description: 'Crypto orders, settlements, syncs, and provider actions.' },
  { href: '/admin/health', label: 'Health', description: 'Rail, market, treasury, and provider health checks.' },
] as const

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="space-y-6">
      {pathname === '/admin' && (
        <>
          <section className="border border-[var(--border)] bg-[var(--clay)] p-5">
            <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">Site Administration</div>
            <div className="mt-2 max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
              Use the admin workspace like Django admin: choose a module from the sidebar, then work inside that module on the right. The main app navigation is intentionally removed inside admin.
            </div>
          </section>

          <section className="grid gap-3 lg:grid-cols-5">
            {ADMIN_SECTIONS.map(item => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`border px-4 py-4 transition-all ${
                    active
                      ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)]'
                      : 'border-[var(--border)] bg-[var(--coal)] hover:border-[var(--border2)]'
                  }`}
                >
                  <div className={`text-[11px] font-bold ${active ? 'text-[var(--gold2)]' : 'text-[var(--text)]'}`}>{item.label}</div>
                  <div className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">{item.description}</div>
                </Link>
              )
            })}
          </section>
        </>
      )}

      {children}
    </div>
  )
}
