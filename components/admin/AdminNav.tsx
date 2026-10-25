'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  Bell,
  Boxes,
  ClipboardCheck,
  Coins,
  DatabaseZap,
  Gift,
  HeartPulse,
  Home,
  Landmark,
  Network,
  Percent,
  RadioTower,
  ShieldCheck,
  Users,
  Wallet,
  Wrench,
  ChevronRight,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { isAdminCryptoPath } from '@/app/(dashboard)/admin/_components/AdminCryptoTabs'

export const ADMIN_NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { href: '/admin', label: 'Overview', icon: Home, exact: true },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Customers',
    items: [
      { href: '/admin/users', label: 'Users', icon: Users, exact: true },
      { href: '/admin/wallets', label: 'Wallets', icon: Wallet },
      { href: '/admin/virtual-accounts', label: 'Virtual accounts', icon: Landmark },
      { href: '/admin/users/kyc', label: 'KYC queue', icon: ShieldCheck },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/admin/transactions', label: 'Transactions', icon: Activity },
      { href: '/admin/finance', label: 'Revenue & expenses', icon: Coins },
      { href: '/admin/adjustments', label: 'Adjustments', icon: ClipboardCheck },
      { href: '/admin/operations/settlements', label: 'Settlements', icon: BadgeDollarSign },
    ],
  },
  {
    label: 'Crypto',
    items: [
      { href: '/admin/operations/orders', label: 'Crypto workspace', icon: Coins },
    ],
  },
  {
    label: 'Products & pricing',
    items: [
      { href: '/admin/pricing', label: 'Data pricing', icon: Percent },
      { href: '/admin/margins', label: 'Transfer margins', icon: BadgeDollarSign },
      { href: '/admin/catalogs/bills', label: 'Bill providers', icon: Boxes },
      { href: '/admin/catalogs/rewards', label: 'Rewards', icon: Gift },
      { href: '/admin/catalogs/raw', label: 'Raw catalogs', icon: DatabaseZap },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/operations/events', label: 'Provider events', icon: DatabaseZap },
      { href: '/admin/operations/support', label: 'Support tools', icon: Wrench },
    ],
  },
  {
    label: 'Monitoring',
    items: [
      { href: '/admin/health/rails', label: 'Rails health', icon: HeartPulse },
      { href: '/admin/health/providers', label: 'Provider health', icon: RadioTower },
      { href: '/admin/health/market', label: 'Market health', icon: Activity },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/notifications', label: 'Notifications', icon: Bell },
      { href: '/admin/referrals', label: 'Referrals', icon: Network },
      { href: '/admin/audit-log', label: 'Audit log', icon: DatabaseZap },
      { href: '/admin/admins', label: 'Admins', icon: ShieldCheck },
    ],
  },
] as const

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminNav() {
  const pathname = usePathname()
  const itemIsActive = (item: (typeof ADMIN_NAV_GROUPS)[number]['items'][number]) => (
    isAdminCryptoPath(pathname) && item.href === '/admin/operations/orders'
  ) || isActive(pathname, item.href, 'exact' in item ? item.exact : false)
  const activeGroup = ADMIN_NAV_GROUPS.find(group => group.items.some(itemIsActive))?.label
  const [openGroups, setOpenGroups] = useState<string[]>(() => activeGroup ? [activeGroup] : [])

  // Navigating directly to a deep URL must reveal its parent group automatically.
  useEffect(() => {
    if (activeGroup) setOpenGroups(current => current.includes(activeGroup) ? current : [...current, activeGroup])
  }, [activeGroup])

  function toggleGroup(label: string) {
    setOpenGroups(current => current.includes(label) ? current.filter(item => item !== label) : [...current, label])
  }

  return (
    <nav
      className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-3 [-webkit-overflow-scrolling:touch] xl:px-0 xl:py-2"
      style={{ scrollbarWidth: 'thin' }}
    >
      {ADMIN_NAV_GROUPS.map(group => (
        <div key={group.label} className="border-b border-[var(--border)] last:border-b-0 xl:border-b-0">
          <button
            type="button"
            onClick={() => toggleGroup(group.label)}
            aria-expanded={openGroups.includes(group.label)}
            className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-bold transition-colors xl:rounded-none xl:px-5 xl:text-[12px] ${
              activeGroup === group.label
                ? 'bg-[rgba(202,165,96,.12)] text-[var(--gold2)]'
                : 'text-[var(--muted)] hover:bg-[var(--clay)] hover:text-[var(--text)]'
            }`}
          >
            <span className="uppercase tracking-[.08em] xl:text-[9px] xl:tracking-[1.4px]">{group.label}</span>
            {openGroups.includes(group.label) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          {openGroups.includes(group.label) && (
            <div className="space-y-1 pb-2 pl-2 xl:pl-0">
              {group.items.map(item => {
            const Icon = item.icon
            const active = itemIsActive(item)

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors xl:rounded-none xl:px-7 xl:py-2 xl:text-[13px] xl:transition-all xl:duration-150 xl:group ${
                  active
                    ? 'bg-[var(--gold)] text-[var(--char)] shadow-[0_8px_20px_-10px_rgba(202,165,96,.55)] xl:border-r-[3px] xl:border-r-[var(--gold)] xl:bg-[rgba(79,70,229,.12)] xl:text-[var(--gold2)] xl:shadow-none'
                    : 'text-[var(--text2)] hover:bg-[var(--clay)] hover:text-[var(--text)]'
                }`}
              >
                <Icon
                  size={17}
                  strokeWidth={1.9}
                  className={active ? 'xl:text-[var(--gold2)]' : 'xl:text-[var(--muted)] xl:group-hover:text-[var(--text2)]'}
                />
                <span className="flex-1 whitespace-nowrap">{item.label}</span>
                {active ? <ChevronRight size={12} className="hidden opacity-60 xl:block xl:text-[var(--gold2)]" /> : null}
              </Link>
            )
              })}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}

