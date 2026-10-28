'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { CexInboundTransfer } from '@/types'

function compact(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

export function AdminCexInboundTransfers() {
  const [enabled, setEnabled] = useState(false)
  const [items, setItems] = useState<CexInboundTransfer[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/crypto-deposits?limit=1', { credentials: 'include', cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload?.success) throw new Error('Could not load exchange deposits.')
      setEnabled(Boolean(payload.cexEnabled))
      setItems(Array.isArray(payload.cexTransfers) ? payload.cexTransfers : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  if (!enabled) return null

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-[var(--text)]">Exchange transfers</div>
          <div className="mt-1 text-xs text-[var(--muted)]">USDT and USDC transfers reported by connected exchanges. Unmatched or pending records were not credited automatically.</div>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--clay2)] p-3 text-xs text-[var(--muted)]">No exchange transfers have been reported yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[660px] text-left text-xs">
            <thead className="bg-[var(--clay2)] text-[var(--muted)]">
              <tr><th className="px-3 py-2">Received</th><th className="px-3 py-2">Exchange</th><th className="px-3 py-2">Sender UID</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Transfer ID</th></tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 text-[var(--text2)]">{new Date(item.receivedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 font-semibold capitalize text-[var(--text)]">{item.exchange}</td>
                  <td className="px-3 py-2 font-mono text-[var(--text2)]">{item.senderUid}</td>
                  <td className="px-3 py-2 font-mono text-[var(--text)]">{Number(item.amount).toLocaleString('en-US', { maximumFractionDigits: 8 })} {item.assetSymbol}</td>
                  <td className="px-3 py-2"><span className="rounded-full border border-[var(--border)] bg-[var(--clay2)] px-2 py-1 capitalize text-[var(--gold2)]">{item.attributionStatus.replaceAll('_', ' ')}</span></td>
                  <td className="px-3 py-2 font-mono text-[var(--muted)]" title={item.externalTransferId}>{compact(item.externalTransferId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
