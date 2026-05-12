'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative z-[1]">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-5">⚠️</div>
        <div className="font-display font-black text-[24px] text-[var(--text)] mb-3">Something went wrong</div>
        <div className="text-[12px] text-[var(--muted)] mb-6 font-mono bg-[var(--clay)] border border-[var(--border)] px-4 py-3 text-left">
          {error.message}
        </div>
        <Button onClick={reset}>Try Again</Button>
      </div>
    </div>
  )
}
