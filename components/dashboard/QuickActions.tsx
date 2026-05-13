'use client'
import { useAppStore } from '@/store'
import { useRouter } from 'next/navigation'
import { useBillProviders } from '@/lib/client/catalogs'

const DISPLAY_ORDER = ['airtime', 'data', 'cable', 'electric'] as const
const ACTION_COLORS: Record<string, string> = {
  airtime: 'var(--green)',
  data: 'var(--gold2)',
  cable: 'var(--terra2)',
  electric: 'var(--gold)',
  crypto: 'var(--gold)',
}

export function QuickActions() {
  const { openModal, setModalData } = useAppStore()
  const router = useRouter()
  const providers = useBillProviders()
    .filter(item => DISPLAY_ORDER.includes(item.id as (typeof DISPLAY_ORDER)[number]))
    .sort((a, b) => DISPLAY_ORDER.indexOf(a.id as (typeof DISPLAY_ORDER)[number]) - DISPLAY_ORDER.indexOf(b.id as (typeof DISPLAY_ORDER)[number]))

  return (
    <section className="space-y-3">
      <div className="text-[8px] font-bold uppercase tracking-[1.4px] text-[var(--muted)]">Quick Services</div>
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {providers.map(provider => (
          <button
            key={provider.id}
            onClick={() => {
              if (provider.isActive === false) return
              setModalData({ service: provider.name })
              openModal('bills')
            }}
            disabled={provider.isActive === false}
            className={`min-h-20 border px-2 py-3 text-center transition-all sm:min-h-28 sm:p-4 ${
              provider.isActive === false
                ? 'border-[var(--border)] bg-[rgba(255,255,255,.03)] opacity-55'
                : 'border-[var(--border)] bg-[var(--coal)] hover:-translate-y-0.5 hover:bg-[var(--clay)]'
            }`}
            style={{ borderTop: `3px solid ${ACTION_COLORS[provider.id] || 'var(--gold)'}` }}
          >
            <div className="mb-1 text-[18px] sm:mb-2 sm:text-[22px]">{provider.icon}</div>
            <div className="text-[8px] font-bold uppercase tracking-[.4px] text-[var(--text2)] sm:text-[9px] sm:tracking-[.6px]">{provider.name}</div>
            {provider.isActive === false && (
              <div className="mt-1 text-[7px] font-bold uppercase tracking-[.4px] text-[var(--muted)] sm:text-[8px]">
                Unavailable
              </div>
            )}
          </button>
        ))}
        <button
          onClick={() => router.push('/crypto')}
          className="min-h-20 border border-[var(--border)] bg-[var(--coal)] px-2 py-3 text-center transition-all hover:-translate-y-0.5 hover:bg-[var(--clay)] sm:min-h-28 sm:p-4"
          style={{ borderTop: `3px solid ${ACTION_COLORS.crypto}` }}
        >
          <div className="mb-1 text-[18px] sm:mb-2 sm:text-[22px]">₿</div>
          <div className="text-[8px] font-bold uppercase tracking-[.4px] text-[var(--text2)] sm:text-[9px] sm:tracking-[.6px]">Crypto</div>
        </button>
      </div>
    </section>
  )
}
