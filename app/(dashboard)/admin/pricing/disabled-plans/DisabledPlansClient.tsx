'use client'

import { useMemo, useState } from 'react'
import { AdminButton, AdminError, AdminInput, AdminSelect, AdminTable, AdminThead, formatNaira } from '@/components/admin/AdminUi'

type DisabledPlan = { vendor: 'amigo' | 'asbdata' | 'bardetech'; networkId: number; planId: string; reason?: string; disabledAt: string; disabledBy?: string }
type CatalogPlan = { vendor: DisabledPlan['vendor']; networkId: number; network: string; planId: string; category: string; label: string; validity: string; retailNgn: number }
const VENDOR_LABELS = { amigo: 'Amigo', asbdata: 'ASBDATA', bardetech: 'Bardetech' } as const

export function DisabledPlansClient({ initialPlans, catalog }: { initialPlans: DisabledPlan[]; catalog: CatalogPlan[] }) {
  const [plans, setPlans] = useState(initialPlans)
  const [error, setError] = useState('')
  const [busyPlan, setBusyPlan] = useState('')
  const [vendor, setVendor] = useState<DisabledPlan['vendor']>('asbdata')
  const [networkId, setNetworkId] = useState('')
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState('')
  const vendorPlans = catalog.filter(plan => plan.vendor === vendor)
  const networks = Array.from(new Map(vendorPlans.map(plan => [plan.networkId, plan.network])).entries())
  const categories = Array.from(new Set(vendorPlans.filter(plan => !networkId || String(plan.networkId) === networkId).map(plan => plan.category).filter(Boolean))).sort()
  const filteredPlans = useMemo(() => {
    const search = query.trim().toLowerCase()
    return vendorPlans.filter(plan => (
      (!networkId || String(plan.networkId) === networkId)
      && (!category || plan.category === category)
      && (!search || `${plan.network} ${plan.category} ${plan.label} ${plan.validity}`.toLowerCase().includes(search))
    ))
  }, [vendorPlans, networkId, category, query])

  async function update(payload: Record<string, unknown>) {
    setBusyPlan(`${payload.vendor}:${payload.networkId}:${payload.planId}`); setError('')
    try {
      const response = await fetch('/api/admin/disabled-data-plans', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to save the plan setting.')
      setPlans(result.data)
      return true
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save the plan setting.'); return false } finally { setBusyPlan('') }
  }

  return <div className="space-y-5 p-4">
    <div className="grid gap-3 md:grid-cols-4">
      <AdminSelect value={vendor} onChange={event => { setVendor(event.target.value as DisabledPlan['vendor']); setNetworkId(''); setCategory(''); setQuery('') }}>
        {Object.entries(VENDOR_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </AdminSelect>
      <AdminSelect value={networkId} onChange={event => { setNetworkId(event.target.value); setCategory('') }}>
        <option value="">All networks</option>
        {networks.map(([id, network]) => <option key={id} value={id}>{network}</option>)}
      </AdminSelect>
      <AdminSelect value={category} onChange={event => setCategory(event.target.value)}>
        <option value="">All categories</option>
        {categories.map(value => <option key={value} value={value}>{value}</option>)}
      </AdminSelect>
      <AdminInput placeholder="Search: 1GB, SME, 30 days…" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <AdminInput placeholder="Reason applied when you disable a plan (optional)" value={reason} onChange={event => setReason(event.target.value)} className="w-full" />
    <p className="text-sm text-slate-500">Showing {filteredPlans.length} available plan{filteredPlans.length === 1 ? '' : 's'}. Choose the exact row to disable it.</p>
    <AdminError message={error} />
    <AdminTable><AdminThead columns={['Network', 'Category', 'Plan', 'Validity', 'Retail price', '']} /><tbody>
      {filteredPlans.map(plan => {
        const key = `${plan.vendor}:${plan.networkId}:${plan.planId}`
        return <tr key={key} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold text-slate-800">{plan.network}</td><td className="px-4 py-3 text-slate-600">{plan.category || '—'}</td><td className="px-4 py-3 text-slate-800">{plan.label}</td><td className="px-4 py-3 text-slate-600">{plan.validity}</td><td className="px-4 py-3 font-semibold text-slate-800">{formatNaira(plan.retailNgn)}</td><td className="px-4 py-3 text-right"><AdminButton disabled={Boolean(busyPlan)} onClick={() => void update({ vendor: plan.vendor, networkId: plan.networkId, planId: plan.planId, reason, disabled: true })}>{busyPlan === key ? 'Disabling…' : 'Disable'}</AdminButton></td></tr>
      })}
      {!filteredPlans.length && <tr><td colSpan={6} className="py-8 text-center text-slate-500">No available plans match these filters.</td></tr>}
    </tbody></AdminTable>
    <div className="border-t border-slate-200 pt-5">
      <h3 className="text-sm font-bold text-slate-900">Disabled plans</h3>
      <AdminTable><AdminThead columns={['Provider', 'Network ID', 'Plan ID', 'Reason', '']} /><tbody>
        {plans.map(plan => { const key = `${plan.vendor}:${plan.networkId}:${plan.planId}`; return <tr key={key}><td>{plan.vendor}</td><td>{plan.networkId}</td><td>{plan.planId}</td><td>{plan.reason || '—'}</td><td><AdminButton disabled={Boolean(busyPlan)} onClick={() => void update({ ...plan, disabled: false })}>{busyPlan === key ? 'Enabling…' : 'Enable'}</AdminButton></td></tr> })}
        {!plans.length && <tr><td colSpan={5} className="py-6 text-center text-slate-500">No plans are disabled.</td></tr>}
      </tbody></AdminTable>
    </div>
  </div>
}
