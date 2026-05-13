import { Skeleton } from '@/components/ui/Skeleton'

export function FullScreenAppLoading({
  title = 'Loading MafitaPay',
  detail = 'Preparing your workspace.',
}: {
  title?: string
  detail?: string
}) {
  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md border border-[var(--border)] bg-[var(--coal)] p-8 text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center overflow-hidden">
          <img
            src="/mafitapay-logo.jpg"
            alt="MafitaPay logo"
            className="h-20 w-20 object-contain opacity-90"
          />
        </div>
        <div className="font-display text-2xl font-black text-[var(--text)]">{title}</div>
        <div className="mt-2 text-[11px] uppercase tracking-[1.6px] text-[var(--muted)]">{detail}</div>
        <div className="mt-6 space-y-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6 mx-auto" />
          <Skeleton className="h-3 w-2/3 mx-auto" />
        </div>
      </div>
    </div>
  )
}

export function AuthRouteLoading() {
  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden">
            <img
              src="/mafitapay-logo.jpg"
              alt="MafitaPay logo"
              className="h-20 w-20 object-contain opacity-90"
            />
          </div>
          <Skeleton className="mx-auto h-8 w-40" />
          <Skeleton className="mx-auto mt-3 h-3 w-48" />
        </div>
        <div className="border border-[var(--border)] bg-[var(--coal)]">
          <div className="ank-strip" />
          <div className="space-y-4 p-7">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-3 w-52" />
            <Skeleton className="mt-2 h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardRouteLoading() {
  return (
    <div className="space-y-6">
      <div className="border border-[var(--border)] bg-[var(--coal)] p-7">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-14 w-64" />
        <Skeleton className="mt-3 h-5 w-44" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.95fr)]">
        <div className="space-y-6">
          <Skeleton className="h-72" />
          <Skeleton className="h-80" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-56" />
          <Skeleton className="h-48" />
        </div>
      </div>
    </div>
  )
}

export function AdminRouteLoading() {
  return (
    <div className="min-h-screen bg-[var(--coal)]">
      <div className="grid min-h-screen lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--border)] bg-[linear-gradient(180deg,#0f1118_0%,#121620_100%)] lg:block">
          <div className="space-y-4 px-5 py-5">
            <Skeleton className="h-11 w-40" />
            <Skeleton className="h-16 w-full" />
            <div className="space-y-3 pt-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          </div>
        </aside>
        <div className="min-w-0">
          <div className="border-b border-[var(--border)] bg-[rgba(13,13,20,.94)] px-4 py-4 sm:px-6 lg:px-8">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-3 h-6 w-40" />
            <Skeleton className="mt-2 h-3 w-72" />
          </div>
          <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
            <div className="grid gap-6 xl:grid-cols-2">
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
            </div>
            <Skeleton className="h-96" />
          </div>
        </div>
      </div>
    </div>
  )
}
