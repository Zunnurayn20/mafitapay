'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bitcoin,
  GraduationCap,
  Grid2X2,
  Shield,
  Smartphone,
  TrendingUp,
  Tv,
  Wifi,
  Zap,
  Droplets,
  Flame,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { useBillProviders } from '@/lib/client/catalogs'
import { Modal } from '@/components/ui/Modal'

const PRIMARY_IDS = ['airtime', 'data'] as const

const ACTION_META: Record<string, { icon: LucideIcon; tint: string; label?: string }> = {
  airtime: {
    icon: Smartphone,
    tint: 'bg-amber-50 text-amber-700 border-white/70',
    label: 'Airtime',
  },
  data: {
    icon: Wifi,
    tint: 'bg-blue-50 text-[#2C5AA0] border-white/70',
    label: 'Data',
  },
  cable: {
    icon: Tv,
    tint: 'bg-violet-50 text-violet-700 border-white/70',
  },
  electric: {
    icon: Zap,
    tint: 'bg-emerald-50 text-emerald-700 border-white/70',
  },
  education: {
    icon: GraduationCap,
    tint: 'bg-sky-50 text-sky-700 border-white/70',
  },
  edu: {
    icon: GraduationCap,
    tint: 'bg-sky-50 text-sky-700 border-white/70',
  },
  gas: {
    icon: Flame,
    tint: 'bg-orange-50 text-orange-700 border-white/70',
  },
  insurance: {
    icon: Shield,
    tint: 'bg-rose-50 text-rose-700 border-white/70',
  },
  insure: {
    icon: Shield,
    tint: 'bg-rose-50 text-rose-700 border-white/70',
  },
  water: {
    icon: Droplets,
    tint: 'bg-cyan-50 text-cyan-700 border-white/70',
  },
  crypto: {
    icon: Bitcoin,
    tint: 'bg-orange-50 text-orange-700 border-white/70',
    label: 'Crypto',
  },
  stocks: {
    icon: TrendingUp,
    tint: 'bg-yellow-50 text-yellow-800 border-white/70',
    label: 'Stocks',
  },
  more: {
    icon: Grid2X2,
    tint: 'bg-slate-100 text-slate-700 border-white/70',
    label: 'More',
  },
}

function ActionTile({
  label,
  tint,
  Icon,
  disabled,
  onClick,
}: {
  label: string
  tint: string
  Icon: LucideIcon
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex flex-col items-center gap-2 ${disabled ? 'opacity-50' : ''}`}
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl border shadow-[0_3px_16px_-6px_rgba(15,23,42,0.16)] transition-transform group-active:scale-95 ${tint}`}
      >
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <span className="text-center text-[11px] font-medium leading-tight text-[var(--text2)]">
        {label}
      </span>
      {disabled ? (
        <span className="text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)]">Off</span>
      ) : null}
    </button>
  )
}

export function QuickActions() {
  const { openModal, setModalData } = useAppStore()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const providers = useBillProviders()

  const primaryProviders = useMemo(
    () =>
      PRIMARY_IDS.map(id => providers.find(p => p.id === id)).filter(
        (item): item is NonNullable<typeof item> => Boolean(item),
      ),
    [providers],
  )

  const moreProviders = useMemo(
    () => providers.filter(p => !PRIMARY_IDS.includes(p.id as (typeof PRIMARY_IDS)[number])),
    [providers],
  )

  function openBill(serviceName: string) {
    setMoreOpen(false)
    setModalData({ service: serviceName })
    openModal('bills')
  }

  function openCrypto() {
    setMoreOpen(false)
    router.push('/crypto')
  }

  function openStocks() {
    setMoreOpen(false)
    router.push('/stocks')
  }

  return (
    <section>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        Quick actions
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {primaryProviders.map(provider => {
          const meta = ACTION_META[provider.id] || ACTION_META.data
          return (
            <ActionTile
              key={provider.id}
              label={meta.label || provider.name}
              tint={meta.tint}
              Icon={meta.icon}
              disabled={provider.isActive === false}
              onClick={() => openBill(provider.name)}
            />
          )
        })}

        <ActionTile
          label="Crypto"
          tint={ACTION_META.crypto.tint}
          Icon={ACTION_META.crypto.icon}
          onClick={openCrypto}
        />

        <ActionTile
          label="More"
          tint={ACTION_META.more.tint}
          Icon={ACTION_META.more.icon}
          onClick={() => setMoreOpen(true)}
        />
      </div>

      <Modal
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="All services"
        subtitle="Choose a service to continue"
        size="md"
      >
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {primaryProviders.map(provider => {
              const meta = ACTION_META[provider.id] || ACTION_META.data
              return (
                <ActionTile
                  key={`more-${provider.id}`}
                  label={meta.label || provider.name}
                  tint={meta.tint}
                  Icon={meta.icon}
                  disabled={provider.isActive === false}
                  onClick={() => openBill(provider.name)}
                />
              )
            })}

            <ActionTile
              label="Crypto"
              tint={ACTION_META.crypto.tint}
              Icon={ACTION_META.crypto.icon}
              onClick={openCrypto}
            />

            <ActionTile
              label="Stocks"
              tint={ACTION_META.stocks.tint}
              Icon={ACTION_META.stocks.icon}
              onClick={openStocks}
            />

            {moreProviders.map(provider => {
              const meta = ACTION_META[provider.id] || ACTION_META[provider.type] || {
                icon: Grid2X2,
                tint: 'bg-slate-100 text-slate-700 border-white/70',
              }
              return (
                <ActionTile
                  key={`more-extra-${provider.id}`}
                  label={provider.name}
                  tint={meta.tint}
                  Icon={meta.icon}
                  disabled={provider.isActive === false}
                  onClick={() => openBill(provider.name)}
                />
              )
            })}
          </div>
        </div>
      </Modal>
    </section>
  )
}
