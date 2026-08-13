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
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  ChevronRight,
} from 'lucide-react'

/** Online-data-sub models first, then MafitaPay-specific tools. */
export const ADMIN_NAV_GROUPS = [
  {
    label: 'Models',
    items: [
      { href: '/admin', label: 'Overview', icon: Home, exact: true },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/admin/users', label: 'Users', icon: Users, exact: true },
      { href: '/admin/transactions', label: 'Transactions', icon: Activity },
      { href: '/admin/wallets', label: 'Wallets', icon: Wallet },
      { href: '/admin/adjustments', label: 'Adjustments', icon: ClipboardCheck },
      { href: '/admin/virtual-accounts', label: 'Virtual accounts', icon: Landmark },
      { href: '/admin/provider-events', label: 'Provider events', icon: DatabaseZap },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell },
      { href: '/admin/referrals', label: 'Referrals', icon: Network },
      { href: '/admin/audit-log', label: 'Audit log', icon: DatabaseZap },
      { href: '/admin/admins', label: 'Admins', icon: ShieldCheck },
    ],
  },
  {
    label: 'MafitaPay',
    items: [
      { href: '/admin/users/kyc', label: 'KYC queue', icon: ShieldCheck },
      { href: '/admin/operations/settlements', label: 'Settlements', icon: BadgeDollarSign },
      { href: '/admin/operations/orders', label: 'Crypto orders', icon: Coins },
      { href: '/admin/operations/crypto-deposits', label: 'Crypto deposits', icon: Landmark },
      { href: '/admin/operations/support', label: 'Support tools', icon: Wrench },
      { href: '/admin/catalogs/assets', label: 'Crypto assets', icon: TrendingUp },
      { href: '/admin/pricing', label: 'Data pricing', icon: Percent },
      { href: '/admin/margins', label: 'Transfer margins', icon: BadgeDollarSign },
      { href: '/admin/catalogs/bills', label: 'Bill providers', icon: Boxes },
      { href: '/admin/catalogs/rewards', label: 'Rewards', icon: Gift },
      { href: '/admin/catalogs/raw', label: 'Raw catalogs', icon: DatabaseZap },
      { href: '/admin/health/rails', label: 'Rails health', icon: HeartPulse },
      { href: '/admin/health/providers', label: 'Provider health', icon: RadioTower },
      { href: '/admin/health/market', label: 'Market health', icon: Activity },
    ],
  },
] as const

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav
      className="flex gap-2 overflow-x-auto overscroll-x-contain px-3 py-3 scrollbar-none [-webkit-overflow-scrolling:touch] xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-y-auto xl:overflow-x-hidden xl:px-0 xl:py-2"
      style={{ scrollbarWidth: 'thin' }}
    >
      {ADMIN_NAV_GROUPS.map(group => (
        <div key={group.label} className="flex gap-2 xl:flex-col">
          <div className="hidden px-5 pb-1.5 pt-4 text-[8px] font-bold uppercase tracking-[1.6px] text-[var(--muted)] xl:block">
            {group.label}
          </div>
          {group.items.map(item => {
            const Icon = item.icon
            const active = isActive(pathname, item.href, 'exact' in item ? item.exact : false)

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors xl:w-full xl:rounded-none xl:px-5 xl:py-2.5 xl:text-[13px] xl:transition-all xl:duration-150 xl:group ${
                  active
                    ? 'bg-[var(--gold)] text-[var(--char)] shadow-[0_8px_20px_-10px_rgba(202,165,96,.55)] xl:border-r-[3px] xl:border-r-[var(--gold)] xl:bg-[rgba(79,70,229,.12)] xl:text-[var(--gold2)] xl:shadow-none'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 xl:text-[var(--text2)] xl:hover:bg-[var(--clay)] xl:hover:text-[var(--text)]'
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
      ))}
    </nav>
  )
}
