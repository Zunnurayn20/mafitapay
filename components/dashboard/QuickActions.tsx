'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bitcoin,
  Building2,
  Check,
  Copy,
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

/** Cream receipt panel from deposit modal (dashed gold top strip). Compact height. */
function FundingReceiptShell({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`relative h-full overflow-hidden rounded-2xl border border-[rgba(202,165,96,.26)] bg-[linear-gradient(180deg,#fcf7ec_0%,#f6efdd_100%)] text-[#2c2418] shadow-[0_12px_28px_rgba(0,0,0,.14)] ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(90deg,rgba(202,165,96,.55)_0_16px,transparent_16px_24px)]"
      />
      <div className="relative h-full">{children}</div>
    </div>
  )
}

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
  labelClassName = 'text-[var(--text2)]',
}: {
  label: string
  tint: string
  Icon: LucideIcon
  disabled?: boolean
  onClick: () => void
  labelClassName?: string
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
      <span className={`text-center text-[11px] font-medium leading-tight ${labelClassName}`}>
        {label}
      </span>
      {disabled ? (
        <span className="text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)]">Off</span>
      ) : null}
    </button>
  )
}

function providerLabel(provider: string) {
  if (provider === 'palmpay') return 'PalmPay'
  if (provider === 'flutterwave') return 'Flutterwave'
  return provider
}

function DesktopFundingAccount() {
  const wallet = useAppStore(state => state.wallet)
  const openModal = useAppStore(state => state.openModal)
  const showToast = useAppStore(state => state.showToast)
  const [copied, setCopied] = useState(false)

  const account = useMemo(() => {
    const accounts = wallet?.virtualAccounts ?? []
    return (
      accounts.find(item => item.provider === 'palmpay' && item.isPermanent)
      ?? accounts.find(item => item.provider === 'flutterwave' && item.isPermanent)
      ?? accounts.find(item => item.isPermanent)
      ?? accounts[0]
      ?? null
    )
  }, [wallet?.virtualAccounts])

  async function copyNumber() {
    if (!account?.accountNumber) return
    try {
      await navigator.clipboard.writeText(account.accountNumber)
      setCopied(true)
      showToast('Account number copied', 'success')
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      showToast('Unable to copy account number', 'error')
    }
  }

  if (!account) {
    return (
      <FundingReceiptShell>
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8c6b31]">
              Virtual account
            </div>
            <div className="mt-0.5 truncate text-[13px] font-semibold text-[#1f1a12]">No account yet</div>
          </div>
          <button
            type="button"
            onClick={() => openModal('deposit')}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-[#8c6b31] px-3 text-[11px] font-bold text-white transition-transform active:scale-[0.98]"
          >
            Get account
          </button>
        </div>
      </FundingReceiptShell>
    )
  }

  return (
    <FundingReceiptShell>
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] text-[#7c6a4b]">
            <Building2 size={13} className="shrink-0 text-[#8c6b31]" />
            <span className="truncate font-medium">{account.bank || providerLabel(account.provider)}</span>
            <span className="shrink-0 rounded-full border border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.7)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.4px] text-[#8c6b31]">
              {providerLabel(account.provider)}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-lg font-bold tracking-wider text-[#1f1a12]">
            {account.accountNumber}
          </div>
          {account.accountName ? (
            <div className="mt-0.5 truncate text-[11px] font-semibold text-[#5c4630]">
              {account.accountName}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void copyNumber()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.7)] px-2.5 text-[11px] font-bold text-[#8c6b31] transition-transform active:scale-[0.98]"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </FundingReceiptShell>
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

  function renderActionTiles(labelClassName?: string) {
    return (
      <>
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
              labelClassName={labelClassName}
            />
          )
        })}

        <ActionTile
          label="Crypto"
          tint={ACTION_META.crypto.tint}
          Icon={ACTION_META.crypto.icon}
          onClick={openCrypto}
          labelClassName={labelClassName}
        />

        <ActionTile
          label="More"
          tint={ACTION_META.more.tint}
          Icon={ACTION_META.more.icon}
          onClick={() => setMoreOpen(true)}
          labelClassName={labelClassName}
        />
      </>
    )
  }

  return (
    <section>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        Quick actions
      </div>

      {/* Mobile: full-width action grid only */}
      <div className="grid grid-cols-4 gap-2.5 lg:hidden">
        {renderActionTiles()}
      </div>

      {/* Desktop: equal halves — deposit-style cream cards with dashed gold top strip */}
      <div className="hidden items-stretch gap-5 lg:grid lg:grid-cols-2">
        <DesktopFundingAccount />
        <FundingReceiptShell>
          <div className="grid h-full grid-cols-4 content-center justify-items-center gap-x-5 gap-y-2 px-5 py-3">
            {renderActionTiles('text-[#5c4630]')}
          </div>
        </FundingReceiptShell>
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
