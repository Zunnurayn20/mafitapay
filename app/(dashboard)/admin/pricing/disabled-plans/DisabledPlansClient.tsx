'use client'

import { useMemo, useState } from 'react'
import { AdminError, AdminInput, AdminSelect, AdminTable, AdminThead, formatNaira } from '@/components/admin/AdminUi'

type DisabledPlan = { vendor: 'amigo' | 'asbdata' | 'bardetech' | 'flutterwave'; networkId: number; planId: string; reason?: string; disabledAt: string; disabledBy?: string }
type CatalogPlan = { vendor: DisabledPlan['vendor']; networkId: number; network: string; planId: string; category: string; label: string; validity: string; retailNgn: number }
const VENDOR_LABELS = { amigo: 'Amigo', asbdata: 'ASBDATA', bardetech: 'Bardetech', flutterwave: 'Flutterwave' } as const

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
  const disabledCount = filteredPlans.filter(plan => plans.some(item => item.vendor === plan.vendor && item.networkId === plan.networkId && item.planId === plan.planId)).length
  const allPlansEnabled = filteredPlans.length > 0 && disabledCount === 0
  const mixedPlanSettings = disabledCount > 0 && disabledCount < filteredPlans.length

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

  async function updateAllPlans(disabled: boolean) {
    setBusyPlan('__bulk__')
    setError('')
    try {
      const response = await fetch('/api/admin/disabled-data-plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans: filteredPlans.map(({ vendor, networkId, planId }) => ({ vendor, networkId, planId })), disabled, reason }),
      })
      const result = await response.json()
      if (!response.ok || !result.success || !Array.isArray(result.data)) throw new Error(result.error || 'Unable to save the data plan settings.')
      setPlans(result.data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save the data plan settings.')
    } finally {
      setBusyPlan('')
    }
  }

  function PlanSwitch({ plan, disabled }: { plan: Pick<DisabledPlan, 'vendor' | 'networkId' | 'planId'>; disabled: boolean }) {
    const key = `${plan.vendor}:${plan.networkId}:${plan.planId}`
    return <div className="flex items-center justify-end gap-3">
      <span className={`text-xs font-semibold ${disabled ? 'text-amber-700' : 'text-emerald-700'}`}>{disabled ? 'Disabled' : 'Enabled'}</span>
      <button type="button" role="switch" aria-label={`${disabled ? 'Enable' : 'Disable'} this data plan`} aria-checked={!disabled}
        disabled={Boolean(busyPlan)} onClick={() => void update({ ...plan, reason, disabled: !disabled })}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-wait disabled:opacity-50 ${disabled ? 'border-slate-300 bg-slate-300' : 'border-emerald-600 bg-emerald-600'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${disabled ? 'translate-x-1' : 'translate-x-5'}`} />
        <span className="sr-only">{busyPlan === key ? 'Saving' : disabled ? 'Disabled' : 'Enabled'}</span>
      </button>
    </div>
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
    <p className="text-sm text-slate-500">Showing {filteredPlans.length} available plan{filteredPlans.length === 1 ? '' : 's'}. Use each switch to enable or disable that plan.</p>
    <AdminError message={error} />
    <AdminTable><thead className="bg-[var(--clay)] text-xs uppercase tracking-wide text-[var(--muted)]"><tr>
      {['Network', 'Category', 'Plan', 'Validity', 'Retail price'].map(column => <th key={column} className="px-4 py-3 font-bold">{column}</th>)}
      <th className="px-4 py-3 font-bold"><div className="flex items-center justify-end gap-3"><span>All</span>
        <button type="button" role="switch" aria-checked={allPlansEnabled}
          aria-label={`${allPlansEnabled ? 'Disable' : 'Enable'} all ${filteredPlans.length} filtered data plans${mixedPlanSettings ? '; some settings are mixed' : ''}`}
          disabled={Boolean(busyPlan) || filteredPlans.length === 0}
          onClick={() => void updateAllPlans(allPlansEnabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${allPlansEnabled ? 'border-emerald-600 bg-emerald-600' : mixedPlanSettings ? 'border-amber-500 bg-amber-400' : 'border-slate-300 bg-slate-300'}`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${allPlansEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
          <span className="sr-only">{busyPlan === '__bulk__' ? 'Saving all plans' : allPlansEnabled ? 'All enabled' : mixedPlanSettings ? 'Mixed settings' : 'All disabled'}</span>
        </button>
      </div></th>
    </tr></thead><tbody>
      {filteredPlans.map(plan => {
        const key = `${plan.vendor}:${plan.networkId}:${plan.planId}`
        const disabled = plans.some(item => item.vendor === plan.vendor && item.networkId === plan.networkId && item.planId === plan.planId)
        return <tr key={key} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold text-slate-800">{plan.network}</td><td className="px-4 py-3 text-slate-600">{plan.category || '—'}</td><td className="px-4 py-3 text-slate-800">{plan.label}</td><td className="px-4 py-3 text-slate-600">{plan.validity}</td><td className="px-4 py-3 font-semibold text-slate-800">{formatNaira(plan.retailNgn)}</td><td className="px-4 py-3"><PlanSwitch plan={plan} disabled={disabled} /></td></tr>
      })}
      {!filteredPlans.length && <tr><td colSpan={6} className="py-8 text-center text-slate-500">No plans match these filters.</td></tr>}
    </tbody></AdminTable>
    <div className="border-t border-slate-200 pt-5">
      <h3 className="text-sm font-bold text-slate-900">Disabled plans</h3>
      <AdminTable><AdminThead columns={['Provider', 'Network', 'Plan details', 'Reason', '']} /><tbody>
        {plans.map(plan => { const details = catalog.find(item => item.vendor === plan.vendor && item.networkId === plan.networkId && item.planId === plan.planId); const key = `${plan.vendor}:${plan.networkId}:${plan.planId}`; return <tr key={key} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold text-slate-700">{VENDOR_LABELS[plan.vendor]}</td><td className="px-4 py-3 text-slate-700">{details?.network ?? 'Unavailable'}</td><td className="px-4 py-3"><div className="font-medium text-slate-800">{details?.label ?? 'Plan details unavailable'}</div><div className="mt-0.5 text-xs text-slate-500">{[details?.category || 'Standard', details?.validity, details ? formatNaira(details.retailNgn) : null].filter(Boolean).join(' · ')}</div></td><td className="px-4 py-3 text-slate-600">{plan.reason || '—'}</td><td className="px-4 py-3"><PlanSwitch plan={plan} disabled /></td></tr> })}
        {!plans.length && <tr><td colSpan={5} className="py-6 text-center text-slate-500">No plans are disabled.</td></tr>}
      </tbody></AdminTable>
    </div>
  </div>
}
