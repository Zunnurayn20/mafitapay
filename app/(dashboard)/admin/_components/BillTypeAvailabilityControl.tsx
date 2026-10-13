'use client'

import { useEffect, useState } from 'react'
import { BILL_SERVICE_CONFIG, BILL_SERVICE_TYPES } from '@/lib/bill-config'
import type { BillProvider } from '@/types'

type BillType = BillProvider['type']
type Availability = { type: BillType; enabled: boolean }

export function BillTypeAvailabilityControl() {
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [savingType, setSavingType] = useState<BillType | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch('/api/admin/bill-type-settings', {
          credentials: 'include',
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok || payload.success === false || !Array.isArray(payload.data)) {
          throw new Error(payload.error || 'Could not load global service availability.')
        }
        setAvailability(payload.data.map((setting: Availability) => ({ type: setting.type, enabled: setting.enabled })))
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Could not load global service availability.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  async function setTypeEnabled(type: BillType, enabled: boolean) {
    setSavingType(type)
    setError('')
    try {
      const response = await fetch('/api/admin/bill-type-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, enabled }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false || !payload.data) {
        throw new Error(payload.error || `Could not update ${BILL_SERVICE_CONFIG[type].displayName}.`)
      }
      setAvailability(current => current.map(item => item.type === type ? { type, enabled: payload.data.enabled } : item))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not update ${BILL_SERVICE_CONFIG[type].displayName}.`)
    } finally {
      setSavingType(null)
    }
  }

  return (
    <section className="mb-4 border border-[var(--border)] bg-[var(--coal)] p-4" aria-labelledby="bill-type-availability-title">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="bill-type-availability-title" className="text-[11px] font-bold text-[var(--text)]">Global service availability</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">
            Turn off a service type to hide and block every service under it. Individual service settings are preserved.
          </p>
        </div>
        {loading && <span className="text-[10px] text-[var(--muted)]">Loading controlsâ€¦</span>}
      </div>

      {error && <p role="alert" className="mt-3 border border-[rgba(196,52,26,.3)] bg-[rgba(196,52,26,.08)] px-3 py-2 text-[10px] text-[var(--red2)]">{error}</p>}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {BILL_SERVICE_TYPES.map(type => {
          const setting = availability.find(item => item.type === type)
          const enabled = setting?.enabled ?? true
          const busy = savingType === type
          return (
            <div key={type} className="flex items-center justify-between gap-3 border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-[10px] font-bold text-[var(--text)]">{BILL_SERVICE_CONFIG[type].displayName}</div>
                <div className={`mt-0.5 text-[9px] font-semibold uppercase tracking-wide ${enabled ? 'text-[var(--green2)]' : 'text-[var(--muted)]'}`}>
                  {loading ? 'Loading' : enabled ? 'Enabled' : 'Disabled'}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-label={`${enabled ? 'Disable' : 'Enable'} ${BILL_SERVICE_CONFIG[type].displayName} globally`}
                aria-checked={enabled}
                disabled={loading || savingType !== null || !setting}
                onClick={() => void setTypeEnabled(type, !enabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-wait disabled:opacity-50 ${enabled ? 'border-[var(--green)] bg-[var(--green)]' : 'border-[var(--border2)] bg-[var(--coal)]'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                <span className="sr-only">{busy ? 'Saving' : enabled ? 'Enabled' : 'Disabled'}</span>
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
