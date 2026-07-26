'use client'
import { cn } from '@/lib/utils'
import { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  accent?: string
  pattern?: 'subtle' | 'soft' | 'strong' | 'plain'
}

export function Card({ className, children, accent, pattern = 'subtle', ...props }: CardProps) {
  const isStrong = pattern === 'strong'
  const isSoft = pattern === 'soft'
  const isPlain = pattern === 'plain'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--coal)]',
        className,
      )}
      style={accent ? { '--accent': accent } as React.CSSProperties : undefined}
      {...props}
    >
      {!isPlain && (
        <>
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0',
              isStrong ? 'opacity-[0.16]' : isSoft ? 'opacity-[0.12]' : 'opacity-[0.08]',
            )}
            style={{
              backgroundImage: (isStrong || isSoft)
                ? `
                  radial-gradient(circle at 18px 18px, rgba(224,196,138,0.22) 0 2px, transparent 2px),
                  linear-gradient(135deg, transparent 0 40%, rgba(202,165,96,0.18) 40% 44%, transparent 44% 56%, rgba(202,165,96,0.18) 56% 60%, transparent 60% 100%),
                  linear-gradient(45deg, transparent 0 40%, rgba(140,107,49,0.14) 40% 44%, transparent 44% 56%, rgba(140,107,49,0.14) 56% 60%, transparent 60% 100%)
                `
                : `
                  radial-gradient(circle at 12px 12px, rgba(202,165,96,0.22) 0 1.5px, transparent 1.5px),
                  linear-gradient(135deg, transparent 0 42%, rgba(202,165,96,0.12) 42% 45%, transparent 45% 55%, rgba(202,165,96,0.12) 55% 58%, transparent 58% 100%),
                  linear-gradient(45deg, transparent 0 42%, rgba(140,107,49,0.1) 42% 45%, transparent 45% 55%, rgba(140,107,49,0.1) 55% 58%, transparent 58% 100%)
                `,
              backgroundSize: isStrong
                ? '28px 28px, 72px 72px, 72px 72px'
                : isSoft
                  ? '26px 26px, 64px 64px, 64px 64px'
                  : '24px 24px, 48px 48px, 48px 48px',
              backgroundPosition: isStrong
                ? '0 0, 0 0, 36px 36px'
                : isSoft
                  ? '0 0, 0 0, 32px 32px'
                  : '0 0, 0 0, 24px 24px',
            }}
          />
          {(isStrong || isSoft) && (
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0 right-[-1.5rem] bg-center bg-no-repeat',
                isStrong ? 'w-28 opacity-[0.12]' : 'w-24 opacity-[0.08]',
              )}
              style={{ backgroundImage: "url('/mafitapay-logo.png')", backgroundSize: 'contain' }}
            />
          )}
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0',
              isStrong ? 'h-24 opacity-[0.24]' : isSoft ? 'h-22 opacity-[0.18]' : 'h-20 opacity-[0.12]',
            )}
            style={{
              background: (isStrong || isSoft)
                ? 'linear-gradient(180deg, transparent 0%, rgba(202,165,96,0.14) 100%)'
                : 'linear-gradient(180deg, transparent 0%, rgba(202,165,96,0.08) 100%)',
            }}
          />
        </>
      )}
      {accent && (
        <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: accent }} />
      )}
      <div className="relative z-[1]">
        {children}
      </div>
    </div>
  )
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b border-[var(--border)] px-4 py-3.5 sm:px-5 sm:py-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('text-[13px] font-bold text-[var(--text)]', className)} {...props}>
      {children}
    </div>
  )
}

export function CardAction({ className, children, onClick, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'cursor-pointer text-[10px] font-bold uppercase tracking-wide text-[var(--gold2)] transition-colors hover:text-[var(--text)]',
        className,
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  )
}
