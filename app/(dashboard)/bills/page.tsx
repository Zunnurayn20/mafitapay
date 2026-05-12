'use client'
import { Card } from '@/components/ui/Card'
import { useBillProviders } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'

export default function BillsPage() {
  const { openModal, setModalData } = useAppStore()
  const providers = useBillProviders().filter(item => item.isActive !== false)
  return (
    <div className="space-y-6">
      <div className="text-[8px] font-bold uppercase tracking-[1.4px] text-[var(--muted)]">Select a Service</div>
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-4">
        {providers.map(p => (
          <button
            key={p.id}
            onClick={() => { setModalData({ service: p.name }); openModal('bills') }}
            className="border border-[var(--border)] bg-[var(--coal)] p-6 text-center transition-all hover:-translate-y-0.5 hover:bg-[var(--clay)]"
            style={{ borderTop: '3px solid var(--gold)' }}
          >
            <div className="text-[30px] mb-3">{p.icon}</div>
            <div className="text-[11px] font-bold text-[var(--text)]">{p.name}</div>
            <div className="text-[9px] text-[var(--muted)] mt-1">Live via Flutterwave</div>
          </button>
        ))}
      </div>
      <Card className="p-5">
        <div className="text-center text-[var(--muted)] text-[12px] py-4">
          {providers.length > 0
            ? 'Select a live service above to make a payment.'
            : 'No live bill services are available right now.'}
        </div>
      </Card>
    </div>
  )
}
