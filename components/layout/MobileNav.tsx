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
        <div className="pointer-events-auto mb-2 flex h-16 items-center justify-around rounded-2xl border border-[var(--border)] bg-[var(--coal)] px-1 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.35)]">
          {TABS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                prefetch
                className={`relative flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-200 ${
                  active ? 'text-[var(--gold2)]' : 'text-[var(--muted)] hover:text-[var(--text2)]'
                }`}
              >
                {active ? (
                  <span className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-[var(--gold2)]" />
                ) : null}
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
