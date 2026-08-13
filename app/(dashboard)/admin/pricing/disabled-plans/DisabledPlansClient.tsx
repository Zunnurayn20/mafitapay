'use client'

import { useState } from 'react'
import { AdminButton, AdminError, AdminInput, AdminSelect, AdminTable, AdminThead } from '@/components/admin/AdminUi'

type DisabledPlan = { vendor: 'amigo' | 'asbdata' | 'bardetech'; networkId: number; planId: string; reason?: string; disabledAt: string; disabledBy?: string }
type CatalogPlan = { vendor: DisabledPlan['vendor']; networkId: number; network: string; planId: string; label: string }
const VENDOR_LABELS = { amigo: 'Amigo', asbdata: 'ASBDATA', bardetech: 'Bardetech' } as const

export function DisabledPlansClient({ initialPlans, catalog }: { initialPlans: DisabledPlan[]; catalog: CatalogPlan[] }) {
  const [plans, setPlans] = useState(initialPlans)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<{ vendor: DisabledPlan['vendor']; networkId: string; planId: string; reason: string }>({ vendor: 'asbdata', networkId: '', planId: '', reason: '' })
  const vendorPlans = catalog.filter(plan => plan.vendor === form.vendor)
  const networks = Array.from(new Map(vendorPlans.map(plan => [plan.networkId, plan.network])).entries())
  const availablePlans = vendorPlans.filter(plan => String(plan.networkId) === form.networkId)

  async function update(payload: Record<string, unknown>) {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/admin/disabled-data-plans', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to save the plan setting.')
      setPlans(result.data)
      return true
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save the plan setting.'); return false } finally { setBusy(false) }
  }

  async function disable(event: React.FormEvent) {
    event.preventDefault()
    const saved = await update({ vendor: form.vendor, networkId: Number(form.networkId), planId: form.planId, reason: form.reason, disabled: true })
    if (saved) setForm(current => ({ ...current, planId: '', reason: '' }))
  }

  return <div className="space-y-6 p-4">
    <form onSubmit={disable} className="grid gap-3 md:grid-cols-4">
      <AdminSelect value={form.vendor} onChange={event => setForm({ vendor: event.target.value as DisabledPlan['vendor'], networkId: '', planId: '', reason: '' })}>
        {Object.entries(VENDOR_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </AdminSelect>
      <AdminSelect required value={form.networkId} onChange={event => setForm(current => ({ ...current, networkId: event.target.value, planId: '' }))}>
        <option value="">Choose network</option>
        {networks.map(([id, network]) => <option key={id} value={id}>{network}</option>)}
      </AdminSelect>
      <AdminSelect required disabled={!form.networkId} value={form.planId} onChange={event => setForm(current => ({ ...current, planId: event.target.value }))}>
        <option value="">Choose data plan</option>
        {availablePlans.map(plan => <option key={plan.planId} value={plan.planId}>{plan.label}</option>)}
      </AdminSelect>
      <AdminInput placeholder="Reason (optional)" value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} />
      <div className="md:col-span-4"><AdminButton disabled={busy || !form.networkId || !form.planId} type="submit">{busy ? 'Saving…' : 'Disable selected plan'}</AdminButton></div>
    </form>
    <AdminError message={error} />
    <AdminTable><AdminThead columns={['Provider', 'Network ID', 'Plan ID', 'Reason', '']} /><tbody>
      {plans.map(plan => <tr key={`${plan.vendor}:${plan.networkId}:${plan.planId}`}><td>{plan.vendor}</td><td>{plan.networkId}</td><td>{plan.planId}</td><td>{plan.reason || '—'}</td><td><AdminButton disabled={busy} onClick={() => void update({ ...plan, disabled: false })}>Enable</AdminButton></td></tr>)}
      {!plans.length && <tr><td colSpan={5} className="py-6 text-center text-slate-500">No plans are disabled.</td></tr>}
    </tbody></AdminTable>
  </div>
}
