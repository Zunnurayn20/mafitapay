'use client'

import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const LABELS: Record<string, string> = {
  admin: 'Admin',
  adjustments: 'Adjustments',
  admins: 'Admins',
  'audit-log': 'Audit log',
  catalogs: 'Catalogs',
  assets: 'Crypto assets',
  bills: 'Bill providers',
  raw: 'Raw catalogs',
  rewards: 'Rewards',
  health: 'Health',
  rails: 'Rails health',
  providers: 'Provider health',
  market: 'Market health',
  margins: 'Transfer margins',
  notifications: 'Notifications',
  operations: 'Operations',
  orders: 'Crypto orders',
  settlements: 'Settlements',
  events: 'Provider events',
  support: 'Support tools',
  'crypto-deposits': 'Crypto deposits',
  pricing: 'Data pricing',
  'disabled-plans': 'Disabled plans',
  referrals: 'Referrals',
  transactions: 'Transactions',
  users: 'Users',
  accounts: 'Accounts',
  kyc: 'KYC queue',
  audit: 'Audit trail',
  wallets: 'Wallets',
  'virtual-accounts': 'Virtual accounts',
}

function labelFor(segment: string) {
  return LABELS[segment] ?? segment.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

export function AdminBreadcrumbs() {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(false)
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'admin') return null

  return (
    <nav aria-label="Breadcrumb" className="mt-3 flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-xs scrollbar-none">
      {segments.map((segment, index) => {
        const hiddenMiddle = index > 0 && index < segments.length - 1 && !expanded
        if (hiddenMiddle) {
          // Render one compact expansion control in place of all intermediate levels.
          if (index !== 1) return null
          return (
            <div key="collapsed" className="flex shrink-0 items-center gap-1">
              <ChevronRight size={13} className="text-slate-300" />
              <button type="button" onClick={() => setExpanded(true)} className="rounded-md px-2 py-1 font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Show full breadcrumb path">…</button>
            </div>
          )
        }
        const href = `/${segments.slice(0, index + 1).join('/')}`
        const current = index === segments.length - 1
        return (
          <div key={href} className="flex shrink-0 items-center gap-1">
            {index > 0 && <ChevronRight size={13} className="text-slate-300" />}
            {current ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-semibold text-slate-700" aria-current="page">
                {index === 0 && <Home size={12} />}
                {labelFor(segment)}
              </span>
            ) : (
              <Link href={href} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                {index === 0 && <Home size={12} />}
                {labelFor(segment)}
              </Link>
            )}
          </div>
        )
      })}
    </nav>
  )
}
