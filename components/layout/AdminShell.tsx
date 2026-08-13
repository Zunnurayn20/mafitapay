import { ShieldCheck } from 'lucide-react'
import { AdminNav } from '@/components/admin/AdminNav'
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
    <main className="app-scroll min-h-0 flex-1 bg-[#f5f7fb] text-slate-900">
      <div className="mx-auto flex w-full min-h-full flex-col px-3 py-3 sm:px-5 lg:px-6 lg:py-6">
        <header className="shrink-0 rounded-lg border border-slate-200 bg-white shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
          <div className="grid gap-4 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-md bg-[rgba(202,165,96,.16)] px-2.5 py-1 text-xs font-bold text-[#8c6b31]">
                  <ShieldCheck size={14} />
                  Admin Control Center
                </span>
                <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  {roleLabel}
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Operations workspace
              </h1>
              <p className="mt-1 max-w-full truncate text-sm text-slate-500">
                {email || name || 'Administrator'}
              </p>
            </div>

            <AdminShellActions />
          </div>
        </header>

        <div className="grid flex-1 gap-4 py-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--coal)] xl:sticky xl:top-4 xl:flex xl:h-[calc(100vh-2rem)] xl:flex-col xl:self-start">
            <div className="hidden border-b border-[var(--border)] px-5 py-4 xl:block">
              <div className="text-[8px] font-bold uppercase tracking-[1.6px] text-[var(--muted)]">Admin navigation</div>
            </div>
            <AdminNav />
          </aside>

          <section className="min-w-0 pb-6">{children}</section>
        </div>
      </div>
    </main>
  )
}
