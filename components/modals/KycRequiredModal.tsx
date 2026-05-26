'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

export function KycRequiredModal() {
  const router = useRouter()

  function openKyc(documentType: 'nin' | 'bvn') {
    router.push(`/kyc?documentType=${documentType}`)
  }

  return (
    <div className="fixed inset-0 z-[650] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md border border-[var(--border)] bg-[var(--coal)]">
        <div className="ank-strip" />
        <div className="p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold2)]">Verification Required</div>
          <div className="mt-2 font-display text-[22px] font-black text-[var(--text)]">Submit BVN or NIN</div>
          <div className="mt-2 text-[12px] leading-relaxed text-[var(--text2)]">
            Before you proceed, submit one identity record for review. Choose either BVN or NIN to continue.
          </div>

          <div className="mt-5 grid gap-3">
            <button
              type="button"
              onClick={() => openKyc('nin')}
              className="border border-[rgba(202,165,96,0.18)] bg-[var(--clay)] px-4 py-4 text-left transition-colors hover:border-[var(--gold2)]"
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--gold2)]">NIN</div>
              <div className="mt-1 text-[11px] text-[var(--text2)]">Submit National Identification Number</div>
            </button>

            <button
              type="button"
              onClick={() => openKyc('bvn')}
              className="border border-[rgba(202,165,96,0.18)] bg-[var(--clay)] px-4 py-4 text-left transition-colors hover:border-[var(--gold2)]"
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--gold2)]">BVN</div>
              <div className="mt-1 text-[11px] text-[var(--text2)]">Submit Bank Verification Number</div>
            </button>
          </div>

          <Button className="mt-5 w-full py-3" onClick={() => openKyc('nin')}>
            Continue To KYC
          </Button>
        </div>
      </div>
    </div>
  )
}
