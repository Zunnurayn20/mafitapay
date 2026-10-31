'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  AdminButton,
  AdminError,
  AdminInput,
  AdminSelect,
  AdminStatusPill,
  AdminTable,
  AdminThead,
  formatNaira,
} from '@/components/admin/AdminUi'

export type AdminPricingRule = {
  id: string
  scope: string
  vendor: string | null
  network: string | null
  planType: string | null
  variationCode: string | null
  marginBps: number
  marginKobo: number
  minMarginKobo: number
  maxMarginKobo: number | null
  roundToKobo: number
  active: boolean
  note: string | null
  updatedAt: string
}

export type PricingPreviewRow = {
  vendor: 'amigo' | 'asbdata' | 'bardetech'
  name: string
  variationCode: string
  costNgn: number
  marginNgn: number
  retailNgn: number
}

export type PricingPlanOption = {
  vendor: 'amigo' | 'asbdata' | 'bardetech'
  network: string
  planType: string
  variationCode: string
  label: string
  costNgn: number
  retailNgn: number
}

const SCOPES = ['GLOBAL', 'NETWORK', 'PLAN_TYPE', 'PLAN'] as const

/** Vendor display names. Falls back to the raw value so an unknown vendor is never mislabelled. */
const VENDOR_LABELS: Record<string, string> = {
  amigo: 'Amigo',
  asbdata: 'ASBDATA',
  bardetech: 'Bardetech',
}

function describeScope(rule: AdminPricingRule): string {
  const vendorPrefix = rule.vendor ? `${VENDOR_LABELS[rule.vendor] ?? rule.vendor} · ` : ''
  switch (rule.scope) {
    case 'GLOBAL':
      return `${vendorPrefix}All plans`.trim()
    case 'NETWORK':
      return `${vendorPrefix}${rule.network || 'Network'}`
    case 'PLAN_TYPE':
      return `${vendorPrefix}${[rule.network, rule.planType].filter(Boolean).join(' · ') || 'Plan type'}`
    case 'PLAN':
      return `${vendorPrefix}${[rule.network, `Plan ${rule.variationCode}`].filter(Boolean).join(' · ')}`
    default:
      return 'Unknown'
  }
}

function describeMargin(rule: Pick<AdminPricingRule, 'marginBps' | 'marginKobo'>): string {
  const parts: string[] = []
  if (rule.marginBps > 0) {
    parts.push(`${(rule.marginBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`)
  }
  if (rule.marginKobo > 0) {
    parts.push(formatNaira(rule.marginKobo / 100))
  }
  return parts.length ? parts.join(' + ') : 'No margin'
}

function findPlanRule(rules: AdminPricingRule[], plan: PricingPlanOption) {
  return rules
    .filter(rule => rule.scope === 'PLAN'
      && rule.vendor === plan.vendor
      && rule.network === plan.network
      && rule.variationCode === plan.variationCode
      && (!rule.planType || rule.planType === plan.planType))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
}

