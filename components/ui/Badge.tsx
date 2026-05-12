import { cn } from '@/lib/utils'

type BadgeVariant = 'success' | 'pending' | 'failed' | 'info'

const variants: Record<BadgeVariant, string> = {
  success: 'badge-success',
  pending: 'badge-pending',
  failed:  'badge-failed',
  info:    'bg-[rgba(79,70,229,.1)] border-[rgba(99,102,241,.3)] text-[var(--gold2)]',
}

export function Badge({ variant = 'success', children, className }: { variant?: BadgeVariant; children: React.ReactNode; className?: string }) {
  return <span className={cn('badge', variants[variant], className)}>{children}</span>
}
