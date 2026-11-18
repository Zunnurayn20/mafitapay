'use client'
import { ArrowLeft } from 'lucide-react'

export function AuthBrandHeader() {
  return <div className="mt-1 flex items-center gap-3 self-start">
    <div className="relative h-11 w-11 shrink-0">
      <div aria-hidden="true" className="absolute -inset-2 rounded-full bg-[radial-gradient(circle,var(--auth-glow),transparent_68%)]" />
      <img src="/mafitapay-logo.webp" alt="MafitaPay" width={44} height={44} className="relative h-11 w-11 rounded-xl object-contain shadow-[0_6px_18px_rgba(0,0,0,.3),0_0_0_1px_var(--gold-soft)]" />
    </div>
    <span className="font-display text-[13px] font-bold tracking-[3px] text-[var(--gold2)]">MAFITAPAY</span>
  </div>
}

export function AuthTopNav({ onBack, backLabel = 'Back' }: { onBack: () => void; backLabel?: string }) {
  return <div className="flex h-11 items-center justify-between">
    <button type="button" onClick={onBack} aria-label={backLabel} className="grid h-11 w-11 place-items-center rounded-[13px] border border-[var(--border)] bg-[var(--coal)] text-[var(--text)]"><ArrowLeft size={20} /></button>
    <div className="flex items-center gap-2"><img src="/mafitapay-logo.webp" alt="" className="h-7 w-7 rounded-lg shadow-[0_0_0_1px_var(--gold-soft)]" /><span className="font-display text-[12.5px] font-bold tracking-[2.6px] text-[var(--gold2)]">MAFITAPAY</span></div>
    <div className="w-11" />
  </div>
}
