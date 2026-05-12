'use client'
import { useAppStore } from '@/store'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { useBillProviders } from '@/lib/client/catalogs'

export function ServicesGrid() {
  const { openModal, setModalData } = useAppStore()
  const providers = useBillProviders().filter(item => item.isActive !== false)
  return (
    <Card>
      <CardHeader><CardTitle>Services</CardTitle></CardHeader>
      <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
        {providers.map(p => (
          <div
            key={p.id}
            onClick={() => { setModalData({ service: p.name }); openModal('bills') }}
            className="bg-[var(--coal)] p-5 text-center cursor-pointer hover:bg-[var(--clay)] transition-colors"
          >
            <div className="text-[24px] mb-2">{p.icon}</div>
            <div className="text-[8px] font-bold uppercase tracking-[.6px] text-[var(--text2)]">{p.name}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
