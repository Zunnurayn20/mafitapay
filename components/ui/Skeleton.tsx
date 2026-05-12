import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse bg-[var(--clay2)] rounded-none', className)}
      style={{ animation: 'pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite' }}
    />
  )
}

export function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Wallet hero */}
      <div className="bg-[var(--coal)] border border-[var(--border)] p-7 mb-5">
        <Skeleton className="h-4 w-24 mb-4" />
        <Skeleton className="h-14 w-56 mb-3" />
        <Skeleton className="h-6 w-36" />
      </div>
      {/* Quick actions */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {Array.from({length:5}).map((_,i) => <Skeleton key={i} className="h-20" />)}
      </div>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3.5 mb-5">
        {Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-24" />)}
      </div>
    </div>
  )
}

export function TableRowSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({length: rows}).map((_, i) => (
        <tr key={i}>
          <td className="px-4 py-3.5" colSpan={7}>
            <Skeleton className="h-4 w-full" />
          </td>
        </tr>
      ))}
    </>
  )
}
