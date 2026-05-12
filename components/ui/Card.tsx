'use client'
import { cn } from '@/lib/utils'
import { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  accent?: string
}

export function Card({ className, children, accent, ...props }: CardProps) {
  return (
    <div
      className={cn('bg-[var(--coal)] border border-[var(--border)] relative overflow-hidden', className)}
      style={accent ? { '--accent': accent } as React.CSSProperties : undefined}
      {...props}
    >
      {accent && <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accent }} />}
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-between px-5 py-4 border-b border-[var(--border)]', className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-[13px] font-bold text-[var(--text)]', className)} {...props}>{children}</div>
}

export function CardAction({ className, children, onClick, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('text-[10px] font-bold text-[var(--gold2)] uppercase tracking-wide cursor-pointer hover:text-[var(--text)] transition-colors', className)}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  )
}
