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
      { href: '/admin/margins', label: 'Profit margins', icon: Percent },
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
    <nav className="flex gap-2 overflow-x-auto px-3 py-3 scrollbar-none xl:flex-col xl:overflow-visible xl:pb-4">
      {ADMIN_NAV_GROUPS.map(group => (
        <div key={group.label} className="flex gap-2 xl:flex-col">
          <div className="hidden px-3 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 xl:block">
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
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors xl:w-full ${
                  active
                    ? 'bg-[var(--gold)] text-[var(--char)] shadow-[0_8px_20px_-10px_rgba(202,165,96,.55)]'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon size={17} strokeWidth={1.9} />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
