import { AdminNav } from '@/components/admin/AdminNav'
import { AdminBreadcrumbs } from '@/components/admin/AdminBreadcrumbs'
import { AdminShellActions } from '@/components/layout/AdminShellActions'

export function AdminShell({
  children,
  email,
  name,
  isAdmin,
}: {
  children: React.ReactNode
  email?: string | null
  name?: string | null
  isAdmin?: boolean
}) {
  const roleLabel = isAdmin ? 'Owner / Superuser' : 'Operator'

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto flex h-full min-h-0 w-full flex-1 flex-col px-3 py-3 sm:px-5 lg:px-6 lg:py-6">
        <header className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--coal)] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.55)]">
          <div className="grid gap-4 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-[rgba(202,165,96,.12)] px-2.5 py-1 text-xs font-bold text-[var(--gold2)]">
                  {roleLabel}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)] sm:text-3xl">
                Operations workspace
              </h1>
              <p className="mt-1 max-w-full truncate text-sm text-[var(--muted)]">
                {email || name || 'Administrator'}
              </p>
              <AdminBreadcrumbs />
            </div>

            <AdminShellActions />
          </div>
        </header>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto xl:grid xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-4 xl:overflow-hidden">
          <aside className="min-h-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--coal)] xl:flex xl:h-full xl:flex-col">
            <div className="hidden shrink-0 border-b border-[var(--border)] px-5 py-4 xl:block">
              <div className="text-[8px] font-bold uppercase tracking-[1.6px] text-[var(--muted)]">Admin navigation</div>
            </div>
            <AdminNav />
          </aside>

          <section className="min-w-0 pb-6 xl:min-h-0 xl:overflow-y-auto">{children}</section>
        </div>
      </div>
    </main>
  )
}
