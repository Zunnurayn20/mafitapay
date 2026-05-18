'use client'
import { useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PinPadProps {
  length?: number
  onComplete: (pin: string) => void
  title?: string
  subtitle?: string
  secondaryActionLabel?: string
  secondaryActionIconOnly?: boolean
  onSecondaryAction?: () => void
  secondaryActionPending?: boolean
}

export function PinPad({
  length = 4,
  onComplete,
  title = 'Enter PIN',
  subtitle,
  secondaryActionLabel,
  secondaryActionIconOnly = false,
  onSecondaryAction,
  secondaryActionPending = false,
}: PinPadProps) {
  const [pin, setPin] = useState('')

  const addDigit = (d: number) => {
    if (pin.length >= length) return
    const next = pin + d
    setPin(next)
    if (next.length === length) setTimeout(() => onComplete(next), 300)
  }

  const del = () => setPin(p => p.slice(0, -1))

  return (
    <div className="p-5">
      <div className="overflow-hidden border border-[var(--border)] bg-[var(--clay)]">
        <div className="border-b border-[var(--border)] bg-[linear-gradient(135deg,rgba(202,165,96,.12),rgba(79,70,229,.06))] px-5 py-5 text-center">
          <div className="text-[9px] text-[var(--muted)] uppercase tracking-[1.4px] mb-2">{title}</div>
          {subtitle && <div className="mx-auto max-w-[24rem] text-[13px] leading-relaxed text-[var(--text2)]">{subtitle}</div>}
          <div className="mt-5 flex justify-center gap-3">
            {Array.from({ length }).map((_, i) => (
              <div key={i} className={cn('pin-dot', i < pin.length && 'filled')} />
            ))}
          </div>
          <div className="mt-3 text-[10px] text-[var(--muted)]">
            {pin.length === 0 ? 'Enter your 4-digit transaction PIN.' : `${pin.length}/${length} digits entered`}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px bg-[var(--border)]">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n} type="button" className="num-key" onClick={() => addDigit(n)}>{n}</button>
          ))}
          <div className="num-key num-key-muted">•</div>
          <button type="button" className="num-key" onClick={() => addDigit(0)}>0</button>
          <button type="button" className="num-key num-key-muted text-sm" onClick={del} disabled={pin.length === 0}>⌫</button>
        </div>
      </div>
      <div className="mt-3 px-1 text-center text-[10px] text-[var(--muted)]">
        Submission continues automatically after the last digit.
      </div>
      {secondaryActionLabel && onSecondaryAction && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={onSecondaryAction}
            disabled={secondaryActionPending}
            aria-label={secondaryActionLabel}
            title={secondaryActionLabel}
            className={cn(
              'border border-[var(--border)] bg-[var(--clay)] text-[var(--gold2)] disabled:opacity-60',
              secondaryActionIconOnly
                ? 'flex h-10 w-10 items-center justify-center rounded-full'
                : 'px-4 py-2 text-[10px] font-bold uppercase tracking-[.8px]'
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
