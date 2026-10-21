'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DataPlanCategoryType } from '@/lib/data-plan-categories'

type CategoryOption = { categoryType: DataPlanCategoryType; categoryKey: string; label: string }
type DisabledCategory = { categoryType: DataPlanCategoryType; categoryKey: string; reason?: string; disabledAt: string; disabledBy?: string }

export function DataPlanCategoryControls({ options, initialDisabled }: {
  options: CategoryOption[]
  initialDisabled: DisabledCategory[]
}) {
  const router = useRouter()
  const [disabledCategories, setDisabledCategories] = useState(initialDisabled)
  const [activeType, setActiveType] = useState<DataPlanCategoryType>('network')
  const [reason, setReason] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')
  const activeOptions = options.filter(option => option.categoryType === activeType)

  async function setDisabled(option: CategoryOption, disabled: boolean) {
    const key = `${option.categoryType}:${option.categoryKey}`
    setBusyKey(key)
    setError('')
    try {
      const response = await fetch('/api/admin/data-plan-categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryType: option.categoryType, categoryKey: option.categoryKey, disabled, reason }),
      })
      const result = await response.json()
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        throw new Error(result.error || 'Unable to save this category switch.')
      }
      setDisabledCategories(result.data)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save this category switch.')
    } finally {
      setBusyKey('')
    }
  }

  return <section className="mb-5 border border-slate-200 bg-slate-50 p-4" aria-labelledby="data-category-controls-title">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="data-category-controls-title" className="text-sm font-bold text-slate-900">Global category switches</h2>
        <p className="mt-1 text-sm text-slate-500">A switch applies across Flutterwave, Amigo, ASBDATA, and Bardetech. Individual plan settings are kept separately.</p>
      </div>
      <label className="text-xs text-slate-500">Reason <input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} placeholder="Optional" className="ml-2 border border-slate-200 bg-white px-2 py-1.5 text-slate-800" /></label>
    </div>
    <div className="mt-4 flex gap-2 border-b border-slate-200 pb-3" role="tablist" aria-label="Data plan category type">
      {([
        ['network', 'Networks'],
        ['plan_type', 'Plan types'],
      ] as const).map(([type, label]) => <button key={type} type="button" role="tab" aria-selected={activeType === type} onClick={() => setActiveType(type)}
        className={`border px-3 py-2 text-xs font-semibold ${activeType === type ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
        {label}
      </button>)}
    </div>
    {error && <p role="alert" className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {activeOptions.map(option => {
        const disabled = disabledCategories.some(item => item.categoryType === option.categoryType && item.categoryKey === option.categoryKey)
        const key = `${option.categoryType}:${option.categoryKey}`
        return <div key={key} className="flex items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">{option.label}</div>
            <div className={`mt-0.5 text-xs font-semibold ${disabled ? 'text-amber-700' : 'text-emerald-700'}`}>{disabled ? 'Disabled' : 'Enabled'}</div>
          </div>
          <button type="button" role="switch" aria-label={`${disabled ? 'Enable' : 'Disable'} ${option.label} data plans`} aria-checked={!disabled}
            disabled={Boolean(busyKey)} onClick={() => void setDisabled(option, !disabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-wait disabled:opacity-50 ${disabled ? 'border-slate-300 bg-slate-300' : 'border-emerald-600 bg-emerald-600'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${disabled ? 'translate-x-1' : 'translate-x-5'}`} />
            <span className="sr-only">{busyKey === key ? 'Saving' : disabled ? 'Disabled' : 'Enabled'}</span>
          </button>
        </div>
      })}
      {!activeOptions.length && <p className="py-5 text-sm text-slate-500">No categories are available.</p>}
    </div>
  </section>
}
