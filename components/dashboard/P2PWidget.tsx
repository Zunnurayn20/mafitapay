'use client'
import { useAppStore } from '@/store'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardAction } from '@/components/ui/Card'
import { useP2PMerchants } from '@/lib/client/catalogs'

export function P2PWidget() {
  const { openModal, setModalData } = useAppStore()
  const merchants = useP2PMerchants()
  const router = useRouter()
  return (
    <Card>
      <CardHeader>
        <CardTitle>P2P Merchants</CardTitle>
        <CardAction onClick={() => router.push('/p2p')}>All Offers →</CardAction>
      </CardHeader>
      {merchants.map(m => (
        <div key={m.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--border)] last:border-0 hover:bg-[var(--clay)] transition-colors">
          <div className="w-9 h-9 rounded-full bg-[var(--clay2)] border border-[var(--border)] flex items-center justify-center font-display font-bold text-sm text-[var(--gold)] flex-shrink-0">{m.initial}</div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-[var(--text)]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--green2)] mr-1.5" />{m.name}
            </div>
            <div className="text-[9px] text-[var(--muted)]">{m.completionRate}% · {m.totalTrades} trades</div>
          </div>
          <div className="text-right mr-2.5">
            <div className="text-[10px] font-mono text-[var(--text2)]">₦{m.minAmount/1000}k–₦{m.maxAmount >= 1000000 ? m.maxAmount/1000000+'M' : m.maxAmount/1000+'k'}</div>
          </div>
          <button
            onClick={() => { setModalData({ merchant: m }); openModal('p2p') }}
            className="px-3 py-1.5 text-[9px] font-bold uppercase bg-[var(--green)] text-[var(--char)] hover:opacity-85 transition-opacity flex-shrink-0"
          >Deposit</button>
        </div>
      ))}
    </Card>
  )
}
