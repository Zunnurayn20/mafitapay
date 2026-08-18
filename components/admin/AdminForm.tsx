import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Themed form primitives for the admin surface.
 *
 * Deliberately hook-free and stateless so this file needs no 'use client' directive and can be
 * rendered from either side of the boundary. Anything stateful (disclosure open/closed) is
 * controlled by the caller, which lets these bind to state the admin sections already own.
 *
 * Every colour is a CSS token from app/globals.css, so the whole kit follows the user's theme
 * toggle instead of pinning itself light.
 */

const controlClass =
  'w-full rounded-lg border bg-[var(--clay)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50'

const controlTone = (error?: string) =>
  error
    ? 'border-[var(--red2)] focus:border-[var(--red2)]'
    : 'border-[var(--border)] focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold-soft)]'

function formatRate(value: number) {
  return `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
}

type FieldShell = {
  label: string
  hint?: ReactNode
  error?: string
  required?: boolean
  /** Applied to the field wrapper — use for grid spans, not for styling the control. */
  className?: string
}

/**
 * Label + control + hint. Wraps the control in the <label> so association needs no generated id
 * (and therefore no useId, keeping this file hook-free).
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldShell & { children: ReactNode }) {
  return (
    <label className={cn('flex min-w-0 flex-col', className)}>
      <span className="text-xs font-semibold text-[var(--text2)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--red2)]">*</span>}
      </span>
      <span className="mt-1.5 block">{children}</span>
      {error ? (
        <span className="mt-1.5 block text-xs text-[var(--red2)]">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs leading-relaxed text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  )
}

export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...props
}: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      <input {...props} className={cn(controlClass, controlTone(error))} />
    </Field>
  )
}

export function NumberField(
  props: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'>,
) {
  return <TextField {...props} type="number" />
}

/** Number input with a ₦ affix — for margins and fees, so the unit is not buried in the label. */
export function MoneyField({
  label,
  hint,
  error,
  required,
  className,
  ...props
}: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      <span
        className={cn(
          'flex overflow-hidden rounded-lg border bg-[var(--clay)] transition-colors',
          error
            ? 'border-[var(--red2)]'
            : 'border-[var(--border)] focus-within:border-[var(--gold)] focus-within:ring-1 focus-within:ring-[var(--gold-soft)]',
        )}
      >
        <span className="flex items-center border-r border-[var(--border)] bg-[var(--clay2)] px-3 text-sm font-bold text-[var(--gold2)]">
          ₦
        </span>
        <input
          {...props}
          type="number"
          className="w-full min-w-0 bg-transparent px-3 py-2.5 text-sm font-semibold text-[var(--text)] outline-none placeholder:font-normal placeholder:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
        />
      </span>
    </Field>
  )
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...props
}: FieldShell & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      <select {...props} className={cn(controlClass, controlTone(error), 'cursor-pointer')}>
        {children}
      </select>
    </Field>
  )
}

export function ToggleField({
  label,
  hint,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: string
  hint?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--clay)] p-3 transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-[var(--border2)]',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--gold)]"
      />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[var(--text)]">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted)]">{hint}</span>}
      </span>
    </label>
  )
}

/** Non-editable value shown in the same visual language as a real field (pair IDs, derived rates). */
export function ReadOnlyField({
  label,
  value,
  hint,
  mono = true,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <span className="text-xs font-semibold text-[var(--text2)]">{label}</span>
      <div
        className={cn(
          'mt-1.5 truncate rounded-lg border border-[var(--border)] bg-[var(--coal)] px-3 py-2.5 text-sm text-[var(--text)]',
          mono && 'font-mono',
        )}
      >
        {value}
      </div>
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-[var(--muted)]">{hint}</span>}
    </div>
  )
}

export function FormSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('border-t border-[var(--border)] pt-5 first:border-t-0 first:pt-0', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gold)]" />
            {title}
          </h4>
          {description && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function FieldGrid({
  columns = 3,
  children,
  className,
}: {
  columns?: 2 | 3 | 4
  children: ReactNode
  className?: string
}) {
  const cols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  }[columns]
  return <div className={cn('grid gap-4', cols, className)}>{children}</div>
}

/**
 * Controlled collapsible. `open`/`onToggle` are props rather than internal state so callers can
 * drive it from state they already have.
 */
export function Disclosure({
  open,
  onToggle,
  title,
  summary,
  children,
  className,
}: {
  open: boolean
  onToggle: () => void
  title: string
  summary?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--clay)]', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--clay2)]"
      >
        <span className="min-w-0">
          <span className="block text-xs font-bold text-[var(--text)]">{title}</span>
          {summary && <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted)]">{summary}</span>}
        </span>
        <span
          aria-hidden="true"
          className={cn('shrink-0 text-xs text-[var(--gold2)] transition-transform', open && 'rotate-180')}
        >
          ▾
        </span>
      </button>
      {open && <div className="border-t border-[var(--border)] p-4">{children}</div>}
    </div>
  )
}

const calloutTones = {
  info: 'border-[var(--gold-soft)] bg-[var(--gold-tint)] text-[var(--text)]',
  warn: 'border-[rgba(245,158,11,.28)] bg-[rgba(245,158,11,.08)] text-[var(--text)]',
  danger: 'border-[rgba(196,52,26,.28)] bg-[rgba(196,52,26,.08)] text-[var(--text)]',
}

export function Callout({
  tone = 'info',
  children,
  className,
}: {
  tone?: keyof typeof calloutTones
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-xs leading-relaxed', calloutTones[tone], className)}>
      {children}
    </div>
  )
}

function RateCell({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div
        className={cn(
          'mt-1 truncate font-mono text-sm font-bold',
          emphasis ? 'text-[var(--gold2)]' : 'text-[var(--text)]',
        )}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Live mid → customer buy → customer sell. Shared by the create and edit paths so both show the
 * same three numbers computed the same way.
 */
export function RatePreview({
  usdNgn,
  buyFx,
  sellFx,
  note,
  emptyLabel = '—',
  className,
}: {
  usdNgn: number
  buyFx: number
  sellFx: number
  note?: ReactNode
  emptyLabel?: string
  className?: string
}) {
  const show = (value: number) => (value > 0 ? `${formatRate(value)} / $1` : emptyLabel)
  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--gold-soft)] bg-[var(--gold-tint)] p-3.5',
        className,
      )}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <RateCell
          label="Live mid rate"
          value={usdNgn > 0 ? show(usdNgn) : 'Waiting for live price…'}
        />
        <RateCell label="Customer buys at" value={show(buyFx)} emphasis />
        <RateCell label="Customer sells at" value={show(sellFx)} />
      </div>
      {note && (
        <p className="mt-3 border-t border-[var(--gold-soft)] pt-2.5 text-xs leading-relaxed text-[var(--gold2)]">
          {note}
        </p>
      )}
    </div>
  )
}
