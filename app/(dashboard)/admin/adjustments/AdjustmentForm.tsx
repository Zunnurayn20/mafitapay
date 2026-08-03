'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { User, Wallet } from '@/types'
import {
  AdminButton,
  AdminError,
  AdminInput,
  AdminSelect,
  formatNaira,
} from '@/components/admin/AdminUi'

export function AdjustmentForm({
  rows,
}: {
  rows: Array<{ user: User; wallet: Wallet | null }>
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    setOk(false)

    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/admin/wallets', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: String(form.get('userId') || ''),
          direction: String(form.get('direction') || 'credit'),
          amount: Number(form.get('amount')),
          reason: String(form.get('reason') || ''),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Adjustment failed.')
      }
      setOk(true)
      event.currentTarget.reset()
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Adjustment failed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 p-4 md:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-slate-700">Customer</span>
        <AdminSelect name="userId" defaultValue={rows[0]?.user.id} required className="w-full">
          {rows.map(row => (
            <option key={row.user.id} value={row.user.id}>
              {row.user.name} — {formatNaira(row.wallet?.balance ?? 0)}
            </option>
          ))}
        </AdminSelect>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-slate-700">Direction</span>
        <AdminSelect name="direction" defaultValue="credit" className="w-full">
          <option value="credit">Credit</option>
          <option value="debit">Debit</option>
        </AdminSelect>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-slate-700">Amount (NGN)</span>
        <AdminInput name="amount" type="number" min="1" step="0.01" required className="w-full" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-slate-700">Reason</span>
        <AdminInput name="reason" required placeholder="Support refund / correction" className="w-full" />
      </label>
      {error ? (
        <div className="md:col-span-2">
          <AdminError message={error} />
        </div>
      ) : null}
      {ok ? (
        <div className="md:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Adjustment applied.
        </div>
      ) : null}
      <div className="md:col-span-2">
        <AdminButton type="submit" disabled={pending || rows.length === 0}>
          {pending ? 'Applying…' : 'Apply adjustment'}
        </AdminButton>
      </div>
    </form>
  )
}
