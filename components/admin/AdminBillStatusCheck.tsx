'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AdminBillStatusCheck({ transactionId, providerName }: { transactionId: string; providerName: 'asbdata' | 'bardetech' }) {
  const providerLabel = providerName === 'asbdata' ? 'ASBDATA' : 'Bardetech'
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')

  async function checkStatus() {
    if (checking) return
    setChecking(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/transactions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_bill_status', transactionId, providerName }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Provider status check failed.')
      const result = payload?.data
      setMessage(result?.synced
        ? `Provider confirmed ${String(result.status).toUpperCase()}. MafitaPay has updated the transaction.`
        : result?.checked
          ? `Still ${String(result.status || 'pending').toUpperCase()} at ${providerLabel}. We’ll keep checking automatically.`
          : result?.reason || 'No new provider status was available.')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Provider status check failed.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void checkStatus()}
        disabled={checking}
        className="rounded-md border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:border-[var(--gold)] disabled:cursor-wait disabled:opacity-60"
      >
        {checking ? `Checking ${providerLabel}…` : `Check with ${providerLabel}`}
      </button>
      {message ? <span role="status" className="text-xs text-[var(--muted)]">{message}</span> : null}
    </div>
  )
}
