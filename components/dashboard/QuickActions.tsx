'use client'
import { useAppStore } from '@/store'
import { useRouter } from 'next/navigation'
import { useBillProviders } from '@/lib/client/catalogs'
import { Smartphone, Wifi, Tv, Zap, Bitcoin } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const DISPLAY_ORDER = ['airtime', 'data', 'cable', 'electric'] as const

const ACTION_META: Record<string, { icon: LucideIcon; tint: string }> = {
  airtime: {
    icon: Smartphone,
    tint: 'bg-amber-50 text-amber-700 border-white/70',
  },
  data: {
    icon: Wifi,
    tint: 'bg-blue-50 text-[#2C5AA0] border-white/70',
  },
  cable: {
    icon: Tv,
    tint: 'bg-violet-50 text-violet-700 border-white/70',
  },
  electric: {
    icon: Zap,
    tint: 'bg-emerald-50 text-emerald-700 border-white/70',
  },
  crypto: {
    icon: Bitcoin,
    tint: 'bg-orange-50 text-orange-700 border-white/70',
  },
}

export function QuickActions() {
  const { openModal, setModalData } = useAppStore()
  const router = useRouter()
  const providers = useBillProviders()
    .filter(item => DISPLAY_ORDER.includes(item.id as (typeof DISPLAY_ORDER)[number]))
    .sort(
      (a, b) =>
        DISPLAY_ORDER.indexOf(a.id as (typeof DISPLAY_ORDER)[number]) -
        DISPLAY_ORDER.indexOf(b.id as (typeof DISPLAY_ORDER)[number]),
    )

  return (
    <section>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        Quick actions
      </div>
      <div className="grid grid-cols-5 gap-2.5">
        {providers.map(provider => {
          const meta = ACTION_META[provider.id] || ACTION_META.data
          const Icon = meta.icon
          const disabled = provider.isActive === false

          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => {
                if (disabled) return
                setModalData({ service: provider.name })
                openModal('bills')
              }}
              disabled={disabled}
              className={`group flex flex-col items-center gap-2 ${disabled ? 'opacity-50' : ''}`}
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl border shadow-[0_3px_16px_-6px_rgba(15,23,42,0.16)] transition-transform group-active:scale-95 ${meta.tint}`}
              >
                <Icon size={20} strokeWidth={1.75} />
              </div>
              <span className="text-center text-[11px] font-medium leading-tight text-[var(--text2)]">
                {provider.name}
              </span>
              {disabled ? (
                <span className="text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Off
                </span>
              ) : null}
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => router.push('/crypto')}
          className="group flex flex-col items-center gap-2"
        >
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-xl border shadow-[0_3px_16px_-6px_rgba(15,23,42,0.16)] transition-transform group-active:scale-95 ${ACTION_META.crypto.tint}`}
          >
            <Bitcoin size={20} strokeWidth={1.75} />
          </div>
          <span className="text-center text-[11px] font-medium leading-tight text-[var(--text2)]">
            Crypto
          </span>
        </button>
      </div>
    </section>
  )
}
