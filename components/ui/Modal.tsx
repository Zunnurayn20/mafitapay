'use client'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: React.ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
  bottomSheet?: boolean
  /** When false, overlay click, Escape, and the close control do nothing. */
  dismissible?: boolean
}

export function Modal({ open, onClose, title, subtitle, children, className, size = 'md', bottomSheet = false, dismissible = true }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissible) onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [dismissible, open, onClose])

  if (!open) return null

  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }

  return (
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-[500] flex bg-black/60 backdrop-blur-sm',
        bottomSheet
          ? 'items-end justify-center pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+1.5rem))]'
          : 'items-center justify-center',
      )}
      onClick={(e) => { if (dismissible && e.target === overlayRef.current) onClose() }}
    >
      <div className={cn(
        'w-full bg-[var(--coal)] border border-[var(--border)] overflow-y-auto scrollbar-none',
        sizes[size],
        bottomSheet
          ? 'max-h-[calc(100dvh-env(safe-area-inset-top)-6.5rem)] max-w-xl rounded-3xl animate-[fadeUp_.2s_ease-out]'
          : 'max-h-[90dvh]',
        className,
      )}>
        <div className="ank-strip" />
        {bottomSheet && (
          <div className="relative flex h-8 items-center justify-center">
            <span className="h-1 w-10 rounded-full bg-[var(--border2)]" />
            {dismissible ? <button onClick={onClose} aria-label="Close confirmation" className="absolute right-3 flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--clay2)] hover:text-[var(--red2)]">×</button> : null}
          </div>
        )}
        {title && !bottomSheet && (
          <div className="flex items-start justify-between px-6 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--coal)] z-10">
            <div>
              <div className="font-display font-bold text-[15px] text-[var(--text)]">{title}</div>
              {subtitle && <div className="text-[10px] text-[var(--muted)] mt-1 font-mono">{subtitle}</div>}
            </div>
            {dismissible ? (
              <button
                onClick={onClose}
                className="w-7 h-7 bg-[var(--clay2)] border border-[var(--border)] flex items-center justify-center text-[12px] text-[var(--muted)] hover:text-[var(--red2)] transition-colors ml-4 flex-shrink-0"
              >✕</button>
            ) : null}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