export function AdminMobileNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const itemIsActive = (item: (typeof ADMIN_NAV_GROUPS)[number]['items'][number]) => (
    isAdminCryptoPath(pathname) && item.href === '/admin/operations/orders'
  ) || isActive(pathname, item.href, 'exact' in item ? item.exact : false)
  const allItems = ADMIN_NAV_GROUPS.flatMap(group => [...group.items]) as Array<(typeof ADMIN_NAV_GROUPS)[number]['items'][number]>
  const currentItem = allItems.find(itemIsActive)
  const CurrentIcon = currentItem?.icon ?? Home

  return (
    <div className="relative z-40 xl:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="admin-mobile-pages"
        onClick={() => setOpen(value => !value)}
        className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--coal)] px-4 text-left shadow-sm"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[rgba(202,165,96,.12)] text-[var(--gold2)]">
          <CurrentIcon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">Admin pages</span>
          <span className="block truncate text-sm font-semibold text-[var(--text)]">{currentItem?.label ?? 'Choose a page'}</span>
        </span>
        {open ? <X size={18} className="shrink-0 text-[var(--muted)]" /> : <Menu size={18} className="shrink-0 text-[var(--muted)]" />}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close admin page navigation"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[-1] bg-black/50"
          />
          <nav
            id="admin-mobile-pages"
            aria-label="Admin pages"
            className="absolute left-0 right-0 top-[calc(100%+0.5rem)] max-h-[min(68dvh,36rem)] overflow-y-auto overscroll-contain rounded-xl border border-[var(--border)] bg-[var(--coal)] p-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,.85)] [-webkit-overflow-scrolling:touch]"
          >
            {ADMIN_NAV_GROUPS.map(group => (
              <section key={group.label} className="mb-3 last:mb-0">
                <h2 className="px-2 pb-1.5 pt-2 text-[9px] font-bold uppercase tracking-[1.3px] text-[var(--muted)]">{group.label}</h2>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.items.map(item => {
                    const Icon = item.icon
                    const active = itemIsActive(item)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={`flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-[var(--gold)] text-[var(--char)]'
                            : 'text-[var(--text2)] hover:bg-[var(--clay)] hover:text-[var(--text)]'
                        }`}
                      >
                        <Icon size={15} className="shrink-0" />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              </section>
            ))}
          </nav>
        </>
      )}
    </div>
  )
}
