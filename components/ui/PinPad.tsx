'use client'
import { useState } from 'react'
import { Delete, Fingerprint } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PinPadProps {
  length?: number
  onComplete: (pin: string) => void
  title?: string
  subtitle?: string
  /**
   * Rows shown above the keypad — what is being authorised, in full. Lets a caller fold a
   * separate review step into this screen instead of making the user confirm twice.
   */
  details?: Array<{ label: string; value: string; emphasis?: boolean }>
  /** Rendered under the details, e.g. an "Edit" affordance back to the form. */
  footer?: React.ReactNode
  secondaryActionLabel?: string
  secondaryActionIconOnly?: boolean
  onSecondaryAction?: () => void
  secondaryActionPending?: boolean
  /** Native Android fingerprint / face (Capacitor), shown left of 0 */
  onBiometric?: () => void
  biometricBusy?: boolean
}

export function PinPad({
  length = 4,
  onComplete,
  title = 'Enter PIN',
  subtitle,
  details,
  footer,
  secondaryActionLabel,
  secondaryActionIconOnly = false,
  onSecondaryAction,
  secondaryActionPending = false,
  onBiometric,
  biometricBusy = false,
}: PinPadProps) {
  const [pin, setPin] = useState('')

  const addDigit = (d: number) => {
    if (biometricBusy) return
    if (pin.length >= length) return
    const next = pin + d
    setPin(next)
    if (next.length === length) setTimeout(() => onComplete(next), 300)
  }

  const del = () => {
    if (biometricBusy) return
    setPin(p => p.slice(0, -1))
  }

  const keys = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    onBiometric ? 'bio' : '',
    '0',
    'back',
  ]

  return (
    <div className="p-5">
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--clay)]">
        <div className="border-b border-[var(--border)] bg-[linear-gradient(135deg,rgba(202,165,96,.12),rgba(79,70,229,.06))] px-5 py-5 text-center">
          <div className="mb-2 text-[9px] uppercase tracking-[1.4px] text-[var(--muted)]">{title}</div>
          {subtitle && (
            <div className="mx-auto max-w-[24rem] text-[13px] leading-relaxed text-[var(--text2)]">{subtitle}</div>
          )}
          <div className="mt-5 flex justify-center gap-3">
            {Array.from({ length }).map((_, i) => (
              <div key={i} className={cn('pin-dot', i < pin.length && 'filled')} />
            ))}
          </div>
          <div className="mt-3 text-[10px] text-[var(--muted)]">
            {onBiometric
              ? pin.length === 0
                ? 'Enter your PIN, or use fingerprint / face.'
                : `${pin.length}/${length} digits entered`
              : pin.length === 0
                ? 'Enter your 4-digit transaction PIN.'
                : `${pin.length}/${length} digits entered`}
          </div>
        </div>

        {details && details.length > 0 && (
          <div className="border-b border-[var(--border)]">
            {details.map(row => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[11px] last:border-0"
              >
                <span className="shrink-0 text-[var(--muted)]">{row.label}</span>
                <span className={cn(
                  'truncate text-right font-mono',
                  row.emphasis ? 'font-bold text-[var(--gold2)]' : 'text-[var(--text)]',
                )}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 p-3">
          {keys.map((k, i) => {
            if (k === '') return <div key={i} className="h-14" />

            if (k === 'bio') {
              return (
                <button
                  key={i}
                  type="button"
                  onClick={onBiometric}
                  disabled={biometricBusy}
                  className="flex h-14 items-center justify-center rounded-2xl border border-[rgba(202,165,96,.28)] bg-[rgba(202,165,96,.12)] text-[var(--gold2)] transition-all active:scale-95 disabled:opacity-60"
                  aria-label="Confirm with fingerprint or face"
                >
                  <Fingerprint size={24} strokeWidth={1.75} className={biometricBusy ? 'animate-pulse' : ''} />
                </button>
              )
            }

            if (k === 'back') {
              return (
                <button
                  key={i}
                  type="button"
                  onClick={del}
                  disabled={pin.length === 0 || biometricBusy}
                  className="flex h-14 items-center justify-center rounded-2xl text-[var(--muted)] transition-colors active:bg-[var(--clay2)] disabled:opacity-40"
                  aria-label="Backspace"
                >
                  <Delete size={20} strokeWidth={1.75} />
                </button>
              )
            }

            return (
              <button
                key={i}
                type="button"
                onClick={() => addDigit(Number(k))}
                disabled={biometricBusy}
                className="h-14 rounded-2xl border border-[var(--border)] bg-[var(--coal)] font-display text-xl font-semibold text-[var(--text)] shadow-[0_2px_8px_rgba(0,0,0,.12)] transition-all active:scale-95 active:bg-[rgba(202,165,96,.1)] disabled:opacity-60"
              >
                {k}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-3 px-1 text-center text-[10px] text-[var(--muted)]">
        Submission continues automatically after the last digit.
      </div>
      {footer && <div className="mt-3 flex justify-center">{footer}</div>}
      {secondaryActionLabel && onSecondaryAction && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={onSecondaryAction}
            disabled={secondaryActionPending || biometricBusy}
            aria-label={secondaryActionLabel}
            title={secondaryActionLabel}
            className={cn(
              'border border-[var(--border)] bg-[var(--clay)] text-[var(--gold2)] disabled:opacity-60',
              secondaryActionIconOnly
                ? 'flex h-10 w-10 items-center justify-center rounded-full'
                : 'px-4 py-2 text-[10px] font-bold uppercase tracking-[.8px]',
            )}
          >
            {secondaryActionPending
              ? (secondaryActionIconOnly ? <span className="text-[10px]">…</span> : 'Checking…')
              : secondaryActionIconOnly
                ? <Fingerprint className="h-4 w-4" />
                : secondaryActionLabel}
          </button>
        </div>
      )}
    </div>
  )
}
