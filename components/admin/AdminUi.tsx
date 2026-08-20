import type { ReactNode } from 'react'

export function formatNaira(amount: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-NG')
}

export function statusClass(status: string) {
  const normalized = status.toUpperCase()
  if (['SUCCESS', 'PROCESSED', 'ACTIVE', 'VERIFIED', 'APPLIED', 'READ', 'TEMPORARY'].includes(normalized)) {
    return 'bg-[rgba(46,170,92,.12)] text-[var(--green2)]'
  }
  if (['FAILED', 'REJECTED', 'INACTIVE', 'DEACTIVATED', 'ERROR'].includes(normalized)) {
    return 'bg-[rgba(196,52,26,.12)] text-[var(--red2)]'
  }
  if (['PENDING', 'PROCESSING', 'UNREAD'].includes(normalized)) {
    return 'bg-[rgba(245,158,11,.12)] text-[var(--gold2)]'
  }
  return 'bg-[var(--clay2)] text-[var(--text2)]'
}

export function AdminPageCard({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--coal)] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.55)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-[var(--text)]">{title}</h2>
          {description ? <p className="mt-1 text-sm text-[var(--muted)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function AdminTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">{children}</table>
    </div>
  )
}

export function AdminThead({ columns }: { columns: string[] }) {
  return (
    <thead className="bg-[var(--clay)] text-xs uppercase tracking-wide text-[var(--muted)]">
      <tr>
        {columns.map(column => (
          <th key={column} className="px-4 py-3 font-bold">
            {column}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export function AdminStatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>
      {status}
    </span>
  )
}

export function AdminEmpty({ label }: { label: string }) {
  return <div className="p-8 text-center text-sm text-[var(--muted)]">{label}</div>
}

export function AdminError({ message }: { message: string }) {
  return (
    <div className="m-4 rounded-lg border border-[rgba(196,52,26,.28)] bg-[rgba(196,52,26,.08)] p-3 text-sm text-[var(--red2)]">
      {message}
    </div>
  )
}

export function AdminInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-lg border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--gold)] ${props.className ?? ''}`}
    />
  )
}

export function AdminSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-lg border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--gold)] ${props.className ?? ''}`}
    />
  )
}

export function AdminButton({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const styles =
    variant === 'primary'
      ? 'bg-[var(--gold)] text-[var(--char)] hover:brightness-105'
      : 'border border-[var(--border)] bg-[var(--clay)] text-[var(--text2)] hover:border-[var(--gold2)] hover:text-[var(--text)]'
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ''}`}
    >
      {children}
    </button>
  )
}

export { AdminGetForm } from './AdminGetForm'
