'use client'
import { useState } from 'react'
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/Card'
import { useP2PMerchants } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'

export default function P2PPage() {
  const { openModal, setModalData } = useAppStore()
  const merchants = useP2PMerchants()
  const [tab, setTab] = useState<'deposit' | 'withdraw' | 'orders'>('deposit')

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.95fr)]">
      <div>
        <div className="mb-5 flex border-b border-[var(--border)]">
          {(['deposit', 'withdraw', 'orders'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-5 py-3 text-[11px] font-bold uppercase tracking-wider transition-all ${tab === t ? 'border-[var(--gold)] text-[var(--gold2)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text2)]'}`}
            >
              {t}
            </button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{tab === 'orders' ? 'My Orders' : `${tab.charAt(0).toUpperCase() + tab.slice(1)} Offers`}</CardTitle>
            <CardAction>{merchants.filter(item => item.isOnline).length} online</CardAction>
          </CardHeader>

          {tab === 'orders' ? (
            <div className="py-14 text-center text-[12px] text-[var(--muted)]">
              <div className="mb-3 text-[28px]">🔄</div>
              No active P2P orders. Start a deposit or withdrawal to begin.
            </div>
          ) : merchants.map(m => (
            <div key={m.id} className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4 transition-colors last:border-0 hover:bg-[var(--clay)]">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--clay2)] font-display text-sm font-bold text-[var(--gold)]">{m.initial}</div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[var(--text)]"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--green2)]" />{m.name}</div>
                <div className="text-[9px] text-[var(--muted)]">{m.completionRate}% completion · {m.totalTrades} trades · ₦1.00/₦1.00</div>
              </div>
              <div className="mr-3 text-right">
                <div className="font-mono text-[10px] text-[var(--text2)]">₦{m.minAmount / 1000}k – ₦{m.maxAmount >= 1000000 ? m.maxAmount / 1000000 + 'M' : m.maxAmount / 1000 + 'k'}</div>
                <div className="mt-0.5 text-[9px] text-[var(--green2)]">₦{(m.availableBalance / 1000).toFixed(0)}k avail</div>
              </div>
              <button
                onClick={() => {
                  if (tab === 'withdraw') {
                    setModalData({ withdrawMode: 'merchant', merchantId: m.id, merchantName: m.name })
                    openModal('withdraw')
                    return
                  }
                  setModalData({ merchant: m })
                  openModal('p2p')
                }}
                className="flex-shrink-0 bg-[var(--green)] px-4 py-2 text-[9px] font-bold uppercase text-[var(--char)] transition-opacity hover:opacity-85"
              >{tab === 'deposit' ? 'Deposit →' : 'Withdraw →'}</button>
            </div>
          ))}
        </Card>
      </div>

      <div className="space-y-5">
        <div className="text-[8px] font-bold uppercase tracking-[1.4px] text-[var(--muted)]">How P2P Works</div>
        <Card className="p-5">
          {[
            { step: '01', title: 'Choose a merchant', desc: 'Select from our verified merchants. Check completion rate and limits.' },
            { step: '02', title: 'Enter the amount', desc: 'Enter how much you want to deposit or withdraw.' },
            { step: '03', title: 'Make the transfer', desc: 'Transfer to the merchant\'s bank account using your bank app.' },
            { step: '04', title: 'Confirm & receive', desc: 'Tap "I\'ve Sent It" and your wallet credits instantly once merchant confirms.' },
          ].map(s => (
            <div key={s.step} className="flex gap-4 border-b border-[var(--border)] py-4 last:border-0">
              <div className="w-8 flex-shrink-0 font-display text-[22px] font-black text-[var(--gold2)] opacity-30">{s.step}</div>
              <div>
                <div className="mb-1 text-[12px] font-bold text-[var(--text)]">{s.title}</div>
                <div className="text-[11px] leading-relaxed text-[var(--muted)]">{s.desc}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
