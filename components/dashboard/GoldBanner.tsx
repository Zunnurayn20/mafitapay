'use client'

import Link from 'next/link'
import { ChevronRight, TrendingUp } from 'lucide-react'

export function GoldBanner() {
  return (
    <Link
      href="/stocks"
      className="flex items-center justify-between rounded-2xl border border-[#2a2418] px-4 py-3.5 shadow-[0_4px_18px_-8px_rgba(0,0,0,0.35)] transition-transform active:scale-[0.99]"
      style={{
        background:
          'linear-gradient(135deg, #050403 0%, #1a140c 28%, #3d2e18 50%, #1a140c 72%, #050403 100%)',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#4a3a22] bg-[#0c0907]">
          <TrendingUp size={18} className="text-[#ffffff]" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ffffff]">
            Stocks · watch
          </div>
          <div className="mt-0.5 truncate font-display text-sm font-bold text-[#ffffff]">
            NGX markets — watch only
          </div>
        </div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-[#ffffff]" />
    </Link>
  )
}
