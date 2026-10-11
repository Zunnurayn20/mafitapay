import Link from 'next/link'

export type AdminCryptoTab = 'orders' | 'deposits' | 'assets'

const TABS: Array<{ id: AdminCryptoTab; label: string; href: string }> = [
  { id: 'orders', label: 'Orders', href: '/admin/operations/orders' },
  { id: 'deposits', label: 'Deposits', href: '/admin/operations/crypto-deposits' },
  { id: 'assets', label: 'Assets & pricing', href: '/admin/catalogs/assets' },
]

export function isAdminCryptoPath(pathname: string) {
  return TABS.some(tab => tab.href === pathname)
}

export function AdminCryptoTabs({ activeTab }: { activeTab: AdminCryptoTab }) {
  return (
    <nav aria-label="Crypto workspace" className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--border)] bg-[var(--coal)] p-1">
      {TABS.map(tab => {
        const active = tab.id === activeTab
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-10 items-center justify-center rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors sm:text-sm ${
              active
                ? 'border border-[rgba(202,165,96,.35)] bg-[rgba(202,165,96,.12)] text-[var(--gold2)]'
                : 'text-[var(--muted)] hover:bg-[var(--clay)] hover:text-[var(--text)]'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
