'use client'
import { Card } from '@/components/ui/Card'
import { useBillProviders } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { fmtDate, formatNGN } from '@/lib/utils'

const BILL_TYPES = ['airtime', 'data', 'electric', 'cable', 'education', 'gas', 'insurance', 'water']

export default function BillsPage() {
  const { openModal, setModalData, transactions } = useAppStore()
  const providers = useBillProviders()
  const billTransactions = transactions.filter(tx => BILL_TYPES.includes(tx.type)).slice(0, 8)

  return (
    <div className="space-y-6">
      <div className="text-[8px] font-bold uppercase tracking-[1.4px] text-[var(--muted)]">Select a Service</div>
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-4">
        {providers.map(p => (
          <button
            key={p.id}
            onClick={() => {
              if (p.isActive === false) return
              setModalData({ service: p.name }); openModal('bills')
            }}
            disabled={p.isActive === false}
            className={`border border-[var(--border)] p-6 text-center transition-all ${
              p.isActive === false
                ? 'bg-[rgba(255,255,255,.03)] opacity-55'
                : 'bg-[var(--coal)] hover:-translate-y-0.5 hover:bg-[var(--clay)]'
            }`}
            style={{ borderTop: '3px solid var(--gold)' }}
          >
            <div className="text-[30px] mb-3">{p.icon}</div>
            <div className="text-[11px] font-bold text-[var(--text)]">{p.name}</div>
            <div className="text-[9px] text-[var(--muted)] mt-1">
              {p.isActive === false ? 'Unavailable' : 'Live via Flutterwave'}
            </div>
          </button>
        ))}
      </div>
      <Card className="overflow-hidden p-0">
        <div className="border-b border-[var(--border)] bg-[var(--clay)] px-5 py-4 text-[11px] font-bold text-[var(--text)]">
          Bills History
        </div>
        {billTransactions.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-[var(--muted)]">
            No bill payments yet.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {billTransactions.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 px-5 py-4">
                <div className="text-[22px]">
                  {'icon' in tx && typeof tx.icon === 'string' ? tx.icon : '•'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[var(--text)]">
                    {tx.description}
                  </div>
                  <div className="mt-1 text-[9px] font-mono text-[var(--muted)]">
                    {fmtDate(tx.createdAt)}
                  </div>
                </div>
                <div className={`text-right text-[13px] font-bold font-mono ${tx.amount > 0 ? 'text-[var(--green2)]' : 'text-[var(--text2)]'}`}>
                  {tx.amount > 0 ? '+' : ''}{formatNGN(tx.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
