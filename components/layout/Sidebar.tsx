'use client'
import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAppStore } from '@/store'
import {
  LayoutDashboard, ClipboardList, ArrowLeftRight, Zap,
  Receipt, Users, UserCircle, ShieldCheck, LogOut, ChevronRight
} from 'lucide-react'

const SEEN_TRANSACTION_BADGE_KEY = 'mafitapay-history-badge-seen'

const NAV = [
  { section: 'Main', items: [
    { href: '/dashboard',  label: 'Dashboard',     Icon: LayoutDashboard },
    { href: '/history',    label: 'Transactions',  Icon: ClipboardList },
    { href: '/p2p',        label: 'P2P Market',    Icon: ArrowLeftRight },
    { href: '/crypto',     label: 'Crypto',        Icon: Zap },
    { href: '/crypto/orders', label: 'Crypto Orders', Icon: ClipboardList },
  ]},
  { section: 'Services', items: [
    { href: '/bills',      label: 'Bills & Airtime', Icon: Receipt },
    { href: '/referrals',  label: 'Referrals',       Icon: Users },
  ]},
  { section: 'Account', items: [
    { href: '/profile',    label: 'Profile',         Icon: UserCircle },
    { href: '/kyc',        label: 'KYC Verification', Icon: ShieldCheck },
    { href: '/security',   label: 'Security',         Icon: ShieldCheck },
  ]},
]

export function Sidebar() {
  const pathname  = usePathname()
  const { user, wallet, logout, transactions } = useAppStore()
  const adminEmail = (process.env.NEXT_PUBLIC_MAFITAPAY_ADMIN_EMAIL ?? 'aminu@mafitapay.ng').toLowerCase()
  const isAdmin = (user?.email ?? '').toLowerCase() === adminEmail
  const [seenPendingTransactionIds, setSeenPendingTransactionIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(SEEN_TRANSACTION_BADGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
    } catch {
      return []
    }
  })
  const pendingTransactions = transactions.filter(item => item.status === 'pending' || item.status === 'processing')
  const pendingTransactionIds = pendingTransactions.map(item => item.id)
  const pendingTransactionCount = pendingTransactionIds.filter(id => !seenPendingTransactionIds.includes(id)).length
  const navGroups = isAdmin
    ? [
        ...NAV,
        { section: 'Admin', items: [{ href: '/admin', label: 'Admin', Icon: ShieldCheck }] },
      ]
    : NAV

  function acknowledgePendingTransactions() {
    if (pendingTransactionIds.length === 0) return
    const nextSeenIds = Array.from(new Set([...seenPendingTransactionIds, ...pendingTransactionIds]))
    setSeenPendingTransactionIds(nextSeenIds)
    try {
      window.localStorage.setItem(SEEN_TRANSACTION_BADGE_KEY, JSON.stringify(nextSeenIds))
    } catch {}
  }

  const ngnFmt = wallet
    ? '₦' + Math.floor(wallet.balance).toLocaleString('en-NG')
    : '—'

  return (
    <aside className="sticky top-0 flex h-screen min-h-screen flex-col border-r border-[var(--border)] bg-[var(--coal)]">
      <div className="ank-strip" />

      {/* Logo */}
      <div className="px-5 py-5 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center flex-shrink-0 overflow-hidden">
            <img
              src="/mafitapay-logo.jpg"
              alt="MafitaPay logo"
              className="h-11 w-11 object-contain"
            />
          </div>
          <div>
            <div className="font-display font-black text-xl text-[var(--text)]">MafitaPay</div>
            <div className="text-[8px] text-[var(--muted)] tracking-widest uppercase mt-0.5">Digital Finance</div>
          </div>
        </div>
      </div>

      {/* User */}
      <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-[var(--clay2)] border-2 border-[var(--gold)] flex items-center justify-center font-display font-black text-sm text-[var(--gold)] flex-shrink-0">A</div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-[var(--text)] truncate">{user?.name || 'Account User'}</div>
          <div className="text-[9px] text-[var(--muted)] font-mono">{user?.handle || '@mafitapay'}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {navGroups.map(group => (
          <div key={group.section}>
            <div className="text-[8px] font-bold uppercase tracking-[1.6px] text-[var(--muted)] px-5 pt-4 pb-1.5">
              {group.section}
            </div>
            {group.items.map(({ href, label, Icon }) => {
              const active = href === '/crypto'
                ? pathname === href
                : pathname === href || pathname.startsWith(href + '/')
              const badge = href === '/history' && pendingTransactionCount > 0
                ? String(pendingTransactionCount)
                : ''
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch
                  onClick={() => {
                    if (href === '/history') acknowledgePendingTransactions()
                  }}
                  className={[
                    'flex w-full items-center gap-3 border-none bg-transparent px-5 py-2.5 text-left text-[13px] font-semibold transition-all duration-150 group',
                    active
                      ? 'bg-[rgba(79,70,229,.12)] text-[var(--gold2)] border-r-[3px] border-r-[var(--gold)]'
                      : 'text-[var(--text2)] hover:bg-[var(--clay)] hover:text-[var(--text)]',
                  ].join(' ')}
                >
                  <Icon
                    size={15}
                    className={active ? 'text-[var(--gold2)]' : 'text-[var(--muted)] group-hover:text-[var(--text2)]'}
                  />
                  <span className="flex-1">{label}</span>
                  {badge && (
                    <span className="bg-[var(--gold)] text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                      {badge}
                    </span>
                  )}
                  {!badge && active && <ChevronRight size={12} className="text-[var(--gold2)] opacity-60" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Balance pill */}
      <div className="px-5 py-4 border-t border-[var(--border)]">
        <div className="bg-[var(--clay)] border border-[var(--border)] p-3.5 mb-2">
          <div className="text-[8px] text-[var(--muted)] uppercase tracking-[1px] mb-1.5">NGN Balance</div>
          <div className="font-display font-black text-[21px] text-[var(--text)]">
            {ngnFmt}
          </div>
          <div className="text-[10px] text-[var(--muted)] mt-1">Crypto orders debit your wallet balance directly.</div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold text-[var(--muted)] border border-[var(--border)] uppercase tracking-wide hover:border-[var(--border2)] hover:text-[var(--text2)] transition-all"
        >
          <LogOut size={11} />
          Sign Out
        </button>
      </div>

      <div className="ank-strip" style={{ height: '3px' }} />
    </aside>
  )
}
