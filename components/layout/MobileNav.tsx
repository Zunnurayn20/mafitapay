'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ClipboardList, Zap, UserCircle } from 'lucide-react'
import { tapFeedback } from '@/lib/client/native-haptics'

const TABS = [
  { href: '/dashboard', label: 'Home',    Icon: LayoutDashboard },
  { href: '/history',   label: 'History', Icon: ClipboardList },
  { href: '/crypto',    label: 'Crypto',  Icon: Zap },
  { href: '/profile',   label: 'Profile', Icon: UserCircle },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Primary" className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none lg:hidden">
      <div className="mx-auto w-full max-w-7xl pb-[var(--app-mobile-nav-inset)] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] sm:pl-[max(0.75rem,env(safe-area-inset-left))] sm:pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="pointer-events-auto mb-[var(--app-mobile-nav-gap)] flex h-[var(--app-mobile-nav-pill)] items-center justify-around rounded-full border border-[var(--gold-soft)] bg-[var(--coal)] px-2 shadow-[0_10px_28px_-10px_rgba(0,0,0,.45)]">
          {TABS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                prefetch
                onClick={tapFeedback}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-12 min-w-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-full px-2 transition-colors duration-200 ${
                  active
                    ? 'bg-[var(--gold-tint)] text-[var(--gold2)]'
                    : 'text-[var(--text2)] hover:text-[var(--text)]'
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute left-1/2 top-0 h-[3px] -translate-x-1/2 rounded-full bg-[var(--gold)] transition-all duration-200 ${
                    active ? 'w-5 opacity-100' : 'w-0 opacity-0'
                  }`}
                />
                <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                <span className={`text-[11px] leading-none ${active ? 'font-bold' : 'font-semibold'}`}>
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
