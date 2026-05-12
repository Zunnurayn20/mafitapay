'use client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

export default function NotFound() {
  const router = useRouter()
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative z-[1]">
      <div className="text-center max-w-sm">
        <div className="font-display font-black text-[100px] text-[var(--gold2)] leading-none opacity-20 mb-4">404</div>
        <div className="font-display font-black text-[28px] text-[var(--text)] mb-3">Page not found</div>
        <div className="text-[13px] text-[var(--muted)] mb-8 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or was moved.
        </div>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => router.back()} variant="secondary">← Go Back</Button>
          <Button onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>
        </div>
      </div>
    </div>
  )
}
