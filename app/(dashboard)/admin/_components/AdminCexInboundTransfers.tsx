'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { CexInboundTransfer } from '@/types'

type CexSyncResult = {
  exchange: string
  configured?: boolean
  checked?: number
  internalTransfers?: number
  recipientMatches?: number
  matchedSenders?: number
  credited?: number
  recordSamples?: Array<{
    asset: string | null
    amount: string | null
    status: string | null
    type: string | null
    destination: string | null
    senderIdentifierKind: string
    recipientMatches: boolean
    referenceSuffix: string | null
  }>
  pages?: number
  morePages?: boolean
  limitReached?: boolean
  error?: string
}

function compact(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

export function AdminCexInboundTransfers() {
  const [enabled, setEnabled] = useState(false)
  const [binanceDiagnosticAvailable, setBinanceDiagnosticAvailable] = useState(false)
  const [items, setItems] = useState<CexInboundTransfer[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncResults, setSyncResults] = useState<CexSyncResult[] | null>(null)
  const [diagnosticLoading, setDiagnosticLoading] = useState(false)
  const [diagnosticError, setDiagnosticError] = useState('')
  const [diagnostic, setDiagnostic] = useState<{ checkedAt: string; windowHours: number; records: Array<{ asset: string; amount: string | null; status: string | null; network: string | null; transferType: string | null; transferId: string | null; receivedAt: string | null; completedAt: string | null; memo: string | null; senderUid: string | null; senderEmail: string | null }> } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/crypto-deposits?limit=1', { credentials: 'include', cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload?.success) throw new Error('Could not load exchange deposits.')
      setEnabled(Boolean(payload.cexEnabled))
      setBinanceDiagnosticAvailable(Boolean(payload.binanceDiagnosticAvailable))
      setItems(Array.isArray(payload.cexTransfers) ? payload.cexTransfers : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  async function inspectBinance() {
    setDiagnosticLoading(true)
    setDiagnosticError('')
    try {
      const response = await fetch('/api/admin/crypto-deposits', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'diagnose-binance-inbound' }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Could not inspect Binance deposits.')
      setDiagnostic(payload.data)
    } catch (error) {
      setDiagnosticError(error instanceof Error ? error.message : 'Could not inspect Binance deposits.')
    } finally {
      setDiagnosticLoading(false)
    }
  }

  async function syncExchanges() {
    setSyncing(true)
    setSyncError('')
    setSyncResults(null)
    try {
      const response = await fetch('/api/admin/crypto-deposits', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'sync-cex-internal' }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Could not sync exchange transfers.')
      const results = payload?.data?.exchanges
      if (!Array.isArray(results)) throw new Error('Exchange sync completed without returning provider results.')
      setSyncResults(results as CexSyncResult[])
      await load()
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not sync exchange transfers.')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => { void load() }, [])
  if (!enabled && !binanceDiagnosticAvailable) return null

  return (
    <Card className="space-y-3 p-4">
      {enabled && <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-[var(--text)]">Exchange transfers</div>
          <div className="mt-1 text-xs text-[var(--muted)]">USDT and USDC transfers reported by connected exchanges. Unmatched or pending records were not credited automatically.</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void syncExchanges()} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</Button>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>
        </div>
      </div>
      {syncError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{syncError}</div>}
      {syncResults && <div className="space-y-2" aria-live="polite">
        {syncResults.map(result => {
          const name = result.exchange === 'bitget' ? 'Bitget' : result.exchange === 'bybit' ? 'Bybit' : result.exchange === 'okx' ? 'OKX' : result.exchange
          const failed = Boolean(result.error)
          const notConfigured = result.configured === false
          const style = failed
            ? 'border-red-500/30 bg-red-500/10 text-red-300'
            : notConfigured
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          const message = failed
            ? result.error
            : notConfigured
              ? 'Not configured for automatic deposits.'
              : result.exchange === 'okx'
                ? `Connected · checked ${result.checked ?? 0} records · ${result.internalTransfers ?? 0} internal transfers · ${result.matchedSenders ?? 0} uniquely matched senders · credited ${result.credited ?? 0}${result.limitReached ? ' · OKX returned the 100-record page limit; some older records may need a follow-up sync' : ''}.`
              : result.exchange === 'bitget'
                ? `Connected · checked ${result.checked ?? 0} records · ${result.internalTransfers ?? 0} internal transfers · ${result.recipientMatches ?? 0} to MafitaPay UID · credited ${result.credited ?? 0}${result.morePages ? ' · additional records will be checked on the next sync' : ''}.`
                : `Connected · checked ${result.checked ?? 0} records · credited ${result.credited ?? 0}${result.morePages ? ' · additional records will be checked on the next sync' : ''}.`
          return <div key={result.exchange} className={`rounded-lg border p-3 text-xs ${style}`}>
            <span className="font-bold">{name}:</span> {message}
          </div>
        })}
        {syncResults.find(result => result.exchange === 'bitget')?.recordSamples?.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--clay2)] p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text2)]">Bitget records returned</div>
            <div className="space-y-1.5">
              {syncResults.find(result => result.exchange === 'bitget')!.recordSamples!.map((record, index) => (
                <div key={`${record.referenceSuffix ?? 'record'}-${index}`} className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--muted)]">
                  <span className="font-semibold text-[var(--text)]">{record.amount ?? '—'} {record.asset ?? ''}</span>
                  <span>type: {record.type ?? '—'}</span>
                  <span>destination: {record.destination ?? '—'}</span>
                  <span>sender ID: {record.senderIdentifierKind}</span>
                  <span>to MafitaPay UID: {record.recipientMatches ? 'yes' : 'no'}</span>
                  <span>status: {record.status ?? '—'}</span>
                  {record.referenceSuffix && <span>ref …{record.referenceSuffix}</span>}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="text-[10px] text-[var(--muted)]">Successful transfers credit automatically only when a verified sender account can be matched uniquely. OKX sender contacts are masked, so ambiguous matches stay unmatched.</div>
      </div>}
      {items.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--clay2)] p-3 text-xs text-[var(--muted)]">No exchange transfers have been reported yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[660px] text-left text-xs">
            <thead className="bg-[var(--clay2)] text-[var(--muted)]">
              <tr><th className="px-3 py-2">Received</th><th className="px-3 py-2">Exchange</th><th className="px-3 py-2">Sender UID / contact</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Transfer ID</th></tr>
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
      </>}
      {binanceDiagnosticAvailable && <div className="space-y-3 border-t border-[var(--border)] pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-[var(--text)]">Binance USDT diagnostic</div>
            <div className="mt-1 text-xs text-[var(--muted)]">Read only. Checks Binance records from the last 24 hours and never credits a customer balance.</div>
          </div>
          <Button variant="secondary" onClick={() => void inspectBinance()} disabled={diagnosticLoading}>{diagnosticLoading ? 'Checking…' : 'Inspect Binance deposits'}</Button>
        </div>
        {diagnosticError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{diagnosticError}</div>}
        {diagnostic && <>
          <div className="text-xs text-[var(--muted)]">Checked {new Date(diagnostic.checkedAt).toLocaleString()} · last {diagnostic.windowHours} hours · {diagnostic.records.length} USDT records</div>
          {diagnostic.records.length === 0 ? <div className="rounded-lg border border-[var(--border)] bg-[var(--clay2)] p-3 text-xs text-[var(--muted)]">Binance returned no USDT deposit-history records in this window. This endpoint may not include UID internal transfers.</div> :
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="bg-[var(--clay2)] text-[var(--muted)]"><tr><th className="px-3 py-2">Received</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Network</th><th className="px-3 py-2">Transfer type</th><th className="px-3 py-2">Transfer ID</th><th className="px-3 py-2">Sender UID</th><th className="px-3 py-2">Sender email</th><th className="px-3 py-2">Memo / remark</th></tr></thead>
                <tbody>{diagnostic.records.map((record, index) => <tr key={`${record.transferId ?? 'no-id'}-${index}`} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 text-[var(--text2)]">{record.receivedAt ? new Date(Number(record.receivedAt)).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[var(--text)]">{record.amount ?? '—'} {record.asset}</td>
                  <td className="px-3 py-2 text-[var(--text2)]">{record.status ?? '—'}</td>
                  <td className="px-3 py-2 text-[var(--text2)]">{record.network ?? '—'}</td>
                  <td className="px-3 py-2 text-[var(--text2)]">{record.transferType ?? '—'}</td>
                  <td className="max-w-48 truncate px-3 py-2 font-mono text-[var(--muted)]" title={record.transferId ?? undefined}>{record.transferId ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-[var(--text2)]">{record.senderUid ?? '—'}</td>
                  <td className="px-3 py-2 text-[var(--text2)]">{record.senderEmail ?? '—'}</td>
                  <td className="max-w-48 truncate px-3 py-2 text-[var(--text2)]" title={record.memo ?? undefined}>{record.memo ?? '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </>}
      </div>}
    </Card>
  )
}
