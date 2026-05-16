'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, LogOut, Menu, ShieldCheck, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { ADMIN_MODULE_TREE } from '@/app/(dashboard)/admin/admin-config'

function getAdminTitle(pathname: string) {
  if (pathname === '/admin') return 'Administration'
  if (pathname.startsWith('/admin/catalogs')) return 'Catalogs'
  if (pathname.startsWith('/admin/users')) return 'Users'
  if (pathname.startsWith('/admin/operations')) return 'Operations'
  if (pathname.startsWith('/admin/health')) return 'Health'
  return 'Administration'
}

function getActiveAdminNode(pathname: string) {
  for (const group of ADMIN_MODULE_TREE) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + '/')) {
        return {
          groupLabel: group.label,
          item,
        }
      }
    }
  }

  return {
    groupLabel: 'Administration',
    item: ADMIN_MODULE_TREE[0]?.items[0] ?? { href: '/admin', label: 'Overview', description: 'Admin workspace' },
  }
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAppStore()
  const activeNode = useMemo(() => getActiveAdminNode(pathname), [pathname])
  const activeGroupLabels = useMemo(() => (
    ADMIN_MODULE_TREE.filter(group => group.items.some(item => pathname === item.href || pathname.startsWith(item.href + '/')))
      .map(group => group.label)
  ), [pathname])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => (
    Object.fromEntries(ADMIN_MODULE_TREE.map(group => [
      group.label,
      group.items.some(item => pathname === item.href || pathname.startsWith(item.href + '/')),
    ]))
  ))

  useEffect(() => {
    setOpenGroups(current => {
      let changed = false
      const next = { ...current }
      for (const label of activeGroupLabels) {
        if (!next[label]) {
          next[label] = true
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [activeGroupLabels])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  function toggleGroup(label: string) {
    setOpenGroups(current => ({
      ...current,
      [label]: !current[label],
    }))
  }

  function renderNavTree(mode: 'desktop' | 'mobile') {
    return ADMIN_MODULE_TREE.map(group => (
      <div key={`${mode}-${group.label}`} className="mb-5 last:mb-0">
        <button
          type="button"
          onClick={() => toggleGroup(group.label)}
          className={`flex w-full items-center justify-between rounded-xl text-left transition-colors hover:bg-[rgba(255,255,255,.03)] ${
            mode === 'desktop' ? 'px-2 py-1.5' : 'px-3 py-2'
          }`}
        >
          <div className="text-[9px] font-bold uppercase tracking-[1.5px] text-[var(--text2)]">
            {group.label}
          </div>
          <div className="text-[var(--text2)]">
            {openGroups[group.label] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </div>
        </button>
        <div className={`space-y-1 overflow-hidden transition-all ${openGroups[group.label] ? 'max-h-[1200px] opacity-100' : 'max-h-0 opacity-0'}`}>
          {group.items.map((item, index) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const isOverview = index === 0
            return (
              <Link
                key={`${mode}-${item.href}`}
                href={item.href}
                className={`block border transition-all ${
                  isOverview
                    ? mode === 'desktop'
                      ? 'px-3 py-2.5'
                      : 'px-3 py-3'
                    : mode === 'desktop'
                      ? 'ml-3 border-l-[3px] px-3 py-3'
                      : 'ml-4 border-l-[3px] px-3 py-3'
                } ${
                  active
                    ? 'border-[rgba(202,165,96,.55)] bg-[linear-gradient(180deg,rgba(202,165,96,.18)_0%,rgba(202,165,96,.10)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,.04)]'
                    : isOverview
                      ? 'border-transparent text-[var(--text2)] hover:border-[var(--border)] hover:bg-[var(--clay)]'
                      : 'border-transparent text-[var(--text2)] hover:border-[var(--border)] hover:bg-[rgba(255,255,255,.02)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {!isOverview && (
                      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[var(--gold2)]' : 'bg-[var(--border2)]'}`} />
                    )}
                    <div className={`text-[11px] font-bold ${active ? 'text-[var(--gold2)]' : 'text-[var(--text)]'}`}>
                      {item.label}
                    </div>
                  </div>
                  <div className={`mt-1 text-[10px] leading-relaxed text-[var(--text2)] ${isOverview ? '' : 'pl-3.5'}`}>
                    {item.description}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    ))
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="grid min-h-screen lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen overflow-hidden border-r border-[var(--border)] bg-[linear-gradient(180deg,var(--panel)_0%,var(--clay)_100%)] lg:flex lg:flex-col">
          <div className="border-b border-[var(--border)] px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.02)]">
                <img
                  src="/mafitapay-logo.jpg"
                  alt="MafitaPay logo"
                  className="h-11 w-11 object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="font-display text-lg font-black text-[var(--text)]">MafitaPay</div>
                <div className="mt-0.5 text-[8px] uppercase tracking-[1.8px] text-[var(--text2)]">Site Administration</div>
              </div>
            </div>
          </div>

          <div className="border-b border-[var(--border)] px-5 py-4">
            <div className="text-[12px] font-bold text-[var(--text)]">{user?.name || 'Administrator'}</div>
            <div className="mt-1 text-[10px] text-[var(--text2)]">{user?.email || 'admin@mafitapay.ng'}</div>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" style={{ scrollbarWidth: 'thin' }}>
            {renderNavTree('desktop')}
          </nav>

          <div className="border-t border-[var(--border)] px-5 py-4">
            <button
              onClick={() => router.push('/dashboard')}
              className="mb-2 flex w-full items-center justify-center gap-2 border border-[var(--border)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text2)] transition-all hover:border-[var(--border2)] hover:text-[var(--text)]"
            >
              <ShieldCheck size={12} />
              Back To App
            </button>
            <button
              onClick={logout}
              className="flex w-full items-center justify-center gap-2 border border-[var(--border)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] transition-all hover:border-[var(--border2)] hover:text-[var(--text2)]"
            >
              <LogOut size={12} />
              Sign Out
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur-xl">
            <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[1.4px] text-[var(--muted)]">Admin Workspace</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]">
                  <Link href="/admin" className="transition-colors hover:text-[var(--text)]">Administration</Link>
                  {activeNode.groupLabel !== 'Administration' && (
                    <>
                  <span className="text-[var(--text2)]">/</span>
                      <Link
                        href={activeNode.item.href.split('/').slice(0, 3).join('/') || '/admin'}
                        className="transition-colors hover:text-[var(--text)]"
                      >
                        {activeNode.groupLabel}
                      </Link>
                    </>
                  )}
                  {activeNode.item.label !== 'Overview' && (
                    <>
                      <span className="text-[var(--text2)]">/</span>
                      <span className="text-[var(--gold2)]">{activeNode.item.label}</span>
                    </>
                  )}
                </div>
                <div className="mt-1 truncate font-display text-[18px] font-black text-[var(--text)]">{getAdminTitle(pathname)}</div>
                <div className="mt-1 max-w-2xl truncate text-[11px] text-[var(--text2)]">{activeNode.item.description}</div>
              </div>
              <div className="lg:hidden">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(current => !current)}
                    className="flex items-center gap-2 border border-[var(--border)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text2)]"
                  >
                    {mobileMenuOpen ? <X size={13} /> : <Menu size={13} />}
                    Admin Menu
                  </button>
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="border border-[var(--border)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text2)]"
                  >
                    Back To App
                  </button>
                </div>
              </div>
            </div>
            {mobileMenuOpen && (
              <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-[var(--border)] px-4 py-4 sm:px-6 lg:hidden" style={{ scrollbarWidth: 'thin' }}>
                <div className="mb-4 flex items-center gap-3 border border-[var(--border)] bg-[var(--panel)] px-3 py-3">
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[rgba(255,255,255,.06)] bg-[rgba(255,255,255,.02)]">
                    <img
                      src="/mafitapay-logo.jpg"
                      alt="MafitaPay logo"
                      className="h-10 w-10 object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-[var(--text)]">{user?.name || 'Administrator'}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--text2)]">{user?.email || 'admin@mafitapay.ng'}</div>
                  </div>
                </div>
                <nav className="space-y-4">
                  {renderNavTree('mobile')}
                </nav>
                <div className="mt-4 grid gap-2">
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="flex w-full items-center justify-center gap-2 border border-[var(--border)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text2)]"
                  >
                    <ShieldCheck size={12} />
                    Back To App
                  </button>
                  <button
                    onClick={logout}
                    className="flex w-full items-center justify-center gap-2 border border-[var(--border)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]"
                  >
                    <LogOut size={12} />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </header>

          <main className="px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl space-y-4">
              <section className="sticky top-[73px] z-20 border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--panel)_90%,transparent)] px-4 py-3 backdrop-blur-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--text2)]">{activeNode.groupLabel}</div>
                    <div className="mt-1 truncate text-[13px] font-bold text-[var(--text)]">{activeNode.item.label}</div>
                  </div>
                  <div className="max-w-xl text-right text-[10px] leading-relaxed text-[var(--text2)]">
                    {activeNode.item.description}
                  </div>
                </div>
              </section>
              <div>{children}</div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
