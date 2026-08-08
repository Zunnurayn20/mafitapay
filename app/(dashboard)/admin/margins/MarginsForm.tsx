'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AdminButton, AdminError, AdminInput, formatNaira } from '@/components/admin/AdminUi'

export type ResolvedMargin = {
  key: string
  label: string
  description: string
  envVar: string
  envValue: number
  value: number
  source: 'database' | 'env'
}

export function MarginsForm({ margins }: { margins: ResolvedMargin[] }) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(margins.map(entry => [entry.key, String(entry.value)])),
  )
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [savedKey, setSavedKey] = useState<string | null>(null)

  async function save(key: string) {
    const raw = drafts[key] ?? ''
    const value = Number(raw)

    if (!raw.trim() || !Number.isFinite(value)) {
      setError('Enter a valid amount.')
      return
    }
    if (value < 0) {
      setError('Margin cannot be negative.')
      return
    }

    setPendingKey(key)
    setError('')
    setSavedKey(null)

    try {
      const response = await fetch('/api/admin/margins', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, valueNgn: value }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Could not save the margin.')
      }
      setSavedKey(key)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the margin.')
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="space-y-3">
      {error && <AdminError message={error} />}

      {margins.map(entry => {
        const draft = drafts[entry.key] ?? ''
        const dirty = draft.trim() !== String(entry.value)
        const busy = pendingKey === entry.key

        return (
          <div key={entry.key} className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{entry.label}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      entry.source === 'database'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                    title={
                      entry.source === 'database'
                        ? 'Set here in the admin. This value is what customers are charged.'
                        : `No admin value set — falling back to the ${entry.envVar} environment variable.`
                    }
                  >
                    {entry.source === 'database' ? 'Admin' : 'Env default'}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{entry.description}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Currently charging <span className="font-mono font-semibold text-slate-600">{formatNaira(entry.value)}</span>
                  {entry.source === 'database' && entry.envValue !== entry.value && (
                    <> · env default is {formatNaira(entry.envValue)}</>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <div className="w-32">
                  <AdminInput
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={draft}
                    disabled={busy}
                    onChange={event => {
                      setDrafts(current => ({ ...current, [entry.key]: event.target.value }))
                      setSavedKey(null)
                    }}
                  />
                </div>
                <AdminButton
                  type="button"
                  disabled={busy || !dirty}
                  onClick={() => void save(entry.key)}
                >
                  {busy ? 'Saving…' : savedKey === entry.key ? 'Saved' : 'Save'}
                </AdminButton>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
