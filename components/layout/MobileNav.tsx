'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ClipboardList, ArrowLeftRight, Zap, Receipt } from 'lucide-react'

const TABS = [
  { href: '/dashboard', label: 'Home',    Icon: LayoutDashboard },
  { href: '/history',   label: 'History', Icon: ClipboardList },
  { href: '/p2p',       label: 'P2P',     Icon: ArrowLeftRight },
  { href: '/crypto',    label: 'Crypto',  Icon: Zap },
  { href: '/bills',     label: 'Bills',   Icon: Receipt },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-[var(--coal)] lg:hidden">
      <div className="ank-strip" style={{ height: '3px' }} />
      <div className="flex pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                active ? 'text-[var(--gold2)]' : 'text-[var(--muted)] hover:text-[var(--text2)]'
              }`}
            >
              <Icon size={18} />
              <span className="text-[9px] font-bold uppercase tracking-wide">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
