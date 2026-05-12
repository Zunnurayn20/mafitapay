'use client'
import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'green' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-bold uppercase tracking-wider cursor-pointer transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed border-none'

    const variants = {
      primary:   'bg-[var(--gold)] text-white hover:bg-[var(--terra2)]',
      secondary: 'bg-[var(--clay)] border border-[var(--border)] text-[var(--text2)] hover:border-[var(--gold2)] hover:text-[var(--text)]',
      green:     'bg-[var(--green)] text-[var(--char)] hover:opacity-90',
      danger:    'bg-transparent border border-[var(--red2)] text-[var(--red2)] hover:bg-[rgba(196,52,26,.1)]',
      ghost:     'bg-transparent text-[var(--text2)] hover:text-[var(--text)] hover:bg-[var(--clay)]',
    }

    const sizes = {
      sm:  'text-[10px] px-3 py-2',
      md:  'text-[11px] px-5 py-3',
      lg:  'text-[12px] px-6 py-4',
    }

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <div className="spinner !w-4 !h-4 !border-2" />}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
