'use client'
import { useState } from 'react'
import { Eye, EyeOff, Plus, Send } from 'lucide-react'
import { useAppStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { formatNGN } from '@/lib/utils'

export function WalletHero() {
  const { wallet, openModal } = useAppStore()
  const [visible, setVisible] = useState(true)
  const availableBalance = wallet?.balance ?? 0
  const reserveBalance = wallet?.reserveBalance ?? 0
  const reserveLockedBalance = wallet?.reserveLockedBalance ?? 0
  const totalReserved = reserveBalance + reserveLockedBalance

  return (
    <Card
      // Hardcoded hex, not a theme token: the balance, labels and buttons in here are all light
      // colours, so the card has to stay dark in light mode too -- same reason GoldBanner does it.
      className="overflow-hidden border-[rgba(202,165,96,0.28)] bg-[linear-gradient(135deg,#050403_0%,#1a140c_28%,#3d2e18_50%,#1a140c_72%,#050403_100%)] p-5 sm:p-6"
      accent="repeating-linear-gradient(90deg,var(--gold) 0,var(--gold) 10px,var(--terra) 10px,var(--terra) 18px,var(--green) 18px,var(--green) 26px,var(--char) 26px,var(--char) 30px)"
      pattern="plain"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: `
            radial-gradient(circle at 18px 18px, rgba(224,196,138,0.26) 0 2px, transparent 2px),
            linear-gradient(135deg, transparent 0 40%, rgba(202,165,96,0.22) 40% 44%, transparent 44% 56%, rgba(202,165,96,0.22) 56% 60%, transparent 60% 100%),
            linear-gradient(45deg, transparent 0 40%, rgba(140,107,49,0.18) 40% 44%, transparent 44% 56%, rgba(140,107,49,0.18) 56% 60%, transparent 60% 100%)
          `,
          backgroundSize: '28px 28px, 72px 72px, 72px 72px',
          backgroundPosition: '0 0, 0 0, 36px 36px',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-[0.22]"
        style={{ background: 'linear-gradient(180deg, transparent 0%, rgba(202,165,96,0.12) 100%)' }}
      />

      <div className="relative z-[1]">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[rgba(233,214,186,0.7)]">
          Wallet balance
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div
            className={`font-display text-[clamp(2rem,8vw,2.75rem)] font-extrabold leading-none tracking-tight text-[rgba(248,238,220,0.96)] transition-all ${
              !visible ? 'select-none blur-sm' : ''
            }`}
          >
            {wallet ? formatNGN(availableBalance) : '₦—'}
          </div>
          <button
            type="button"
            onClick={() => setVisible(v => !v)}
            className="mb-1 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(224,196,138,0.18)] bg-[rgba(224,196,138,0.08)] text-[rgba(244,231,208,0.8)] transition-colors hover:bg-[rgba(224,196,138,0.14)]"
            aria-label={visible ? 'Hide balance' : 'Show balance'}
          >
            {visible ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
        </div>

        {totalReserved > 0 && (
          <div className="mt-2.5 inline-flex border border-[rgba(224,196,138,0.2)] bg-[rgba(224,196,138,0.08)] px-2.5 py-1 text-[10px] font-mono font-bold text-[rgba(244,231,208,0.86)]">
            Reserve: {formatNGN(totalReserved)}
          </div>
        )}

          <div className="mt-5 flex gap-2.5">
            <button
              type="button"
              onClick={() => openModal('deposit')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--green)] py-3 text-xs font-bold text-[var(--char)] transition-transform active:scale-[0.98]"
            >
              <Plus size={14} strokeWidth={2.25} />
              Deposit
            </button>
            <button
              type="button"
              onClick={() => openModal('send')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[rgba(224,196,138,0.28)] bg-[rgba(224,196,138,0.12)] py-3 text-xs font-semibold text-[rgba(248,238,220,0.95)] transition-transform active:scale-[0.98]"
            >
              <Send size={14} strokeWidth={2} />
              Send
            </button>
          </div>
      </div>
    </Card>
  )
}
