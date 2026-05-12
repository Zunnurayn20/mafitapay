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
    .filter(item => item.isActive !== false && DISPLAY_ORDER.includes(item.id as (typeof DISPLAY_ORDER)[number]))
    .sort((a, b) => DISPLAY_ORDER.indexOf(a.id as (typeof DISPLAY_ORDER)[number]) - DISPLAY_ORDER.indexOf(b.id as (typeof DISPLAY_ORDER)[number]))

  return (
    <section className="space-y-3">
      <div className="text-[8px] font-bold uppercase tracking-[1.4px] text-[var(--muted)]">Quick Services</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 xl:grid-cols-5">
        {providers.map(provider => (
          <button
            key={provider.id}
            onClick={() => {
              setModalData({ service: provider.name })
              openModal('bills')
            }}
            className="min-h-28 border border-[var(--border)] bg-[var(--coal)] p-4 text-center transition-all hover:-translate-y-0.5 hover:bg-[var(--clay)]"
            style={{ borderTop: `3px solid ${ACTION_COLORS[provider.id] || 'var(--gold)'}` }}
          >
            <div className="text-[22px] mb-2">{provider.icon}</div>
            <div className="text-[9px] font-bold uppercase tracking-[.6px] text-[var(--text2)]">{provider.name}</div>
          </button>
        ))}
        <button
          onClick={() => router.push('/crypto')}
          className="min-h-28 border border-[var(--border)] bg-[var(--coal)] p-4 text-center transition-all hover:-translate-y-0.5 hover:bg-[var(--clay)]"
          style={{ borderTop: `3px solid ${ACTION_COLORS.crypto}` }}
        >
          <div className="text-[22px] mb-2">₿</div>
          <div className="text-[9px] font-bold uppercase tracking-[.6px] text-[var(--text2)]">Crypto</div>
        </button>
      </div>
    </section>
  )
}
