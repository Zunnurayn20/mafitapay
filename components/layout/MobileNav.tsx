'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ClipboardList, Zap, UserCircle } from 'lucide-react'

const TABS = [
  { href: '/dashboard', label: 'Home',    Icon: LayoutDashboard },
  { href: '/history',   label: 'History', Icon: ClipboardList },
  { href: '/crypto',    label: 'Crypto',  Icon: Zap },
  { href: '/profile',   label: 'Profile', Icon: UserCircle },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none lg:hidden">
      <div className="mx-auto w-full max-w-7xl px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3">
        <div className="pointer-events-auto mb-2 flex h-[3.75rem] items-center justify-around rounded-full border border-[rgba(202,165,96,.28)] bg-[var(--coal)] px-2 shadow-[0_10px_28px_-10px_rgba(0,0,0,.45)]">
          {TABS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                prefetch
                className={`relative flex h-12 min-w-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-full px-2 transition-all duration-200 ${
                  active
                    ? 'bg-[rgba(202,165,96,.16)] text-[var(--gold2)]'
                    : 'text-[var(--muted)] hover:text-[var(--text2)]'
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                <span className={`text-[9px] uppercase tracking-wide ${active ? 'font-bold' : 'font-semibold'}`}>
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
