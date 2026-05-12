'use client'
import { useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { ArrowDownToLine, Bell, Moon, Search, Send, Sun, X } from 'lucide-react'
import { fmtDate } from '@/lib/utils'

interface TopbarProps {
  title: string
}

export function Topbar({ title }: TopbarProps) {
  const { markNotificationsRead, notifications, theme, toggleTheme, openModal } = useAppStore()
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchVal, setSearchVal] = useState('')
  const unreadCount = notifications.filter(n => !n.read).length
  const visibleNotifications = useMemo(() => notifications.slice(0, 6), [notifications])
  const icons = { success: '✓', error: '✕', info: 'ℹ' } as const

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[rgba(13,13,20,.94)] backdrop-blur-xl">
      <div className="flex min-h-16 flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        {searchOpen ? (
          <div className="order-2 flex basis-full items-center gap-2 border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
            <Search size={14} className="flex-shrink-0 text-[var(--muted)]" />
            <input
              autoFocus
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
              placeholder="Search transactions, services…"
              className="flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
            />
            <button onClick={() => { setSearchOpen(false); setSearchVal('') }}>
              <X size={14} className="text-[var(--muted)] hover:text-[var(--text2)]" />
            </button>
          </div>
        ) : (
          <div className="min-w-0 flex-1 font-display text-[17px] font-black text-[var(--text)]">{title}</div>
        )}

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {!searchOpen && (
            <>
              <button
                onClick={() => openModal('send')}
                className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--clay)] px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text2)] transition-all hover:border-[var(--gold2)] hover:text-[var(--text)]"
              >
                <Send size={11} /> Send
              </button>
              <button
                onClick={() => openModal('deposit')}
                className="flex items-center gap-1.5 bg-[var(--gold)] px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-white transition-all hover:bg-[var(--terra2)]"
              >
                <ArrowDownToLine size={11} /> Deposit
              </button>
            </>
          )}

          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center border border-[var(--border)] bg-[var(--clay)] transition-all hover:border-[var(--gold2)]"
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark'
              ? <Sun size={14} className="text-[var(--text2)]" />
              : <Moon size={14} className="text-[var(--text2)]" />}
          </button>

          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-9 items-center justify-center border border-[var(--border)] bg-[var(--clay)] transition-all hover:border-[var(--gold2)]"
          >
            <Search size={14} className="text-[var(--text2)]" />
          </button>

          <div className="relative">
            <button
              onClick={() => setNotifOpen(o => !o)}
              className="relative flex h-9 w-9 items-center justify-center border border-[var(--border)] bg-[var(--clay)] transition-all hover:border-[var(--gold2)]"
            >
              <Bell size={14} className="text-[var(--text2)]" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--coal)] bg-[var(--red2)] text-[7px] font-bold leading-none text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(20rem,calc(100vw-2rem))] border border-[var(--border)] bg-[var(--coal)] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <div className="text-[12px] font-bold text-[var(--text)]">Notifications</div>
                  <button
                    onClick={async () => {
                      await markNotificationsRead()
                      setNotifOpen(false)
                    }}
                    className="text-[10px] font-bold text-[var(--gold2)] hover:text-[var(--text)]"
                  >
                    Mark all read
                  </button>
                </div>

                {visibleNotifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[11px] text-[var(--muted)]">
                    No notifications yet.
                  </div>
                ) : visibleNotifications.map(n => (
                  <div
                    key={n.id}
                    onClick={() => setNotifOpen(false)}
                    className={`flex cursor-pointer items-start gap-3 border-b border-[var(--border)] px-4 py-3.5 transition-colors last:border-0 hover:bg-[var(--clay)] ${!n.read ? 'bg-[rgba(79,70,229,.04)]' : ''}`}
                  >
                    <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--clay)] text-[12px]">{icons[n.type]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold leading-snug text-[var(--text)]">{n.title}</div>
                      <div className="mt-0.5 text-[10px] leading-snug text-[var(--text2)]">{n.message}</div>
                      <div className="mt-1 text-[9px] text-[var(--muted)]">{fmtDate(n.createdAt)}</div>
                    </div>
                    {!n.read && <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--gold2)]" />}
                  </div>
                ))}

                <div className="px-4 py-3 text-center">
                  <span className="cursor-pointer text-[10px] font-bold text-[var(--gold2)] hover:text-[var(--text)]">View all notifications →</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
