'use client'
import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'green' | 'danger' | 'ghost' | 'gold' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-bold cursor-pointer transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed'
    const variants = {
      primary: 'border-none uppercase tracking-wider bg-[var(--gold)] text-white hover:bg-[var(--terra2)]',
      secondary: 'uppercase tracking-wider bg-[var(--clay)] border border-[var(--border)] text-[var(--text2)] hover:border-[var(--gold2)] hover:text-[var(--text)]',
      green: 'border-none uppercase tracking-wider bg-[var(--green)] text-[var(--char)] hover:opacity-90',
      danger: 'uppercase tracking-wider bg-transparent border border-[var(--red2)] text-[var(--red2)] hover:bg-[rgba(196,52,26,.1)]',
      ghost: 'border-none uppercase tracking-wider bg-transparent text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--clay)]',
      gold: 'normal-case tracking-[.1px] rounded-2xl text-[var(--btn-gold-text)] bg-[linear-gradient(180deg,var(--btn-gold-from)_0%,var(--btn-gold-mid)_55%,var(--btn-gold-to)_100%)] shadow-[0_10px_28px_var(--gold-soft),inset_0_1px_0_rgba(255,255,255,.45),inset_0_-2px_0_rgba(0,0,0,.12)] hover:brightness-105 active:brightness-95',
      outline: 'normal-case tracking-[.1px] rounded-2xl bg-[var(--clay)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--gold)] [&_svg]:text-[var(--gold)]',
    }
    const sizes = { sm: 'text-[10px] px-3 py-2', md: 'text-[11px] px-5 py-3', lg: 'text-[12px] px-6 py-4', xl: 'h-14 px-6 text-[16.5px] gap-2.5' }
    return <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...props}>
      {loading && <div className="spinner !h-4 !w-4 !border-2" />}{children}
    </button>
  }
)
Button.displayName = 'Button'
