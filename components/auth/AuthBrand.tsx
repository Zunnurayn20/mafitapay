'use client'
import { ArrowLeft } from 'lucide-react'

export function AuthBrandHeader() {
  return <div className="mt-3.5 flex flex-col items-center gap-2.5">
    <div className="relative h-[72px] w-[72px]">
      <div aria-hidden="true" className="absolute -inset-[18px] rounded-full bg-[radial-gradient(circle,var(--auth-glow),transparent_68%)]" />
      <img src="/mafitapay-logo.png" alt="MafitaPay" width={72} height={72} className="relative h-[72px] w-[72px] rounded-[18px] object-contain shadow-[0_10px_30px_rgba(0,0,0,.35),0_0_0_1px_var(--gold-soft)]" />
    </div>
    <span className="font-display text-[14px] font-bold tracking-[4px] text-[var(--gold2)]">MAFITAPAY</span>
  </div>
}

export function AuthTopNav({ onBack, backLabel = 'Back' }: { onBack: () => void; backLabel?: string }) {
  return <div className="flex h-11 items-center justify-between">
    <button type="button" onClick={onBack} aria-label={backLabel} className="grid h-11 w-11 place-items-center rounded-[13px] border border-[var(--border)] bg-[var(--coal)] text-[var(--text)]"><ArrowLeft size={20} /></button>
    <div className="flex items-center gap-2"><img src="/mafitapay-logo.png" alt="" className="h-7 w-7 rounded-lg shadow-[0_0_0_1px_var(--gold-soft)]" /><span className="font-display text-[12.5px] font-bold tracking-[2.6px] text-[var(--gold2)]">MAFITAPAY</span></div>
    <div className="w-11" />
  </div>
}
