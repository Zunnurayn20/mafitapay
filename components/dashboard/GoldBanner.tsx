'use client'

import Link from 'next/link'
import { ChevronRight, TrendingUp } from 'lucide-react'

export function GoldBanner() {
  return (
    <Link
      href="/stocks"
      className="flex items-center justify-between rounded-2xl border border-[rgba(140,107,49,0.25)] px-4 py-3.5 shadow-[0_4px_18px_-8px_rgba(15,23,42,0.14)] transition-transform active:scale-[0.99]"
      style={{
        background:
          'linear-gradient(135deg, #F7F1E3 0%, #FFFFFF 55%, rgba(247, 241, 227, 0.65) 100%)',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(140,107,49,0.2)] bg-white shadow-[0_3px_12px_-6px_rgba(15,23,42,0.16)]">
          <TrendingUp size={18} className="text-[#8C6A22]" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8C6A22]">
            Stocks · watch
          </div>
          <div className="mt-0.5 truncate font-display text-sm font-bold text-[#0F172A]">
            NGX markets — watch only
          </div>
        </div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-[#8C6A22]" />
    </Link>
  )
}
