'use client'
import { useState } from 'react'
import { CheckCircle2, Delete, Fingerprint, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PinPadStatus = 'pin' | 'processing' | 'success' | 'error'

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
  /**
   * After PIN / biometric, the keypad is replaced with processing, then success or error.
   * Details stay visible so the confirmation sheet does not go blank.
   */
  status?: PinPadStatus
  statusTitle?: string
  statusMessage?: string
  statusReference?: string
  onRetry?: () => void
  onDone?: () => void
  doneLabel?: string
  secondaryDoneLabel?: string
  onSecondaryDone?: () => void
}

function StatusPanel({
  status,
  title,
  message,
  reference,
  onRetry,
  onDone,
  doneLabel,
  secondaryDoneLabel,
  onSecondaryDone,
}: {
  status: Exclude<PinPadStatus, 'pin'>
  title?: string
  message?: string
  reference?: string
  onRetry?: () => void
  onDone?: () => void
  doneLabel: string
  secondaryDoneLabel?: string
  onSecondaryDone?: () => void
}) {
  const heading = title
    || (status === 'processing' ? 'Processing payment' : status === 'success' ? 'Transaction successful' : 'Transaction failed')
  const copy = message
    || (status === 'processing'
      ? 'Stay on this screen. We’re confirming with the provider and updating your wallet.'
      : status === 'success'
        ? 'Your transaction was completed and your wallet has been updated.'
        : 'Nothing was completed. You can try again.')

  return (
    <section className="px-1 pb-1 pt-1 text-center" aria-live="polite" aria-busy={status === 'processing'}>
      {status === 'processing' && (
        <>
          <div className="spinner mx-auto" />
          <div className="mt-4 text-sm font-semibold text-[var(--text)]">{heading}</div>
          <p className="mx-auto mt-2 max-w-[22rem] text-xs leading-relaxed text-[var(--muted)]">{copy}</p>
          <div className="mx-auto mt-5 h-1.5 max-w-[16rem] overflow-hidden rounded-full bg-[var(--clay2)]">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--gold)]" />
          </div>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(46,170,92,.12)]">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <div className="mt-4 text-lg font-bold text-[var(--text)]">{heading}</div>
          <p className="mx-auto mt-1.5 max-w-[22rem] text-xs leading-relaxed text-[var(--muted)]">{copy}</p>
          {reference ? (
            <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] p-3 text-left">
              <div className="mb-1 text-[8px] uppercase tracking-[1px] text-[var(--muted)]">Transaction Reference</div>
              <div className="font-mono text-[11px] text-[var(--gold2)]">{reference}</div>
            </div>
          ) : null}
          {onDone ? (
            <button
              type="button"
              onClick={onDone}
              className="mt-6 w-full bg-[var(--gold)] py-3 text-xs font-bold uppercase tracking-wider text-white"
            >
              {doneLabel}
            </button>
          ) : null}
          {onSecondaryDone && secondaryDoneLabel ? (
            <button
              type="button"
              onClick={onSecondaryDone}
              className="mt-2.5 w-full border border-[var(--border)] py-3 text-xs font-bold uppercase tracking-wider text-[var(--text)]"
            >
              {secondaryDoneLabel}
            </button>
          ) : null}
        </>
      )}

      {status === 'error' && (
        <>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(239,68,68,.12)]">
            <XCircle size={32} className="text-[var(--red2)]" />
          </div>
          <div className="mt-4 text-lg font-bold text-[var(--text)]">{heading}</div>
          <p className="mx-auto mt-1.5 max-w-[22rem] text-xs font-medium leading-relaxed text-[var(--red2)]">{copy}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-6 w-full bg-[var(--gold)] py-3 text-xs font-bold uppercase tracking-wider text-white"
            >
              Try again
            </button>
          ) : null}
          {onDone ? (
            <button
              type="button"
              onClick={onDone}
              className="mt-2.5 w-full border border-[var(--border)] py-3 text-xs font-bold uppercase tracking-wider text-[var(--text)]"
            >
              Cancel
            </button>
          ) : null}
        </>
      )}
    </section>
  )
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
  status = 'pin',
  statusTitle,
  statusMessage,
  statusReference,
  onRetry,
  onDone,
  doneLabel = 'Done',
  secondaryDoneLabel,
  onSecondaryDone,
}: PinPadProps) {
  const [pin, setPin] = useState('')
  const locked = biometricBusy || status !== 'pin'

  const addDigit = (d: number) => {
    if (locked) return
    if (pin.length >= length) return
    const next = pin + d
    setPin(next)
    if (next.length === length) setTimeout(() => onComplete(next), 300)
  }

  const del = () => {
    if (locked) return
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
    <div className="px-3 pb-5 sm:px-5">
      {details && details.length > 0 && (
        <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--coal)] p-4">
          <div className="mb-3 text-sm font-bold text-[var(--text)]">{title}</div>
          {details.map(row => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] py-2.5 text-[11px] last:border-0">
              <span className="shrink-0 font-semibold uppercase tracking-wide text-[var(--muted)]">{row.label}</span>
              <span className={cn('break-all text-right', row.emphasis ? 'font-bold text-[var(--gold2)]' : 'font-medium text-[var(--text)]')}>
                {row.value}
              </span>
            </div>
          ))}
        </section>
      )}

      {status !== 'pin' ? (
        <StatusPanel
          status={status}
          title={statusTitle}
          message={statusMessage}
          reference={statusReference}
          onRetry={onRetry}
          onDone={onDone}
          doneLabel={doneLabel}
          secondaryDoneLabel={secondaryDoneLabel}
          onSecondaryDone={onSecondaryDone}
        />
      ) : (
        <>
          <section className="text-center">
            {!details?.length && <>
              <div className="text-[13px] font-semibold text-[var(--text)]">{title}</div>
              {subtitle && <div className="mx-auto mt-1 max-w-[26rem] text-[11px] leading-relaxed text-[var(--muted)]">{subtitle}</div>}
            </>}
            {details?.length && subtitle && <div className="mx-auto mb-1 max-w-[26rem] text-[11px] leading-relaxed text-[var(--muted)]">{subtitle}</div>}
            <div className="my-4 flex justify-center gap-3.5">
              {Array.from({ length }).map((_, i) => (
                <span key={i} className={cn('h-3 w-3 rounded-full transition-all', i < pin.length ? 'scale-110 bg-[var(--gold)] shadow-[0_0_0_4px_rgba(202,165,96,.13)]' : 'bg-[var(--clay2)]')} />
              ))}
            </div>
            {onBiometric && <div className="mb-3 text-[10px] text-[var(--muted)]">Enter your PIN, or tap the fingerprint icon.</div>}
            <div className="grid grid-cols-3 gap-2.5 px-1 sm:px-4">
              {keys.map((k, i) => {
                if (k === '') return <div key={i} className="h-14" />

                if (k === 'bio') {
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={onBiometric}
                      disabled={locked}
                      className="flex h-12 items-center justify-center rounded-2xl border border-[rgba(202,165,96,.28)] bg-[rgba(202,165,96,.12)] text-[var(--gold2)] transition-all active:scale-95 disabled:opacity-60"
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
                      disabled={pin.length === 0 || locked}
                      className="flex h-12 items-center justify-center rounded-2xl text-[var(--muted)] transition-colors active:bg-[var(--clay2)] disabled:opacity-40"
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
                    disabled={locked}
                    className="h-12 rounded-2xl border border-[var(--border)] bg-[var(--coal)] font-display text-lg font-semibold text-[var(--text)] shadow-[0_2px_8px_rgba(0,0,0,.12)] transition-all active:scale-95 active:bg-[rgba(202,165,96,.1)] disabled:opacity-60"
                  >
                    {k}
                  </button>
                )
              })}
            </div>
            <div className="mt-3 px-1 text-[10px] text-[var(--muted)]">Submission continues automatically after the last digit.</div>
          </section>
          {footer && <div className="mt-3 flex justify-center">{footer}</div>}
          {secondaryActionLabel && onSecondaryAction && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={onSecondaryAction}
                disabled={secondaryActionPending || locked}
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
        </>
      )}
    </div>
  )
}
