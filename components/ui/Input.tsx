'use client'
import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, prefix, suffix, error, className, ...props }, ref) => (
    <div className="w-full">
      {label && <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)] mb-1.5">{label}</div>}
      <div className={cn('flex border', error ? 'border-[var(--red)]' : 'border-[var(--border)]', 'focus-within:border-[var(--gold)] transition-colors')}>
        {prefix && <div className="bg-[var(--clay2)] px-3 flex items-center text-[var(--ngn)] font-display font-black text-lg flex-shrink-0">{prefix}</div>}
        <input
          ref={ref}
          className={cn('flex-1 bg-[var(--clay2)] text-[var(--text)] text-sm px-3.5 py-3 border-none outline-none placeholder:text-[var(--muted)]', className)}
          {...props}
        />
        {suffix && (
          <div className="bg-[var(--clay)] border-l border-[var(--border)] px-3.5 flex items-center text-[9px] font-bold tracking-wider text-[var(--gold)] cursor-pointer">
            {suffix}
          </div>
        )}
      </div>
      {error && <div className="text-[10px] text-[var(--red2)] mt-1">{error}</div>}
    </div>
  )
)
Input.displayName = 'Input'
