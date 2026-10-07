'use client'

import { cn } from '@/lib/utils'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string
  prefix?: ReactNode
  suffix?: ReactNode
  onSuffixClick?: () => void
  error?: string
  hint?: ReactNode
  hintTone?: 'muted' | 'success'
  leadingIcon?: ReactNode
  trailing?: ReactNode
  variant?: 'default' | 'auth'
  status?: 'default' | 'success'
  containerClassName?: string
}

const suffixClass = 'bg-[var(--clay)] border-l border-[var(--border)] px-3.5 flex items-center text-[9px] font-bold tracking-wider text-[var(--gold)] flex-shrink-0'

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, prefix, suffix, onSuffixClick, error, hint, hintTone = 'muted', leadingIcon, trailing, variant = 'default', status = 'default', id, className, containerClassName, ...props }, ref) => {
    const { 'aria-describedby': externalDescribedBy, ...inputProps } = props
    const generatedId = useId()
    const inputId = id ?? `input-${generatedId}`
    const messageId = `${inputId}-message`
    const describedBy = [externalDescribedBy, (error || hint) ? messageId : null].filter(Boolean).join(' ') || undefined

    if (variant === 'auth') {
      return (
        <div className={cn('flex w-full flex-col gap-[7px]', containerClassName)}>
          {label && <label htmlFor={inputId} className="text-[13.5px] font-semibold text-[var(--text2)]">{label}</label>}
          <div className={cn(
            'flex h-[52px] items-center gap-3 rounded-[14px] border bg-[var(--coal)] px-4 transition-[border-color,box-shadow]',
            error ? 'border-[var(--red2)] shadow-[0_0_0_4px_var(--danger-ring)]' : status === 'success' ? 'border-[var(--success-ring)]' : 'border-[var(--border)] focus-within:border-[var(--gold)] focus-within:shadow-[0_0_0_4px_var(--gold-tint)]',
          )}>
            {leadingIcon && <span aria-hidden="true" className={cn('flex shrink-0', error ? 'text-[var(--danger-text)]' : 'text-[var(--muted)]')}>{leadingIcon}</span>}
            {prefix}
            <input ref={ref} id={inputId} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
              className={cn('h-full min-w-0 flex-1 bg-transparent text-[16px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]', className)} {...inputProps} />
            {trailing}
          </div>
          {error ? <p id={messageId} role="alert" className="text-[13.5px] font-medium text-[var(--danger-text)]">{error}</p>
            : hint ? <p id={messageId} className={cn('flex items-center gap-1.5 text-[13.5px] font-medium', hintTone === 'success' ? 'text-[var(--success-text)]' : 'text-[var(--muted)]')}>{hint}</p> : null}
        </div>
      )
    }

    return (
      <div className={cn('w-full', containerClassName)}>
        {label && <label htmlFor={inputId} className="mb-1.5 block text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{label}</label>}
        <div className={cn('flex border focus-within:border-[var(--gold)] transition-colors', error ? 'border-[var(--red2)]' : status === 'success' ? 'border-[var(--green2)]' : 'border-[var(--border)]')}>
          {prefix && <div className="flex shrink-0 items-center bg-[var(--clay2)] px-3 text-lg font-black text-[var(--ngn)]">{prefix}</div>}
          {leadingIcon && <span aria-hidden="true" className="flex items-center pl-3 text-[var(--muted)]">{leadingIcon}</span>}
          <input ref={ref} id={inputId} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
            className={cn('flex-1 border-none bg-[var(--clay2)] px-3.5 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]', className)} {...inputProps} />
          {trailing}
          {suffix && (onSuffixClick ? <button type="button" onMouseDown={event => event.preventDefault()} onClick={onSuffixClick} className={cn(suffixClass, 'cursor-pointer transition-colors hover:text-[var(--gold2)]')}>{suffix}</button> : <div className={suffixClass}>{suffix}</div>)}
        </div>
        {error ? <p id={messageId} role="alert" className="mt-1 text-xs text-[var(--danger-text)]">{error}</p> : hint ? <p id={messageId} className={cn('mt-1 text-xs', hintTone === 'success' ? 'text-[var(--success-text)]' : 'text-[var(--muted)]')}>{hint}</p> : null}
      </div>
    )
  }
)
Input.displayName = 'Input'
