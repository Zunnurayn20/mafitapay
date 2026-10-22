'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

const CONFIRMED_ADDRESS = '0x37a8E877698aE7134E92eB2E85Fcd637a87aa6D6'
const CONFIRMED_TX = '0x6586f00db894062b3f075037d3d861e652e2bcb20fb5f1e3e5e7935d036eea1c'

export function AdminCryptoDepositReconciler() {
  const [address, setAddress] = useState(CONFIRMED_ADDRESS)
  const [txHash, setTxHash] = useState(CONFIRMED_TX)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function reconcile() {
    if (!window.confirm('Credit the USDT0 transfer to this deposit address? MafitaPay will verify the successful Polygon receipt and prevent duplicate crediting.')) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/crypto-deposits', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'reconcile-erc20-transaction', chain: 'polygon', address, txHash }),
      })
      const json = await response.json()
      if (!response.ok || json?.success !== true) throw new Error(json?.error || 'Reconciliation failed.')
      const result = json.data
      setMessage(`Credited ${Number(result.amountCrypto).toLocaleString('en-US', { maximumFractionDigits: 6 })} USDT. Event: ${result.externalEventId}${result.duplicate ? ' (already processed)' : ''}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Reconciliation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3 border-[var(--gold)]/40 p-4">
      <div>
        <div className="text-sm font-bold text-[var(--text)]">Reconcile missed ERC-20 deposit</div>
        <div className="mt-1 text-xs text-[var(--muted)]">Verifies the on-chain receipt, supported token contract, recipient address, and duplicate status before crediting. Admin access required.</div>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <input aria-label="Deposit recipient address" value={address} onChange={event => setAddress(event.target.value)} className="min-w-0 rounded border border-[var(--border)] bg-[var(--clay2)] px-3 py-2 font-mono text-xs text-[var(--text)]" />
        <input aria-label="ERC-20 transaction hash" value={txHash} onChange={event => setTxHash(event.target.value)} className="min-w-0 rounded border border-[var(--border)] bg-[var(--clay2)] px-3 py-2 font-mono text-xs text-[var(--text)]" />
        <Button onClick={() => void reconcile()} disabled={busy || !address.trim() || !txHash.trim()}>{busy ? 'Verifying…' : 'Verify and credit'}</Button>
      </div>
      {message && <div role="status" className="break-all text-xs text-[var(--text2)]">{message}</div>}
    </Card>
  )
}