export function PricingClient({
  initialRules,
  preview,
  plans,
  networks,
  planTypes,
}: {
  initialRules: AdminPricingRule[]
  preview: PricingPreviewRow[]
  plans: PricingPlanOption[]
  networks: string[]
  planTypes: string[]
}) {
  const router = useRouter()
  const [rules, setRules] = useState(initialRules)
  const initialDefaultRule = initialRules.find(rule => rule.scope === 'GLOBAL' && !rule.vendor) ?? null
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [simpleVendor, setSimpleVendor] = useState<'' | 'amigo' | 'asbdata' | 'bardetech'>('')
  const [simplePlanKey, setSimplePlanKey] = useState('')
  const [simpleProfitType, setSimpleProfitType] = useState<'fixed' | 'percentage'>(
    initialDefaultRule?.marginBps ? 'percentage' : 'fixed',
  )
  const [simpleProfitValue, setSimpleProfitValue] = useState(() => (
    initialDefaultRule?.marginBps
      ? String(initialDefaultRule.marginBps / 100)
      : String((initialDefaultRule?.marginKobo ?? 0) / 100)
  ))

  const [createForm, setCreateForm] = useState({
    scope: 'GLOBAL',
    vendor: '',
    network: '',
    planType: '',
    variationCode: '',
    marginPercent: '2.5',
    marginFlatNgn: '',
    minMarginNgn: '',
    maxMarginNgn: '',
    roundToNgn: '10',
    note: '',
  })

  const [editForm, setEditForm] = useState({
    marginPercent: '',
    marginFlatNgn: '',
    minMarginNgn: '',
    maxMarginNgn: '',
    roundToNgn: '',
    note: '',
  })

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => {
      const scopeOrder = SCOPES.indexOf(a.scope as typeof SCOPES[number]) - SCOPES.indexOf(b.scope as typeof SCOPES[number])
      if (scopeOrder !== 0) return scopeOrder
      return b.updatedAt.localeCompare(a.updatedAt)
    }),
    [rules],
  )

  const defaultRule = rules.find(rule => rule.scope === 'GLOBAL' && !rule.vendor) ?? null
  const providerRule = simpleVendor
    ? rules.find(rule => rule.scope === 'GLOBAL' && rule.vendor === simpleVendor) ?? null
    : defaultRule
  const providerPlans = simpleVendor ? plans.filter(plan => plan.vendor === simpleVendor) : []
  const selectedPlan = providerPlans.find(plan => `${plan.vendor}:${plan.network}:${plan.variationCode}` === simplePlanKey) ?? null
  const planRule = selectedPlan ? findPlanRule(rules, selectedPlan) : null
  const targetRule = selectedPlan ? planRule : providerRule
  const effectiveRule = targetRule ?? providerRule ?? defaultRule
  const selectedVendorLabel = simpleVendor ? VENDOR_LABELS[simpleVendor] : 'all providers'
  const sampleCostKobo = 100_000
  const simpleProfitKobo = simpleProfitType === 'percentage'
    ? Math.round((sampleCostKobo * Math.max(0, Number(simpleProfitValue) || 0) * 100) / 10_000)
    : Math.round(Math.max(0, Number(simpleProfitValue) || 0) * 100)
  const limitedProfitKobo = Math.max(simpleProfitKobo, effectiveRule?.minMarginKobo ?? 0)
  const cappedProfitKobo = effectiveRule?.maxMarginKobo != null
    ? Math.min(limitedProfitKobo, effectiveRule.maxMarginKobo)
    : limitedProfitKobo
  const sampleRoundKobo = effectiveRule?.roundToKobo ?? 0
  const sampleRetailKobo = sampleRoundKobo > 1
    ? Math.ceil((sampleCostKobo + cappedProfitKobo) / sampleRoundKobo) * sampleRoundKobo
    : sampleCostKobo + cappedProfitKobo
  const sampleFinalProfitKobo = sampleRetailKobo - sampleCostKobo

  function selectSimpleVendor(value: '' | 'amigo' | 'asbdata' | 'bardetech') {
    const vendorRule = value
      ? rules.find(rule => rule.scope === 'GLOBAL' && rule.vendor === value) ?? null
      : defaultRule
    const sourceRule = vendorRule ?? defaultRule
    setSimpleVendor(value)
    setSimplePlanKey('')
    setSimpleProfitType(sourceRule?.marginBps ? 'percentage' : 'fixed')
    setSimpleProfitValue(sourceRule?.marginBps
      ? String(sourceRule.marginBps / 100)
      : String((sourceRule?.marginKobo ?? 0) / 100))
  }

  function selectSimplePlan(value: string) {
    const selected = providerPlans.find(plan => `${plan.vendor}:${plan.network}:${plan.variationCode}` === value) ?? null
    const rule = selected ? findPlanRule(rules, selected) : null
    const sourceRule = rule ?? providerRule ?? defaultRule
    setSimplePlanKey(value)
    setSimpleProfitType(sourceRule?.marginBps ? 'percentage' : 'fixed')
    setSimpleProfitValue(sourceRule?.marginBps
      ? String(sourceRule.marginBps / 100)
      : String((sourceRule?.marginKobo ?? 0) / 100))
  }

  async function saveDefaultProfit() {
    setBusy(true)
    setError('')
    try {
      const ruleToUpdate = targetRule
      const ruleToPreserve = ruleToUpdate ?? providerRule ?? defaultRule
      const body = {
        ...(ruleToUpdate ? { id: ruleToUpdate.id } : {
          scope: selectedPlan ? 'PLAN' : 'GLOBAL',
          vendor: selectedPlan?.vendor || simpleVendor || null,
          network: selectedPlan?.network || null,
          planType: null,
          variationCode: selectedPlan?.variationCode || null,
        }),
        marginPercent: simpleProfitType === 'percentage' ? Number(simpleProfitValue || 0) : 0,
        marginFlatNgn: simpleProfitType === 'fixed' ? Number(simpleProfitValue || 0) : 0,
        minMarginNgn: (ruleToPreserve?.minMarginKobo ?? 0) / 100,
        maxMarginNgn: ruleToPreserve?.maxMarginKobo != null ? ruleToPreserve.maxMarginKobo / 100 : null,
        roundToNgn: (ruleToPreserve?.roundToKobo ?? 0) / 100,
        note: ruleToUpdate?.note || '',
      }
      const response = await fetch('/api/admin/pricing', {
        method: ruleToUpdate ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || `Could not save the ${selectedVendorLabel} profit.`)
      }

      let savedRule = payload.data as AdminPricingRule
      if (!savedRule.active) {
        const activateResponse = await fetch('/api/admin/pricing', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: savedRule.id, active: true }),
        })
        const activation = await activateResponse.json().catch(() => null)
        if (!activateResponse.ok || activation?.success === false) {
          throw new Error(activation?.error || 'Profit was saved, but the rule could not be enabled.')
        }
        savedRule = activation.data as AdminPricingRule
      }

      setRules(current => [savedRule, ...current.filter(rule => rule.id !== savedRule.id)])
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not save the ${selectedVendorLabel} profit.`)
    } finally {
      setBusy(false)
    }
  }

  async function createRule() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/pricing', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: createForm.scope,
          vendor: createForm.vendor || null,
          network: createForm.network || null,
          planType: createForm.planType || null,
          variationCode: createForm.variationCode || null,
          marginPercent: Number(createForm.marginPercent || 0),
          marginFlatNgn: Number(createForm.marginFlatNgn || 0),
          minMarginNgn: Number(createForm.minMarginNgn || 0),
          maxMarginNgn: createForm.maxMarginNgn.trim() ? Number(createForm.maxMarginNgn) : null,
          roundToNgn: Number(createForm.roundToNgn || 0),
          note: createForm.note,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Could not create rule.')
      }
      setRules(current => [payload.data, ...current])
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create rule.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleRule(id: string, active: boolean) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Could not update rule.')
      }
      setRules(current => current.map(rule => (rule.id === id ? payload.data : rule)))
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update rule.')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(rule: AdminPricingRule) {
    setEditingId(rule.id)
    setEditForm({
      marginPercent: String(rule.marginBps / 100),
      marginFlatNgn: String(rule.marginKobo / 100),
      minMarginNgn: String(rule.minMarginKobo / 100),
      maxMarginNgn: rule.maxMarginKobo != null ? String(rule.maxMarginKobo / 100) : '',
      roundToNgn: String(rule.roundToKobo / 100),
      note: rule.note || '',
    })
  }

  async function saveEdit(id: string) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          marginPercent: Number(editForm.marginPercent || 0),
          marginFlatNgn: Number(editForm.marginFlatNgn || 0),
          minMarginNgn: Number(editForm.minMarginNgn || 0),
          maxMarginNgn: editForm.maxMarginNgn.trim() ? Number(editForm.maxMarginNgn) : null,
          roundToNgn: Number(editForm.roundToNgn || 0),
          note: editForm.note,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Could not save rule.')
      }
      setRules(current => current.map(rule => (rule.id === id ? payload.data : rule)))
      setEditingId(null)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save rule.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error ? <AdminError message={error} /> : null}

      <section className="m-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <h3 className="text-base font-bold text-slate-900">Default profit for data plans</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Set one profit for all providers, or choose a provider to give it a separate default. Network and plan rules can still override it below.
            </p>
            {simpleVendor && !providerRule && defaultRule ? (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                {defaultRule.active
                  ? `${VENDOR_LABELS[simpleVendor]} currently uses the all-provider default. Saving here will create a separate ${VENDOR_LABELS[simpleVendor]} profit.`
                  : `The all-provider default is disabled. Saving here will create a separate ${VENDOR_LABELS[simpleVendor]} profit.`}
              </p>
            ) : null}
            {selectedPlan && !planRule ? (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                {selectedPlan.label} currently uses the {providerRule ? `${VENDOR_LABELS[simpleVendor]} default` : 'all-provider default'}. Saving will set profit for this plan only.
              </p>
            ) : null}
            {effectiveRule?.marginBps && effectiveRule.marginKobo ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                The current {selectedPlan ? 'plan' : selectedVendorLabel} setting combines percentage and fixed profit. Saving here will replace that combination with the one method you choose.
              </p>
            ) : null}
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-2 lg:max-w-5xl lg:grid-cols-5">
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              Applies to
              <AdminSelect
                value={simpleVendor}
                onChange={event => selectSimpleVendor(event.target.value as '' | 'amigo' | 'asbdata' | 'bardetech')}
              >
                <option value="">All providers</option>
                <option value="amigo">Amigo only</option>
                <option value="asbdata">ASBDATA only</option>
                <option value="bardetech">Bardetech only</option>
              </AdminSelect>
            </label>
            {simpleVendor ? (
              <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                Plan to override
                <AdminSelect value={simplePlanKey} onChange={event => selectSimplePlan(event.target.value)}>
                  <option value="">All {VENDOR_LABELS[simpleVendor]} plans</option>
                  {providerPlans.map(plan => {
                    const key = `${plan.vendor}:${plan.network}:${plan.variationCode}`
                    return (
                      <option key={key} value={key}>
                        {plan.network} · {plan.label} · {plan.planType} · {formatNaira(plan.retailNgn)}
                      </option>
                    )
                  })}
                </AdminSelect>
              </label>
            ) : null}
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              Profit method
              <AdminSelect
                value={simpleProfitType}
                onChange={event => setSimpleProfitType(event.target.value as 'fixed' | 'percentage')}
              >
                <option value="fixed">Fixed amount per plan</option>
                <option value="percentage">Percentage of provider cost</option>
              </AdminSelect>
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              {simpleProfitType === 'fixed' ? 'Profit per plan (₦)' : 'Profit percentage (%)'}
              <AdminInput
                type="number"
                step="0.01"
                min={0}
                value={simpleProfitValue}
                onChange={event => setSimpleProfitValue(event.target.value)}
                placeholder={simpleProfitType === 'fixed' ? 'e.g. 20' : 'e.g. 2.5'}
              />
            </label>
            <div className="flex items-end">
              <AdminButton type="button" disabled={busy} onClick={() => void saveDefaultProfit()} className="w-full">
                {busy
                  ? 'Saving…'
                  : targetRule && !targetRule.active
                    ? 'Save and enable'
                    : selectedPlan && !planRule
                      ? 'Set plan profit'
                      : simpleVendor && !providerRule
                        ? `Set ${VENDOR_LABELS[simpleVendor]} profit`
                      : 'Save profit'}
              </AdminButton>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Example provider cost</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-800">{formatNaira(sampleCostKobo / 100)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">MafitaPay profit</div>
            <div className="mt-1 font-mono text-sm font-semibold text-[#8c6b31]">{formatNaira(sampleFinalProfitKobo / 100)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Customer pays</div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900">{formatNaira(sampleRetailKobo / 100)}</div>
          </div>
        </div>
        {effectiveRule && (effectiveRule.minMarginKobo > 0 || effectiveRule.maxMarginKobo != null || effectiveRule.roundToKobo > 0) ? (
          <p className="mt-2 text-xs text-slate-500">
            Existing advanced adjustments are preserved: {effectiveRule.minMarginKobo > 0 ? `minimum profit ${formatNaira(effectiveRule.minMarginKobo / 100)}` : ''}
            {effectiveRule.maxMarginKobo != null ? `${effectiveRule.minMarginKobo > 0 ? ', ' : ''}maximum profit ${formatNaira(effectiveRule.maxMarginKobo / 100)}` : ''}
            {effectiveRule.roundToKobo > 0 ? `${effectiveRule.minMarginKobo > 0 || effectiveRule.maxMarginKobo != null ? ', ' : ''}price rounds up to ${formatNaira(effectiveRule.roundToKobo / 100)}` : ''}.
            {' '}Edit these under Advanced pricing rules.
          </p>
        ) : null}
      </section>

      <details className="border-t border-slate-200">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-slate-700 marker:hidden">
          Advanced pricing rules
          <span className="ml-2 text-xs font-normal text-slate-400">Networks, plan categories, individual plans, caps and rounding</span>
        </summary>

      <div className="space-y-3 p-4">
        <p className="text-sm text-slate-500">
          Set a house-wide margin or override specific networks, plan types, or plans. Most specific match wins.
          Changes apply immediately to new catalog loads and purchases.
        </p>

        <div className="grid gap-3 lg:grid-cols-4">
          <AdminSelect
            value={createForm.scope}
            onChange={event => setCreateForm(current => ({ ...current, scope: event.target.value }))}
          >
            {SCOPES.map(scope => (
              <option key={scope} value={scope}>{scope.replace(/_/g, ' ')}</option>
            ))}
          </AdminSelect>
          <AdminSelect
            value={createForm.vendor}
            onChange={event => setCreateForm(current => ({ ...current, vendor: event.target.value }))}
          >
            <option value="">All vendors</option>
            <option value="amigo">Amigo</option>
            <option value="asbdata">ASBDATA</option>
            <option value="bardetech">Bardetech</option>
          </AdminSelect>
          <AdminSelect
            value={createForm.network}
            onChange={event => setCreateForm(current => ({ ...current, network: event.target.value }))}
          >
            <option value="">Network (if scoped)</option>
            {networks.map(network => (
              <option key={network} value={network}>{network}</option>
            ))}
          </AdminSelect>
          <AdminSelect
            value={createForm.planType}
            onChange={event => setCreateForm(current => ({ ...current, planType: event.target.value }))}
          >
            <option value="">Plan type (if scoped)</option>
            {planTypes.map(planType => (
              <option key={planType} value={planType}>{planType}</option>
            ))}
          </AdminSelect>
        </div>

        <div className="grid gap-3 lg:grid-cols-5">
          <AdminInput
            type="number"
            step="0.01"
            min={0}
            placeholder="% margin (e.g. 2.5)"
            value={createForm.marginPercent}
            onChange={event => setCreateForm(current => ({ ...current, marginPercent: event.target.value }))}
          />
          <AdminInput
            type="number"
            step="0.01"
            min={0}
            placeholder="+ Flat ₦ (optional)"
            value={createForm.marginFlatNgn}
            onChange={event => setCreateForm(current => ({ ...current, marginFlatNgn: event.target.value }))}
          />
          <AdminInput
            type="number"
            step="0.01"
            min={0}
            placeholder="Min floor ₦"
            value={createForm.minMarginNgn}
            onChange={event => setCreateForm(current => ({ ...current, minMarginNgn: event.target.value }))}
          />
          <AdminInput
            type="number"
            step="0.01"
            min={0}
            placeholder="Max cap ₦ (optional)"
            value={createForm.maxMarginNgn}
            onChange={event => setCreateForm(current => ({ ...current, maxMarginNgn: event.target.value }))}
          />
          <AdminInput
            type="number"
            step="0.01"
            min={0}
            placeholder="Round to ₦ (e.g. 10)"
            value={createForm.roundToNgn}
            onChange={event => setCreateForm(current => ({ ...current, roundToNgn: event.target.value }))}
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <AdminInput
            className="flex-1"
            placeholder="Plan code (required for PLAN scope)"
            value={createForm.variationCode}
            onChange={event => setCreateForm(current => ({ ...current, variationCode: event.target.value }))}
          />
          <AdminInput
            className="flex-1"
            placeholder="Note (optional)"
            value={createForm.note}
            onChange={event => setCreateForm(current => ({ ...current, note: event.target.value }))}
          />
          <AdminButton type="button" disabled={busy} onClick={() => void createRule()}>
            {busy ? 'Saving…' : 'Create rule'}
          </AdminButton>
        </div>
      </div>

      <div className="border-t border-slate-200">
        <AdminTable>
          <AdminThead columns={['Target', 'Margin', 'Floor / Cap', 'Round', 'Note', 'Status', 'Actions']} />
          <tbody className="divide-y divide-slate-100">
            {sortedRules.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                  No pricing rules configured. Data plans show vendor wholesale price.
                </td>
              </tr>
            ) : (
              sortedRules.map(rule => (
                <tr key={rule.id} className={rule.active ? undefined : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{describeScope(rule)}</div>
                    <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-400">{rule.scope}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-800">{describeMargin(rule)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {rule.minMarginKobo > 0 ? `Floor ${formatNaira(rule.minMarginKobo / 100)}` : '—'}
                    {rule.maxMarginKobo != null ? ` / Cap ${formatNaira(rule.maxMarginKobo / 100)}` : ''}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {rule.roundToKobo > 0 ? formatNaira(rule.roundToKobo / 100) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{rule.note || '—'}</td>
                  <td className="px-4 py-3">
                    <AdminStatusPill status={rule.active ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <AdminButton
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void toggleRule(rule.id, !rule.active)}
                      >
                        {rule.active ? 'Disable' : 'Enable'}
                      </AdminButton>
                      <AdminButton
                        type="button"
                        disabled={busy}
                        onClick={() => (editingId === rule.id ? setEditingId(null) : startEdit(rule))}
                      >
                        {editingId === rule.id ? 'Close' : 'Edit'}
                      </AdminButton>
                    </div>
                    {editingId === rule.id ? (
                      <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                          <AdminInput
                            type="number"
                            step="0.01"
                            placeholder="% margin"
                            value={editForm.marginPercent}
                            onChange={event => setEditForm(current => ({ ...current, marginPercent: event.target.value }))}
                          />
                          <AdminInput
                            type="number"
                            step="0.01"
                            placeholder="Flat ₦"
                            value={editForm.marginFlatNgn}
                            onChange={event => setEditForm(current => ({ ...current, marginFlatNgn: event.target.value }))}
                          />
                          <AdminInput
                            type="number"
                            step="0.01"
                            placeholder="Min ₦"
                            value={editForm.minMarginNgn}
                            onChange={event => setEditForm(current => ({ ...current, minMarginNgn: event.target.value }))}
                          />
                          <AdminInput
                            type="number"
                            step="0.01"
                            placeholder="Max ₦"
                            value={editForm.maxMarginNgn}
                            onChange={event => setEditForm(current => ({ ...current, maxMarginNgn: event.target.value }))}
                          />
                          <AdminInput
                            type="number"
                            step="0.01"
                            placeholder="Round ₦"
                            value={editForm.roundToNgn}
                            onChange={event => setEditForm(current => ({ ...current, roundToNgn: event.target.value }))}
                          />
                          <AdminInput
                            placeholder="Note"
                            value={editForm.note}
                            onChange={event => setEditForm(current => ({ ...current, note: event.target.value }))}
                          />
                        </div>
                        <AdminButton type="button" disabled={busy} className="w-full" onClick={() => void saveEdit(rule.id)}>
                          Save changes
                        </AdminButton>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </AdminTable>
      </div>

      <div className="border-t border-slate-200 p-4">
        <h3 className="font-bold text-slate-900">Sample preview</h3>
        <p className="mt-1 text-xs text-slate-500">First plans under current rules (Amigo + ASBDATA).</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Margin</th>
                <th className="px-3 py-2 text-right">Retail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {preview.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    No plans available to preview.
                  </td>
                </tr>
              ) : (
                preview.map(row => (
                  <tr key={`${row.vendor}-${row.variationCode}`}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">{row.name}</div>
                      <div className="text-[10px] uppercase text-slate-400">{row.vendor} · {row.variationCode}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatNaira(row.costNgn)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#8c6b31]">{formatNaira(row.marginNgn)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{formatNaira(row.retailNgn)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </details>
    </div>
  )
}
