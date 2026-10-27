'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { getCryptoDisplaySymbol, getCryptoDisplaySymbolFromPairId } from '@/lib/crypto-symbols'
import { AdminCryptoDepositReconciler } from './AdminCryptoDepositReconciler'
import { AdminCexInboundTransfers } from './AdminCexInboundTransfers'
import type { AdminSubmodule } from '../admin-config'
import type { AdminWorkspaceState } from '../useAdminWorkspace'

const cryptoAmountFormatter = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 8 })
const dateTimeFormatter = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' })

function formatCryptoAmount(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount) ? cryptoAmountFormatter.format(amount) : '—'
}

function formatDateTime(value: unknown) {
  const date = value ? new Date(String(value)) : null
  return date && Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : '—'
}

function shortReference(value: unknown, start = 10, end = 6) {
  const text = String(value ?? '')
  return text.length > start + end + 3 ? `${text.slice(0, start)}…${text.slice(-end)}` : text || '—'
}

function statusTone(value: unknown) {
  const status = String(value ?? '').toLowerCase()
  if (['matched', 'swept', 'fulfilled', 'completed', 'success'].includes(status)) return 'text-[var(--green2)]'
  if (['failed', 'error'].includes(status)) return 'text-[var(--red2)]'
  if (['unmatched', 'pending', 'sweeping', 'expired'].includes(status)) return 'text-[var(--gold2)]'
  return 'text-[var(--muted)]'
}

function StatusBadge({ value, fallback = 'Unknown' }: { value?: unknown; fallback?: string }) {
  const label = String(value || fallback).replaceAll('_', ' ')
  return <span className={`inline-flex rounded-full border border-[var(--border)] bg-[var(--clay2)] px-2 py-0.5 text-[10px] font-semibold capitalize ${statusTone(value)}`}>{label}</span>
}

function PendingCexIntentsList({ reloadKey }: { reloadKey?: number }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/crypto-deposits', { credentials: 'include', cache: 'no-store' })
      const json = await res.json()
      setItems(json?.pendingCexIntents || [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [reloadKey])

  if (items.length === 0) {
    return <div className="text-[8px] text-[var(--muted)]">No pending CEX deposit intents (memos issued to users via SellModal Binance tab).</div>
  }

  return (
    <div className="border border-[var(--border)] bg-[var(--clay2)] p-2 text-[8px]">
      <div className="font-bold uppercase tracking-[1px] text-[var(--gold2)] mb-1">Pending CEX intents (outstanding memos — waiting for real Binance internal transfer into the receiver account)</div>
      <div className="max-h-32 overflow-auto space-y-0.5 font-mono">
        {items.slice(0, 20).map((it: any, idx: number) => (
          <div key={idx} className="flex gap-2 border-b border-[var(--border)] pb-0.5">
            <span className="text-[var(--muted)]">{new Date(it.createdAt || it.created_at).toLocaleTimeString()}</span>
            <span className="font-bold">{it.reference || it.memo}</span>
            <span>{it.userId || it.user_id}</span>
            <span className="text-[var(--gold2)]">{it.pairId || it.pair_id}</span>
            <span>exp {it.expectedAmountCrypto || it.expected_amount_crypto || 0}</span>
          </div>
        ))}
      </div>
      <div className="text-[7px] text-[var(--muted)] mt-1">These are the references users were told to put in Binance "Remark". The poller matches them against actual deposits returned by Binance API. Use the Record form below (with exact memo) to force-credit for testing.</div>
      <Button variant="secondary" className="text-[8px] mt-1" onClick={() => void load()} disabled={loading}>Refresh pending list</Button>
    </div>
  )
}

export function AdminOperationsSection({ workspace, submodule }: { workspace: AdminWorkspaceState; submodule?: AdminSubmodule }) {
  const [selectedCryptoOrderId, setSelectedCryptoOrderId] = useState<string | null>(null)
  const [cryptoOrderStatusFilter, setCryptoOrderStatusFilter] = useState<'all' | 'pending' | 'fulfilled' | 'failed' | 'expired'>('all')
  const [cryptoOrderSearch, setCryptoOrderSearch] = useState('')
  const [refreshingCryptoOrders, setRefreshingCryptoOrders] = useState(false)
  const [selectedSettlementReference, setSelectedSettlementReference] = useState<string | null>(null)
  const [syncingPayoutReference, setSyncingPayoutReference] = useState<string | null>(null)
  const [payoutSyncFeedback, setPayoutSyncFeedback] = useState<string | null>(null)
  const [selectedProviderEventId, setSelectedProviderEventId] = useState<string | null>(null)
  const [showWebhookTester, setShowWebhookTester] = useState(false)
  const [showLedgerTools, setShowLedgerTools] = useState(false)
  const [showReferenceSupport, setShowReferenceSupport] = useState(false)
  const [selectedDepositEventId, setSelectedDepositEventId] = useState<string | null>(null)
  const [resweepingEventId, setResweepingEventId] = useState<string | null>(null)
  const [depositPage, setDepositPage] = useState(0)
  const [syncingBinanceCex, setSyncingBinanceCex] = useState(false)
  const [recordingCex, setRecordingCex] = useState(false)
  const [batchPreview, setBatchPreview] = useState<any | null>(null)
  const [loadingBatchPreview, setLoadingBatchPreview] = useState(false)
  const [runningBatchConversion, setRunningBatchConversion] = useState(false)
  const DEPOSIT_PAGE_SIZE = 20
  const {
    cryptoOrders,
    reloadCryptoOrders,
    cryptoDepositEvents,
    recentSweepGasStats,
    reloadCryptoDepositEvents,
    triggerCryptoDepositSync,
    forceScanCryptoDepositAddress,
    resweepCryptoDepositEvent,
    cryptoDepositStatusFilter,
    setCryptoDepositStatusFilter,
    cryptoDepositSweepFilter,
    setCryptoDepositSweepFilter,
    cryptoDepositPairFilter,
    setCryptoDepositPairFilter,
    cryptoDepositSearch,
    setCryptoDepositSearch,
    refreshingCryptoDepositEvents,
    syncAllBaseReceipts,
    syncingAllBaseReceipts,
    executeZeroExSwap,
    broadcastingCryptoOrderId,
    resolvingCryptoOrderId,
    broadcastCryptoOrder,
    syncBaseReceipt,
    syncingBaseReceiptOrderId,
    updateCryptoExecution,
    updatingCryptoExecutionId,
    syncCryptoOrder,
    syncingCryptoOrderId,
    resolveCryptoOrder,
    flutterwaveIssuePayouts,
    flutterwaveIssueEvents,
    flutterwaveIssueDeposits,
    flutterwaveDepositEvents,
    webhookTestPayload,
    setWebhookTestPayload,
    runWebhookAcceptanceTest,
    runningWebhookTest,
    webhookTestResult,
    settlementSearch,
    setSettlementSearch,
    settlementStatusFilter,
    setSettlementStatusFilter,
    settlementProviderFilter,
    setSettlementProviderFilter,
    syncAllPendingPayouts,
    syncingAllPayouts,
    reloadSettlementQueues,
    refreshingSettlementQueues,
    inspectReference,
    loadingReferenceCase,
    depositIntents,
    resolveSettlement,
    resolvingReference,
    requeueSettlement,
    requeueingReference,
    payoutRequests,
    providerEventStatusFilter,
    setProviderEventStatusFilter,
    providerEventProviderFilter,
    setProviderEventProviderFilter,
    reloadProviderEvents,
    providerEvents,
    providerDiagnosticsReport,
    refreshingProviderDiagnostics,
    refreshingProviderEvents,
    reloadProviderDiagnosticsReport,
    requeueEvent,
    requeueingEventId,
    transactions,
    inspectLedger,
    selectedTransactionId,
    ledgerTrace,
    referenceCase,
  } = workspace
  const showOrders = !submodule || submodule === 'orders'
  const showSettlements = !submodule || submodule === 'settlements'
  const showEvents = !submodule || submodule === 'events'
  const showCryptoDeposits = !submodule || submodule === 'crypto-deposits'
  const showSupport = !submodule || submodule === 'support'
  const selectedCryptoOrder = cryptoOrders.find(item => item.id === selectedCryptoOrderId) ?? null
  const visibleCryptoOrders = cryptoOrders.filter(item => {
    if (cryptoOrderStatusFilter !== 'all' && item.status !== cryptoOrderStatusFilter) return false
    if (!cryptoOrderSearch.trim()) return true
    const search = cryptoOrderSearch.trim().toLowerCase()
    return [item.id, item.transactionId, item.pairId, item.userId, item.walletAddress, item.destinationTxHash]
      .some(value => String(value ?? '').toLowerCase().includes(search))
  })
  const isOperationsIndex = !submodule

  // Local handlers for deposits filters on the dedicated page
  const applyDepositFilter = (partial: { status?: any; sweepStatus?: any; pairId?: string }) => {
    if (partial.status !== undefined) setCryptoDepositStatusFilter(partial.status)
    if (partial.sweepStatus !== undefined) setCryptoDepositSweepFilter(partial.sweepStatus)
    if (partial.pairId !== undefined) setCryptoDepositPairFilter(partial.pairId)
    setDepositPage(0)
    // re-fetch with current/updated filters
    void reloadCryptoDepositEvents?.({
      status: partial.status ?? (cryptoDepositStatusFilter !== 'all' ? cryptoDepositStatusFilter : undefined),
      sweepStatus: partial.sweepStatus ?? (cryptoDepositSweepFilter !== 'all' ? cryptoDepositSweepFilter : undefined),
      pairId: partial.pairId ?? (cryptoDepositPairFilter || undefined),
    })
  }

  const handleResweep = async (externalEventId: string) => {
    if (!resweepCryptoDepositEvent) return
    setResweepingEventId(externalEventId)
    try {
      await resweepCryptoDepositEvent(externalEventId)
    } finally {
      setResweepingEventId(null)
    }
  }

  const syncPayoutReference = async (reference: string) => {
    setSyncingPayoutReference(reference)
    setPayoutSyncFeedback(null)
    try {
      const response = await fetch(`/api/admin/payout-requests/${encodeURIComponent(reference)}/sync`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Payout status sync failed.')
      }
      const currentStatus = typeof payload.data?.providerStatus === 'string'
        ? payload.data.providerStatus
        : payload.data?.status
      setPayoutSyncFeedback(payload.data?.synced
        ? `Provider confirmed ${String(currentStatus || payload.data.status).toUpperCase()}.`
        : `Provider still reports ${String(currentStatus || 'a pending status').toUpperCase()}.`)
      await Promise.all([
        inspectReference(reference),
        reloadSettlementQueues(reference, 'all', ''),
      ])
    } catch (error) {
      setPayoutSyncFeedback(error instanceof Error ? error.message : 'Payout status sync failed.')
    } finally {
      setSyncingPayoutReference(null)
    }
  }

  const exportDepositEventsToCsv = () => {
    if (displayedDepositEvents.length === 0) return
    const headers = ['timestamp', 'pair', 'amount', 'status', 'sweep_status', 'tx_hash', 'user']
    const rows = displayedDepositEvents.map((e: any) => [
      e.createdAt || e.created_at || '',
      e.pairId || e.pair_id || '',
      e.amountCrypto || e.amount_crypto || '',
      e.status || '',
      e.sweepStatus || e.sweep_status || '',
      e.txHash || e.tx_hash || '',
      e.userId || e.user_id || '',
    ])
    const csv = [headers, ...rows].map(r => r.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crypto_deposits_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectedDepositEvent = (cryptoDepositEvents as any[]).find((e: any) => (e.externalEventId || e.external_event_id) === selectedDepositEventId) ?? null

  // Client-side search filter for the rich view
  const displayedDepositEvents = (cryptoDepositEvents as any[]).filter((e: any) => {
    if (!cryptoDepositSearch) return true
    const s = cryptoDepositSearch.toLowerCase()
    const tx = (e.txHash || e.tx_hash || '').toLowerCase()
    const ext = (e.externalEventId || e.external_event_id || '').toLowerCase()
    const uid = (e.userId || e.user_id || '').toLowerCase()
    return tx.includes(s) || ext.includes(s) || uid.includes(s)
  })

  // Pagination for deeper polish
  const totalDepositPages = Math.max(1, Math.ceil(displayedDepositEvents.length / DEPOSIT_PAGE_SIZE))
  const paginatedDepositEvents = displayedDepositEvents.slice(
    depositPage * DEPOSIT_PAGE_SIZE,
    (depositPage + 1) * DEPOSIT_PAGE_SIZE
  )

  // Stats
  const depositStats = {
    total: (cryptoDepositEvents as any[]).length,
    matched: (cryptoDepositEvents as any[]).filter((e: any) => (e.status || e.Status) === 'matched').length,
    unmatched: (cryptoDepositEvents as any[]).filter((e: any) => (e.status || e.Status) === 'unmatched').length,
    swept: (cryptoDepositEvents as any[]).filter((e: any) => (e.sweepStatus || e.sweep_status) === 'swept').length,
    pendingSweep: (cryptoDepositEvents as any[]).filter((e: any) => {
      const sw = e.sweepStatus || e.sweep_status
      return !sw || sw === 'pending' || sw === 'failed'
    }).length,
  }

  // Compact panel for operations INDEX
  const CompactCryptoDeposits = isOperationsIndex && !showCryptoDeposits ? (
    <div className="mt-3 border border-[var(--border)] bg-[var(--clay)] p-3">
      <div className="flex items-center justify-between text-[9px]">
        <div className="font-bold uppercase tracking-[1px] text-[var(--gold2)]">Crypto Deposits (scanner)</div>
        <div className="flex gap-1">
          <Button variant="secondary" className="text-[9px] py-0.5 px-1.5" onClick={() => void triggerCryptoDepositSync?.()}>Scan</Button>
          <Button variant="secondary" className="text-[9px] py-0.5 px-1.5" onClick={() => void reloadCryptoDepositEvents?.()}>Reload</Button>
        </div>
      </div>
      <div className="mt-1 text-[9px] text-[var(--text2)]">All assets supported (Sui/NEAR complete, Polygon ERC20s added). {depositStats.total} recent events • {depositStats.swept} swept • {depositStats.pendingSweep} pending/failed sweep.</div>
      <div className="mt-1 flex gap-1 text-[9px]">
        <input id="fd-addr-compact" className="flex-1 border px-1 py-0.5 bg-[var(--clay2)] text-[10px]" placeholder="force scan address" />
        <Button className="text-[9px] py-0.5" onClick={() => {
          const v = (document.getElementById('fd-addr-compact') as HTMLInputElement | null)?.value?.trim()
          if (v) void forceScanCryptoDepositAddress?.(v).then(() => void reloadCryptoDepositEvents?.())
        }}>Force</Button>
      </div>
    </div>
  ) : null

  // Deep polished full view — only on the dedicated /crypto-deposits page
  const RichCryptoDepositsView = showCryptoDeposits ? (
    <div className="space-y-4">
      <AdminCryptoDepositReconciler />
      <AdminCexInboundTransfers />
      {/* Header + Stats */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-base font-bold text-[var(--text)]">Crypto deposits</div>
          <div className="text-[10px] text-[var(--text2)]">On-chain detections from user deposit addresses • auto NGN credit at live sell rate • auto-sweep to treasury</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={loadingBatchPreview} onClick={async () => {
            setLoadingBatchPreview(true)
            try {
              const response = await fetch('/api/admin/crypto-deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'treasury-batch-preview' }) })
              const json = await response.json()
              if (!response.ok) throw new Error(json?.error || 'Unable to quote treasury conversion.')
              setBatchPreview(json.data)
            } catch (error) {
              alert(error instanceof Error ? error.message : 'Unable to quote treasury conversion.')
            } finally {
              setLoadingBatchPreview(false)
            }
          }}>
            {loadingBatchPreview ? 'Quoting…' : 'Review Treasury Conversion'}
          </Button>
          <Button variant="secondary" disabled={refreshingCryptoDepositEvents} onClick={() => void triggerCryptoDepositSync?.()}>
            {refreshingCryptoDepositEvents ? 'Scanning…' : 'Trigger Full Scan'}
          </Button>
          <Button variant="secondary" disabled={refreshingCryptoDepositEvents} onClick={() => void reloadCryptoDepositEvents?.()}>
            {refreshingCryptoDepositEvents ? 'Loading…' : 'Reload'}
          </Button>
          <Button variant="secondary" className="text-[10px]" onClick={exportDepositEventsToCsv} disabled={displayedDepositEvents.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>

      <Modal open={Boolean(batchPreview)} onClose={() => { if (!runningBatchConversion) setBatchPreview(null) }} title="Manual treasury conversion">
        <div className="space-y-3 text-sm">
          <p className="text-[var(--muted)]">This quote is live. It may convert a balance below the automatic $20 rule, so review the expected Base USDC carefully.</p>
          <div className="space-y-2">
            {(batchPreview?.conversions || []).map((item: any) => (
              <div key={item.pairId} className="border border-[var(--border)] bg-[var(--clay)] p-3 text-xs">
                <div className="font-bold text-[var(--text)]">{item.pairId}</div>
                {item.ready ? <div className="mt-1 text-[var(--green2)]">Estimated Base USDC: {(Number(item.quotedUsdcUnits || 0) / 1_000_000).toFixed(6)}{item.belowThreshold ? ' (below automatic $20 threshold)' : ''}</div> : <div className="mt-1 text-[var(--muted)]">{item.skipped || item.error || 'No convertible balance'}</div>}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBatchPreview(null)} disabled={runningBatchConversion}>Cancel</Button>
            <Button disabled={runningBatchConversion || !(batchPreview?.conversions || []).some((item: any) => item.ready)} onClick={async () => {
              if (!window.confirm('Convert the quoted treasury balances to Base USDC now? This cannot be undone.')) return
              setRunningBatchConversion(true)
              try {
                const response = await fetch('/api/admin/crypto-deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'treasury-batch-convert', confirm: 'CONVERT' }) })
                const json = await response.json()
                if (!response.ok) throw new Error(json?.error || 'Conversion could not be started.')
                setBatchPreview(json.data)
                await reloadCryptoDepositEvents?.()
              } catch (error) {
                alert(error instanceof Error ? error.message : 'Conversion failed.')
              } finally {
                setRunningBatchConversion(false)
              }
            }}>{runningBatchConversion ? 'Converting…' : 'Convert anyway'}</Button>
          </div>
        </div>
      </Modal>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: 'Loaded Events', value: depositStats.total },
          { label: 'Matched Orders', value: depositStats.matched },
          { label: 'Direct Credits (unmatched)', value: depositStats.unmatched },
          { label: 'Swept to Treasury', value: depositStats.swept },
          { label: 'Pending / Failed Sweep', value: depositStats.pendingSweep },
        ].map((s, i) => (
          <div key={i} className="border border-[var(--border)] bg-[var(--clay)] p-3">
            <div className="text-[10px] font-medium text-[var(--muted)]">{s.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-[var(--text)]">{s.value.toLocaleString('en-NG')}</div>
          </div>
        ))}
      </div>

      {/* Option 1: Recent Sweep Gas Usage (from in-memory logs in sweeper) */}
      {(recentSweepGasStats && recentSweepGasStats.length > 0) && (
        <div className="border border-[var(--border)] bg-[var(--clay)] p-3">
          <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)] mb-2">Recent Sweep Gas Usage (for tuning reserves)</div>
          <div className="max-h-40 overflow-auto text-[8px] space-y-1 font-mono">
            {recentSweepGasStats.slice(0, 15).map((s: any, i: number) => (
              <div key={i} className="flex justify-between border-b border-[var(--border)] pb-0.5">
                <span>{new Date(s.timestamp).toLocaleTimeString()} {s.pairId}</span>
                <span>recv {s.received} | res {s.reserved} | sent {s.sent}</span>
              </div>
            ))}
          </div>
          <div className="text-[7px] text-[var(--muted)] mt-1">These are the actual reserved vs sent amounts from recent native sweeps. Use to tune MAFITAPAY_SWEEP_*_MULTIPLIER and buffers.</div>
        </div>
      )}

      {/* Filters + Force Scan */}
      <div className="border border-[var(--border)] bg-[var(--clay)] p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={cryptoDepositStatusFilter}
            onChange={(e) => applyDepositFilter({ status: e.target.value === 'all' ? 'all' : e.target.value })}
            className="bg-[var(--clay2)] border border-[var(--border)] text-[10px] px-2 py-1"
          >
            <option value="all">All Status</option>
            <option value="matched">Matched</option>
            <option value="unmatched">Unmatched</option>
            <option value="ignored">Ignored</option>
          </select>
          <select
            value={cryptoDepositSweepFilter}
            onChange={(e) => applyDepositFilter({ sweepStatus: e.target.value === 'all' ? 'all' : e.target.value })}
            className="bg-[var(--clay2)] border border-[var(--border)] text-[10px] px-2 py-1"
          >
            <option value="all">All Sweep</option>
            <option value="pending">Pending</option>
            <option value="sweeping">Sweeping</option>
            <option value="swept">Swept</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
          <input
            value={cryptoDepositPairFilter}
            onChange={(e) => { setCryptoDepositPairFilter(e.target.value); setDepositPage(0) }}
            placeholder="Pair ID (e.g. USDC_BASE)"
            className="bg-[var(--clay2)] border border-[var(--border)] text-[10px] px-2 py-1 w-40"
          />
          <input
            value={cryptoDepositSearch}
            onChange={(e) => { setCryptoDepositSearch(e.target.value); setDepositPage(0) }}
            placeholder="Search tx / external / user"
            className="bg-[var(--clay2)] border border-[var(--border)] text-[10px] px-2 py-1 flex-1 min-w-[160px]"
          />
          <Button variant="secondary" className="text-[10px]" onClick={() => void reloadCryptoDepositEvents?.({ pairId: cryptoDepositPairFilter })}>Apply Filters</Button>
        </div>

        {/* Prominent Force Scan */}
        <div className="border border-[var(--border)] bg-[var(--clay2)] p-2">
          <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)] mb-1">Manual Force Scan (one address)</div>
          <div className="flex gap-2">
            <input id="force-addr-rich" placeholder="0x... or near/sui/ton deposit address" className="flex-1 border border-[var(--border)] bg-[var(--clay)] px-2 py-1 text-[11px] font-mono" />
            <Button onClick={() => {
              const el = document.getElementById('force-addr-rich') as HTMLInputElement | null
              const addr = el?.value?.trim()
              if (addr) {
                void forceScanCryptoDepositAddress?.(addr).then(() => {
                  void reloadCryptoDepositEvents?.()
                  if (el) el.value = ''
                })
              }
            }} className="text-[10px]">Force Scan + Refresh</Button>
            <Button 
              onClick={async () => {
                setSyncingBinanceCex(true)
                try {
                  await fetch('/api/admin/crypto-deposits', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ intent: 'sync-binance-cex' }),
                  })
                  await reloadCryptoDepositEvents?.()
                } finally {
                  setSyncingBinanceCex(false)
                }
              }} 
              disabled={syncingBinanceCex}
              className="text-[10px]"
            >
              {syncingBinanceCex ? 'Syncing Binance CEX…' : 'Sync Binance CEX'}
            </Button>

            {/* Quick win: manual create Binance intent and record deposit (for testing/manual) */}
            {/* CEX parked — pending list and most binance UI hidden to reduce noise while on on-chain focus.
            <PendingCexIntentsList reloadKey={refreshingCryptoDepositEvents ? 1 : 0} /> */}
            <div className="mt-2 text-[8px] border-t border-[var(--border)] pt-1">
              <div className="flex gap-1 mb-1">
                <input id="binance-user" placeholder="user id" className="flex-1 border px-1 py-0.5 text-[8px]" />
                <input id="binance-pair" placeholder="pair e.g. USDT or USDT_BSC" className="w-20 border px-1 py-0.5 text-[8px]" defaultValue="USDT" />
                <input id="binance-amt" placeholder="amt" className="w-12 border px-1 py-0.5 text-[8px]" />
                <Button 
                  onClick={async () => {
                    const uid = (document.getElementById('binance-user') as HTMLInputElement)?.value?.trim()
                    const p = (document.getElementById('binance-pair') as HTMLInputElement)?.value?.trim()
                    const a = (document.getElementById('binance-amt') as HTMLInputElement)?.value?.trim()
                    if (uid && p && a) {
                      try {
                        const res = await fetch('/api/admin/crypto-deposits', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ intent: 'create-binance-intent', userId: uid, pairId: p, expectedAmountCrypto: Number(a) }),
                        })
                        const d = await res.json()
                        alert('Intent ref: ' + (d.data?.reference || JSON.stringify(d)))
                        await reloadCryptoDepositEvents?.()
                      } catch (e) {
                        alert('Failed to create intent')
                      }
                    }
                  }} 
                  disabled={recordingCex}
                  className="text-[8px]"
                >
                  Create Intent
                </Button>
              </div>
              <div className="flex gap-1">
                <input id="record-user" placeholder="user" className="flex-1 border px-1 py-0.5 text-[8px]" />
                <input id="record-pair" placeholder="pair (e.g. USDC or USDC_BASE)" className="w-20 border px-1 py-0.5 text-[8px]" defaultValue="USDC" />
                <input id="record-amt" placeholder="amt" className="w-12 border px-1 py-0.5 text-[8px]" />
                <input id="record-tx" placeholder="binance txid" className="flex-1 border px-1 py-0.5 text-[8px]" />
                <input id="record-memo" placeholder="memo/ref" className="flex-1 border px-1 py-0.5 text-[8px]" />
                <Button 
                  onClick={async () => {
                    const u = (document.getElementById('record-user') as HTMLInputElement)?.value?.trim()
                    const p = (document.getElementById('record-pair') as HTMLInputElement)?.value?.trim()
                    const a = (document.getElementById('record-amt') as HTMLInputElement)?.value?.trim()
                    const t = (document.getElementById('record-tx') as HTMLInputElement)?.value?.trim()
                    const m = (document.getElementById('record-memo') as HTMLInputElement)?.value?.trim()
                    if (u && p && a && t) {
                      setRecordingCex(true)
                      try {
                        const res = await fetch('/api/admin/crypto-deposits', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ intent: 'record-binance', userId: u, pairId: p, amountCrypto: Number(a), amountUnits: (Number(a)*1e6).toFixed(0), cexTxId: t, memo: m }),
                        })
                        const json = await res.json().catch(() => ({}))
                        if (!res.ok) {
                          alert('Record failed: ' + (json.error || res.statusText))
                        } else {
                          alert('Recorded successfully')
                        }
                        await reloadCryptoDepositEvents?.()
                      } finally {
                        setRecordingCex(false)
                      }
                    }
                  }} 
                  disabled={recordingCex}
                  className="text-[8px]"
                >
                  {recordingCex ? 'Recording...' : 'Record Deposit'}
                </Button>
              </div>
            </div>
          </div>
          <div className="text-[8px] text-[var(--muted)] mt-1">Useful for missed detections, test sends, or addresses that fell outside the recent window.</div>
        </div>
      </div>

      {/* Deposit events */}
      <div className="overflow-hidden border border-[var(--border)] bg-[var(--clay)]">
        <div className="max-h-[620px] overflow-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="sticky top-0 z-10 bg-[var(--clay2)] text-[var(--muted)]">
              <tr>
                <th className="p-3 text-left font-semibold">Date</th>
                <th className="p-3 text-left font-semibold">Asset</th>
                <th className="p-3 text-right font-semibold">Received</th>
                <th className="p-3 text-left font-semibold">Customer</th>
                <th className="p-3 text-left font-semibold">Deposit</th>
                <th className="p-3 text-left font-semibold">Treasury sweep</th>
                <th className="p-3 text-left font-semibold">Reference</th>
                <th className="p-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedDepositEvents.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-sm text-[var(--muted)]">No deposits match these filters.</td></tr>
              )}
              {paginatedDepositEvents.map((ev: any) => {
                const ext = ev.externalEventId || ev.external_event_id
                const txHash = ev.txHash || ev.tx_hash
                const sweepTxHash = ev.sweepTxHash || ev.sweep_tx_hash
                const sweepError = ev.sweepError || ev.sweep_error
                const sw = ev.sweepStatus || ev.sweep_status || 'pending'
                const isSwept = sw === 'swept'
                const status = ev.status || ev.Status
                const source = ev.source || 'onchain'
                const userId = ev.userId || ev.user_id
                const symbol = ev.assetSymbol || ev.asset_symbol || ''
                return (
                  <tr key={ev.id || ext} className="border-t border-[var(--border)] align-top hover:bg-[var(--clay2)]">
                    <td className="whitespace-nowrap p-3 text-[11px] text-[var(--muted)]">{formatDateTime(ev.createdAt || ev.created_at)}</td>
                    <td className="p-3">
                      <div className="font-semibold text-[var(--text)]">{symbol || ev.pairId || ev.pair_id || 'Crypto'}</div>
                      <div className="mt-0.5 text-[10px] capitalize text-[var(--muted)]">{ev.network || ev.pairId || ev.pair_id || 'Network unavailable'}{source !== 'onchain' ? ` · ${String(source).replaceAll('_', ' ')}` : ''}</div>
                    </td>
                    <td className="whitespace-nowrap p-3 text-right font-semibold tabular-nums text-[var(--text)]">{formatCryptoAmount(ev.amountCrypto ?? ev.amount_crypto)} <span className="text-[var(--muted)]">{symbol}</span></td>
                    <td className="p-3">
                      <div className="font-mono text-[11px] text-[var(--text)]" title={userId}>{shortReference(userId, 8, 5)}</div>
                      {(ev.memo || ev.cexExchange) && <div className="mt-0.5 max-w-[150px] truncate text-[10px] text-[var(--muted)]" title={ev.memo}>{ev.cexExchange ? `${ev.cexExchange} · ` : ''}{ev.memo || 'CEX deposit'}</div>}
                    </td>
                    <td className="p-3"><StatusBadge value={status} /></td>
                    <td className="p-3">
                      <StatusBadge value={sw} />
                      {(sweepError || sweepTxHash) && <div className={`mt-1 max-w-[180px] truncate text-[10px] ${sweepError ? 'text-[var(--red2)]' : 'font-mono text-[var(--muted)]'}`} title={sweepError || sweepTxHash}>{sweepError || shortReference(sweepTxHash, 9, 5)}</div>}
                    </td>
                    <td className="p-3">
                      <button type="button" className="font-mono text-[11px] text-[var(--gold2)] hover:underline" onClick={() => setSelectedDepositEventId(ext)} title={txHash || ext}>{shortReference(txHash || ext)}</button>
                      <div className="mt-0.5 text-[10px] text-[var(--muted)]">{txHash ? 'Transaction hash' : 'Event reference'}</div>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setSelectedDepositEventId(ext)}>Details</Button>
                        {!isSwept && <Button size="sm" variant="secondary" disabled={resweepingEventId === ext} onClick={() => handleResweep(ext)}>{resweepingEventId === ext ? 'Working…' : 'Re-sweep'}</Button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          <div>Showing {displayedDepositEvents.length === 0 ? 0 : depositPage * DEPOSIT_PAGE_SIZE + 1}–{Math.min((depositPage + 1) * DEPOSIT_PAGE_SIZE, displayedDepositEvents.length)} of {displayedDepositEvents.length} loaded</div>
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" disabled={depositPage === 0} onClick={() => setDepositPage(p => Math.max(0, p - 1))}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={depositPage >= totalDepositPages - 1} onClick={() => setDepositPage(p => Math.min(totalDepositPages - 1, p + 1))}>Next</Button>
          </div>
        </div>
      </div>
      {refreshingCryptoDepositEvents && (
        <div className="text-[10px] text-[var(--muted)]">Loading crypto deposit transactions...</div>
      )}
      <div className="text-[8px] text-[var(--muted)]">Events are produced by the background deposit scanner. Re-sweep will attempt to move funds for a matched but not-yet-swept event. Force scan bypasses the normal window for a specific address.</div>
    </div>
  ) : null
  const selectedSettlement = [...depositIntents, ...payoutRequests].find(item => item.reference === selectedSettlementReference) ?? null
  const selectedProviderEvent = providerEvents.find(item => item.id === selectedProviderEventId) ?? null
  const supportCards = [
    {
      key: 'webhook',
      label: 'Webhook Acceptance Test',
      summary: 'Replay a real or simulated Flutterwave payload through the settlement handler.',
      countLabel: webhookTestResult ? `Last run: HTTP ${webhookTestResult.status || 'n/a'}` : 'Ready',
      open: showWebhookTester,
      onToggle: () => setShowWebhookTester(current => !current),
      actionLabel: showWebhookTester ? 'Hide Tool' : 'Open Tool',
    },
    {
      key: 'ledger',
      label: 'Transaction Ledger Trace',
      summary: 'Inspect wallet entries and balance movements behind a specific transaction.',
      countLabel: `${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`,
      open: showLedgerTools,
      onToggle: () => setShowLedgerTools(current => !current),
      actionLabel: showLedgerTools ? 'Hide Tool' : 'Open Tool',
    },
    {
      key: 'reference',
      label: 'Reference Support View',
      summary: 'Inspect linked transaction, provider records, events, and audit trail for a reference.',
      countLabel: referenceCase ? `Open case: ${referenceCase.reference}` : 'No case open',
      open: showReferenceSupport,
      onToggle: () => setShowReferenceSupport(current => !current),
      actionLabel: showReferenceSupport ? 'Hide Tool' : 'Open Tool',
    },
  ] as const

  return (
    <>
      {showOrders && <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold text-[var(--text)]">Crypto Orders</div>
            <div className="mt-1 text-[10px] text-[var(--muted)]">Up to 100 most recent orders across all statuses</div>
          </div>
          <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={async () => {
            setRefreshingCryptoOrders(true)
            try {
              await reloadCryptoOrders()
            } catch (error) {
              alert(error instanceof Error ? error.message : 'Unable to refresh crypto orders.')
            } finally {
              setRefreshingCryptoOrders(false)
            }
          }} disabled={refreshingCryptoOrders}>
            {refreshingCryptoOrders ? 'Refreshing…' : 'Refresh Orders'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void syncAllBaseReceipts()} disabled={syncingAllBaseReceipts}>
            {syncingAllBaseReceipts ? 'Scanning Base…' : 'Sync All Base Receipts'}
          </Button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <select
            aria-label="Filter crypto orders by status"
            value={cryptoOrderStatusFilter}
            onChange={event => setCryptoOrderStatusFilter(event.target.value as typeof cryptoOrderStatusFilter)}
            className="border border-[var(--border)] bg-[var(--clay2)] px-2 py-1 text-[10px] text-[var(--text)]"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="failed">Failed</option>
            <option value="expired">Expired</option>
          </select>
          <input
            aria-label="Search crypto orders"
            value={cryptoOrderSearch}
            onChange={event => setCryptoOrderSearch(event.target.value)}
            placeholder="Search pair, order, user, wallet, tx"
            className="min-w-[220px] flex-1 border border-[var(--border)] bg-[var(--clay2)] px-2 py-1 text-[10px] text-[var(--text)]"
          />
        </div>
        <div className="grid gap-3">
          {visibleCryptoOrders.length === 0 ? (
            <div className="text-[11px] text-[var(--muted)]">No crypto orders match these filters.</div>
          ) : visibleCryptoOrders.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedCryptoOrderId(item.id)}
              className="grid gap-4 rounded-lg border border-[var(--border)] bg-[var(--clay)] p-4 text-left transition-colors hover:border-[var(--border2)] sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-[var(--text)]">{item.pairId}</span>
                  <StatusBadge value={item.status} />
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] capitalize text-[var(--muted)]">{item.side}</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-[10px] text-[var(--muted)]">NGN amount</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--text)]">₦{Number(item.amountNgn || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--muted)]">Crypto amount</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--text)]">{formatCryptoAmount(item.cryptoAmount)} <span className="text-[var(--muted)]">{getCryptoDisplaySymbolFromPairId(item.pairId)}</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--muted)]">Created</div>
                    <div className="mt-0.5 text-xs text-[var(--text2)]">{formatDateTime(item.createdAt)}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--muted)]">
                  <span>Order <span className="font-mono text-[var(--text2)]">{shortReference(item.id, 8, 5)}</span></span>
                  {item.executionStatus && <span className="flex items-center gap-1">Delivery <StatusBadge value={item.executionStatus} /></span>}
                  {item.provider && <span>Provider {item.provider}</span>}
                  {item.destinationTxHash && <span className="font-mono" title={item.destinationTxHash}>Tx {shortReference(item.destinationTxHash, 9, 5)}</span>}
                </div>
              </div>
              <div className="self-center text-xs font-semibold text-[var(--gold2)]">Open order details →</div>
            </button>
          ))}
        </div>
        <Modal
          open={Boolean(selectedCryptoOrder)}
          onClose={() => setSelectedCryptoOrderId(null)}
          title={selectedCryptoOrder ? selectedCryptoOrder.pairId : 'Crypto Order'}
          subtitle={selectedCryptoOrder ? `${selectedCryptoOrder.side.toUpperCase()} · ${selectedCryptoOrder.status.toUpperCase()}` : undefined}
          size="lg"
          className="max-w-4xl"
        >
          {selectedCryptoOrder && (
            <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-[var(--muted)]">{selectedCryptoOrder.side === 'buy' ? 'Crypto purchase' : 'Crypto sale'}</div>
                  <div className="mt-1 text-lg font-bold text-[var(--text)]">{selectedCryptoOrder.pairId}</div>
                </div>
                <div className="flex flex-wrap gap-2"><StatusBadge value={selectedCryptoOrder.status} /><StatusBadge value={selectedCryptoOrder.executionStatus || 'not routed'} /></div>
              </div>
              <div className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--clay2)] p-3 sm:grid-cols-3">
                <div><div className="text-[10px] text-[var(--muted)]">NGN amount</div><div className="mt-1 text-sm font-semibold tabular-nums text-[var(--text)]">₦{Number(selectedCryptoOrder.amountNgn || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}</div></div>
                <div><div className="text-[10px] text-[var(--muted)]">Crypto amount</div><div className="mt-1 text-sm font-semibold tabular-nums text-[var(--text)]">{formatCryptoAmount(selectedCryptoOrder.cryptoAmount)} {getCryptoDisplaySymbolFromPairId(selectedCryptoOrder.pairId)}</div></div>
                <div><div className="text-[10px] text-[var(--muted)]">Rate</div><div className="mt-1 text-sm font-semibold tabular-nums text-[var(--text)]">₦{Number(selectedCryptoOrder.unitRate || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}</div></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Order ID', selectedCryptoOrder.id],
                  ['Created', formatDateTime(selectedCryptoOrder.createdAt)],
                  ['Destination', selectedCryptoOrder.destinationLabel || selectedCryptoOrder.destinationType],
                  ['Wallet address', selectedCryptoOrder.walletAddress],
                  ['Provider', selectedCryptoOrder.provider],
                  ['Execution rail', selectedCryptoOrder.executionRail],
                  ['Provider reference', selectedCryptoOrder.providerReference],
                  ['Execution reference', selectedCryptoOrder.executionReference],
                  ['Provider status', selectedCryptoOrder.providerStatus],
                  ['Destination transaction', selectedCryptoOrder.destinationTxHash],
                ].filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => (
                  <div key={String(label)} className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--clay2)] p-3">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</div>
                    <div className="mt-1 break-all font-mono text-xs text-[var(--text)]">{String(value)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(selectedCryptoOrder.executionRail === 'base_legacy' || selectedCryptoOrder.executionRail === 'base_treasury') && selectedCryptoOrder.pairId === 'ETH_BASE' && selectedCryptoOrder.executionStatus !== 'broadcasted' && (
                  <Button size="sm" variant="secondary" onClick={() => void executeZeroExSwap(selectedCryptoOrder.id)} disabled={broadcastingCryptoOrderId === selectedCryptoOrder.id || resolvingCryptoOrderId === selectedCryptoOrder.id}>
                    {broadcastingCryptoOrderId === selectedCryptoOrder.id ? 'Swapping…' : 'Swap via 0x'}
                  </Button>
                )}
                {selectedCryptoOrder.executionRail === 'routed_treasury' && selectedCryptoOrder.executionStatus !== 'broadcasted' && (
                  <Button size="sm" variant="secondary" onClick={() => void broadcastCryptoOrder(selectedCryptoOrder.id)} disabled={broadcastingCryptoOrderId === selectedCryptoOrder.id || resolvingCryptoOrderId === selectedCryptoOrder.id}>
                    {broadcastingCryptoOrderId === selectedCryptoOrder.id ? 'Routing…' : 'Route via LI.FI'}
                  </Button>
                )}
                {selectedCryptoOrder.executionRail === 'sui_treasury' && selectedCryptoOrder.executionStatus !== 'broadcasted' && (
                  <Button size="sm" variant="secondary" onClick={() => void broadcastCryptoOrder(selectedCryptoOrder.id)} disabled={broadcastingCryptoOrderId === selectedCryptoOrder.id || resolvingCryptoOrderId === selectedCryptoOrder.id}>
                    {broadcastingCryptoOrderId === selectedCryptoOrder.id ? 'Routing…' : 'Route to Sui Treasury'}
                  </Button>
                )}
                {selectedCryptoOrder.executionRail === 'near_intents' && selectedCryptoOrder.executionStatus !== 'broadcasted' && (
                  <Button size="sm" variant="secondary" onClick={() => void broadcastCryptoOrder(selectedCryptoOrder.id)} disabled={broadcastingCryptoOrderId === selectedCryptoOrder.id || resolvingCryptoOrderId === selectedCryptoOrder.id}>
                    {broadcastingCryptoOrderId === selectedCryptoOrder.id ? 'Routing…' : 'Route via NEAR Intents'}
                  </Button>
                )}
                {(selectedCryptoOrder.executionRail === 'base_legacy' || selectedCryptoOrder.executionRail === 'base_treasury' || selectedCryptoOrder.executionRail === 'bsc_treasury') && selectedCryptoOrder.provider !== '0x' && selectedCryptoOrder.executionStatus !== 'broadcasted' && (
                  <Button size="sm" variant="secondary" onClick={() => void broadcastCryptoOrder(selectedCryptoOrder.id)} disabled={broadcastingCryptoOrderId === selectedCryptoOrder.id || resolvingCryptoOrderId === selectedCryptoOrder.id}>
                    {broadcastingCryptoOrderId === selectedCryptoOrder.id ? 'Broadcasting…' : 'Broadcast Delivery'}
                  </Button>
                )}
                {(selectedCryptoOrder.executionRail === 'base_legacy' || selectedCryptoOrder.executionRail === 'base_treasury' || selectedCryptoOrder.executionRail === 'bsc_treasury' || selectedCryptoOrder.executionRail === 'routed_treasury' || selectedCryptoOrder.executionRail === 'sui_treasury' || selectedCryptoOrder.executionRail === 'near_intents') && selectedCryptoOrder.executionStatus === 'broadcasted' && (selectedCryptoOrder.destinationTxHash || typeof selectedCryptoOrder.providerPayload?.swapTxHash === 'string' || typeof selectedCryptoOrder.providerPayload?.sendingTxHash === 'string' || typeof selectedCryptoOrder.providerPayload?.originTxHash === 'string') && (
                  <Button size="sm" variant="secondary" onClick={() => void syncBaseReceipt(selectedCryptoOrder.id)} disabled={syncingBaseReceiptOrderId === selectedCryptoOrder.id || resolvingCryptoOrderId === selectedCryptoOrder.id}>
                    {syncingBaseReceiptOrderId === selectedCryptoOrder.id ? 'Syncing…' : 'Sync Receipt'}
                  </Button>
                )}
                {(selectedCryptoOrder.executionRail === 'base_legacy' || selectedCryptoOrder.executionRail === 'base_treasury' || selectedCryptoOrder.executionRail === 'bsc_treasury' || selectedCryptoOrder.executionRail === 'routed_treasury' || selectedCryptoOrder.executionRail === 'sui_treasury' || selectedCryptoOrder.executionRail === 'near_intents') && selectedCryptoOrder.executionStatus !== 'broadcasted' && (
                  <Button size="sm" variant="secondary" onClick={() => void updateCryptoExecution(selectedCryptoOrder.id, 'broadcasted')} disabled={updatingCryptoExecutionId === selectedCryptoOrder.id || resolvingCryptoOrderId === selectedCryptoOrder.id}>
                    {updatingCryptoExecutionId === selectedCryptoOrder.id ? 'Updating…' : 'Mark Broadcasted'}
                  </Button>
                )}
                {selectedCryptoOrder.executionRail !== 'base_legacy' && selectedCryptoOrder.executionRail !== 'base_treasury' && selectedCryptoOrder.executionRail !== 'bsc_treasury' && selectedCryptoOrder.executionRail !== 'routed_treasury' && selectedCryptoOrder.executionRail !== 'sui_treasury' && (
                  <>
                    <Button size="sm" onClick={() => void resolveCryptoOrder(selectedCryptoOrder.id, 'fulfilled')} disabled={resolvingCryptoOrderId === selectedCryptoOrder.id}>
                      {resolvingCryptoOrderId === selectedCryptoOrder.id ? 'Updating…' : 'Fulfill'}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => void resolveCryptoOrder(selectedCryptoOrder.id, 'failed')} disabled={resolvingCryptoOrderId === selectedCryptoOrder.id}>
                      Fail
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </Modal>
      </Card>}

      {CompactCryptoDeposits}
      {RichCryptoDepositsView}

      {showEvents && <Card className="p-5">
        <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Flutterwave Issues</div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Payout Failures</div>
            <div className="space-y-2">
              {flutterwaveIssuePayouts.length === 0 ? (
                <div className="text-[10px] text-[var(--muted)]">No recent Flutterwave payout failures.</div>
              ) : flutterwaveIssuePayouts.map(item => (
                <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[11px] font-bold text-[var(--text)]">{item.reference}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.provider} · {item.status.toUpperCase()} · ₦{item.amount.toLocaleString('en-NG')}</div>
                  {item.providerReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider ref: {item.providerReference}</div>}
                  {item.providerStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {item.providerStatus}</div>}
                  {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Event / Webhook Problems</div>
            <div className="space-y-2">
              {flutterwaveIssueEvents.length === 0 ? (
                <div className="text-[10px] text-[var(--muted)]">No recent Flutterwave provider-event issues.</div>
              ) : flutterwaveIssueEvents.map(item => (
                <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[11px] font-bold text-[var(--text)]">{item.externalEventId}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.reference} · {item.status.toUpperCase()}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    {item.processedAt ? `Processed ${new Date(item.processedAt).toLocaleString('en-NG')}` : 'Not processed yet'}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                  {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Deposit Failures</div>
            <div className="space-y-2">
              {flutterwaveIssueDeposits.length === 0 ? (
                <div className="text-[10px] text-[var(--muted)]">No recent Flutterwave deposit failures.</div>
              ) : flutterwaveIssueDeposits.map(item => (
                <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[11px] font-bold text-[var(--text)]">{item.reference}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.provider} · {item.status.toUpperCase()} · Gross ₦{item.grossAmount.toLocaleString('en-NG')}</div>
                  {item.accountNumber && <div className="mt-1 text-[10px] text-[var(--muted)]">Funding account: {item.bankName || 'Bank'} · {item.accountNumber}</div>}
                  {item.providerReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider ref: {item.providerReference}</div>}
                  {item.providerStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {item.providerStatus}</div>}
                  {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Deposit Event Problems</div>
            <div className="space-y-2">
              {flutterwaveDepositEvents.length === 0 ? (
                <div className="text-[10px] text-[var(--muted)]">No recent Flutterwave deposit event issues.</div>
              ) : flutterwaveDepositEvents.map(item => (
                <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="text-[11px] font-bold text-[var(--text)]">{item.externalEventId}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.reference} · {item.status.toUpperCase()}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    {item.processedAt ? `Processed ${new Date(item.processedAt).toLocaleString('en-NG')}` : 'Not processed yet'}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                  {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>}

      {showSupport && <Card className="p-5">
        <div className="mb-4 text-[11px] font-bold text-[var(--text)]">Support Tools</div>
        <div className="grid gap-3 md:grid-cols-3">
          {supportCards.map(item => (
            <div key={item.key} className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="text-[11px] font-bold text-[var(--text)]">{item.label}</div>
              <div className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">{item.summary}</div>
              <div className="mt-3 text-[10px] text-[var(--gold2)]">{item.countLabel}</div>
              <div className="mt-4">
                <Button variant="secondary" size="sm" onClick={item.onToggle}>
                  {item.actionLabel}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>}

      <div className={`grid gap-6 ${isOperationsIndex ? '2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
      {showSettlements && <Card className="p-5">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Settlement Operations</div>
          <div className="mb-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_10rem] xl:grid-cols-[minmax(0,1fr)_10rem_10rem_auto_auto_auto]">
            <input
              value={settlementSearch}
              onChange={event => setSettlementSearch(event.target.value)}
              placeholder="Search by reference"
              className="flex-1 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
            />
            <select
              value={settlementStatusFilter}
              onChange={event => setSettlementStatusFilter(event.target.value as typeof settlementStatusFilter)}
              className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
            <input
              value={settlementProviderFilter}
              onChange={event => setSettlementProviderFilter(event.target.value)}
              placeholder="Provider"
              className="w-36 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
            />
            <Button variant="secondary" size="sm" onClick={() => void syncAllPendingPayouts()} disabled={syncingAllPayouts || refreshingSettlementQueues}>
              {syncingAllPayouts ? 'Syncing Payouts…' : 'Sync Pending Payouts'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void reloadSettlementQueues(settlementSearch, settlementStatusFilter, settlementProviderFilter)} disabled={refreshingSettlementQueues}>
              {refreshingSettlementQueues ? 'Searching…' : 'Search'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowReferenceSupport(true)
                void inspectReference(settlementSearch)
              }}
              disabled={loadingReferenceCase === settlementSearch.trim() || refreshingSettlementQueues}
            >
              {loadingReferenceCase === settlementSearch.trim() && settlementSearch.trim() ? 'Opening…' : 'Open Case'}
            </Button>
          </div>
          <div className="grid gap-4">
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Deposit Intents</div>
              <div className="grid gap-3">
                {depositIntents.length === 0 ? (
                  <div className="text-[10px] text-[var(--muted)]">No deposit intents found.</div>
                ) : depositIntents.map(item => (
                  <button key={item.id} type="button" onClick={() => setSelectedSettlementReference(item.reference)} className="grid gap-3 border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5 text-left transition-all hover:border-[var(--border2)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)_minmax(0,1.25fr)_auto] xl:items-center">
                    <div className="min-w-0">
                      <div className="break-all text-[11px] font-bold text-[var(--text)]">{item.reference}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px] font-bold uppercase tracking-[.7px]">
                        <span className="border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[var(--gold2)]">{item.provider}</span>
                        <span className="border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[var(--text2)]">{item.status}</span>
                      </div>
                    </div>
                    <div className="min-w-0 text-[10px] leading-relaxed text-[var(--muted)]">
                      <div className="font-bold text-[var(--text)]">Net ₦{item.netAmount.toLocaleString('en-NG')}</div>
                      <div>Gross ₦{item.grossAmount.toLocaleString('en-NG')} · Fee ₦{item.fee.toLocaleString('en-NG')}</div>
                      <div>Method: {item.fundingMethod} · Retries: {item.retryCount ?? 0}</div>
                    </div>
                    <div className="min-w-0 text-[10px] leading-relaxed text-[var(--muted)]">
                      {item.accountNumber && <div>Account: {item.bankName || 'Bank'} · {item.accountNumber}</div>}
                      {item.providerReference && <div className="break-all">Provider ref: {item.providerReference}</div>}
                      {item.providerStatus && <div>Provider status: {item.providerStatus}</div>}
                      {item.failureReason && <div className="text-[var(--red2)]">Failure: {item.failureReason}</div>}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)] xl:text-right">Open Case</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Payout Requests</div>
              <div className="grid gap-3">
                {payoutRequests.length === 0 ? (
                  <div className="text-[10px] text-[var(--muted)]">No payout requests found.</div>
                ) : payoutRequests.map(item => (
                  <button key={item.id} type="button" onClick={() => setSelectedSettlementReference(item.reference)} className="grid gap-3 border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5 text-left transition-all hover:border-[var(--border2)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)_minmax(0,1.25fr)_auto] xl:items-center">
                    <div className="min-w-0">
                      <div className="break-all text-[11px] font-bold text-[var(--text)]">{item.reference}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px] font-bold uppercase tracking-[.7px]">
                        <span className="border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[var(--gold2)]">{item.provider}</span>
                        <span className="border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[var(--text2)]">{item.status}</span>
                      </div>
                    </div>
                    <div className="min-w-0 text-[10px] leading-relaxed text-[var(--muted)]">
                      <div className="font-bold text-[var(--text)]">₦{item.amount.toLocaleString('en-NG')}</div>
                      <div>Retries: {item.retryCount ?? 0}</div>
                      {item.beneficiary && <div>Beneficiary: {item.beneficiary}</div>}
                    </div>
                    <div className="min-w-0 text-[10px] leading-relaxed text-[var(--muted)]">
                      {item.merchantId && <div>Merchant: {item.merchantId}</div>}
                      {item.providerReference && <div className="break-all">Provider ref: {item.providerReference}</div>}
                      {item.providerStatus && <div>Provider status: {item.providerStatus}</div>}
                      {item.failureReason && <div className="text-[var(--red2)]">Failure: {item.failureReason}</div>}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)] xl:text-right">Open Case</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Modal
            open={Boolean(selectedSettlement)}
            onClose={() => setSelectedSettlementReference(null)}
            title={selectedSettlement ? selectedSettlement.reference : 'Settlement Case'}
            subtitle={selectedSettlement ? ('grossAmount' in selectedSettlement ? `${selectedSettlement.provider} · ${selectedSettlement.status.toUpperCase()}` : `${selectedSettlement.provider} · ${selectedSettlement.status.toUpperCase()}`) : undefined}
            size="lg"
            className="max-w-4xl"
          >
            {selectedSettlement && (
              <div className="border border-[var(--gold)] bg-[var(--clay)] p-4">
                <div className="text-[12px] font-bold text-[var(--text)]">{selectedSettlement.reference}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  {'grossAmount' in selectedSettlement
                    ? `Provider: ${selectedSettlement.provider} · Gross ₦${selectedSettlement.grossAmount.toLocaleString('en-NG')}`
                    : `Provider: ${selectedSettlement.provider} · Amount ₦${selectedSettlement.amount.toLocaleString('en-NG')}`}
                </div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Status: {selectedSettlement.status.toUpperCase()}</div>
                {'providerStatus' in selectedSettlement && selectedSettlement.providerStatus && (
                  <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {selectedSettlement.providerStatus}</div>
                )}
                {'failureReason' in selectedSettlement && selectedSettlement.failureReason && (
                  <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {selectedSettlement.failureReason}</div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedSettlement.status === 'pending' && (
                    <>
                      <Button size="sm" onClick={() => void resolveSettlement(selectedSettlement.reference, 'success')} disabled={resolvingReference === selectedSettlement.reference}>
                        {resolvingReference === selectedSettlement.reference ? 'Resolving…' : 'Mark Success'}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void resolveSettlement(selectedSettlement.reference, 'failed')} disabled={resolvingReference === selectedSettlement.reference}>
                        Fail
                      </Button>
                    </>
                  )}
                  {selectedSettlement.status === 'failed' && (
                    <Button variant="secondary" size="sm" onClick={() => void requeueSettlement(selectedSettlement.reference)} disabled={requeueingReference === selectedSettlement.reference}>
                      {requeueingReference === selectedSettlement.reference ? 'Requeueing…' : 'Requeue'}
                    </Button>
                  )}
                  {selectedSettlement.status === 'success' && (
                    <div className="text-[10px] text-[var(--green2)]">Terminal record. Manual resolution is disabled.</div>
                  )}
                </div>
              </div>
            )}
          </Modal>
        </Card>}

      {showEvents && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">Provider Events</div>
          <Button variant="secondary" size="sm" onClick={() => void Promise.all([
            reloadProviderEvents(providerEventStatusFilter, providerEventProviderFilter, settlementSearch),
            reloadProviderDiagnosticsReport(),
          ])} disabled={refreshingProviderDiagnostics || refreshingProviderEvents}>
            {refreshingProviderDiagnostics || refreshingProviderEvents ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        {providerDiagnosticsReport && (
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
              <div className="font-bold uppercase tracking-[1px] text-[var(--muted)]">Pending</div>
              <div className={`mt-2 text-[12px] font-bold ${providerDiagnosticsReport.totalPendingEvents > 0 ? 'text-[var(--gold2)]' : 'text-[var(--green2)]'}`}>
                {providerDiagnosticsReport.totalPendingEvents}
              </div>
            </div>
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
              <div className="font-bold uppercase tracking-[1px] text-[var(--muted)]">Failures 24h</div>
              <div className={`mt-2 text-[12px] font-bold ${providerDiagnosticsReport.totalFailedEvents24h > 0 ? 'text-[var(--red2)]' : 'text-[var(--green2)]'}`}>
                {providerDiagnosticsReport.totalFailedEvents24h}
              </div>
            </div>
            <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
              <div className="font-bold uppercase tracking-[1px] text-[var(--muted)]">Retry Queue</div>
              <div className={`mt-2 text-[12px] font-bold ${providerDiagnosticsReport.totalRetryingEvents > 0 ? 'text-[var(--gold2)]' : 'text-[var(--green2)]'}`}>
                {providerDiagnosticsReport.totalRetryingEvents}
              </div>
            </div>
          </div>
        )}
        <div className="mb-4 grid gap-2 md:grid-cols-[10rem_10rem_minmax(0,1fr)_auto]">
            <select
              value={providerEventStatusFilter}
              onChange={event => setProviderEventStatusFilter(event.target.value as typeof providerEventStatusFilter)}
              className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
            <input
              value={providerEventProviderFilter}
              onChange={event => setProviderEventProviderFilter(event.target.value)}
              placeholder="Provider"
              className="w-36 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
            />
            <input
              value={settlementSearch}
              onChange={event => setSettlementSearch(event.target.value)}
              placeholder="Reference"
              className="w-40 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
            />
            <Button variant="secondary" size="sm" onClick={() => void reloadProviderEvents(providerEventStatusFilter, providerEventProviderFilter, settlementSearch)} disabled={refreshingProviderEvents}>
              {refreshingProviderEvents ? 'Filtering…' : 'Filter'}
            </Button>
          </div>
          <div className="grid gap-3">
            {providerEvents.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)]">No provider events recorded yet.</div>
            ) : providerEvents.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedProviderEventId(item.id)}
                className="grid gap-3 border border-[var(--border)] bg-[var(--clay)] p-4 text-left transition-all hover:border-[var(--border2)] lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] lg:items-center"
              >
                <div>
                  <div className="text-[11px] font-bold text-[var(--text)]">{item.provider}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-bold uppercase tracking-[.7px]">
                    <span className="border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[var(--text2)]">{item.status}</span>
                    <span className="border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[var(--text2)]">{item.retryCount ?? 0} retries</span>
                  </div>
                </div>
                <div className="min-w-0 text-[10px] leading-relaxed text-[var(--muted)]">
                  <div className="break-all">Reference: {item.reference}</div>
                  <div className="break-all">Event: {item.externalEventId}</div>
                  <div>{item.processedAt ? `Processed ${new Date(item.processedAt).toLocaleString('en-NG')}` : 'Pending processing'}</div>
                  {item.failureReason && <div className="text-[var(--red2)]">Failure: {item.failureReason}</div>}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Open Event</div>
              </button>
            ))}
          </div>
          <Modal
            open={Boolean(selectedProviderEvent)}
            onClose={() => setSelectedProviderEventId(null)}
            title={selectedProviderEvent ? selectedProviderEvent.provider : 'Provider Event'}
            subtitle={selectedProviderEvent ? `${selectedProviderEvent.externalEventId} · ${selectedProviderEvent.status.toUpperCase()}` : undefined}
            size="lg"
            className="max-w-4xl"
          >
            {selectedProviderEvent && (
              <div className="border border-[var(--gold)] bg-[var(--clay)] p-4">
                <div className="text-[12px] font-bold text-[var(--text)]">{selectedProviderEvent.provider} · {selectedProviderEvent.status.toUpperCase()}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Reference: {selectedProviderEvent.reference}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Event: {selectedProviderEvent.externalEventId}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {selectedProviderEvent.retryCount ?? 0}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  {selectedProviderEvent.processedAt ? `Processed ${new Date(selectedProviderEvent.processedAt).toLocaleString('en-NG')}` : 'Pending processing'}
                </div>
                {selectedProviderEvent.failureReason && (
                  <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {selectedProviderEvent.failureReason}</div>
                )}
                {selectedProviderEvent.payload && (
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words border border-[var(--border)] bg-[var(--coal)] p-3 text-[9px] text-[var(--muted)]">
                    {JSON.stringify(selectedProviderEvent.payload, null, 2)}
                  </pre>
                )}
                {selectedProviderEvent.processedAt && (
                  <div className="mt-3">
                    <Button variant="secondary" size="sm" onClick={() => void requeueEvent(selectedProviderEvent.externalEventId)} disabled={requeueingEventId === selectedProviderEvent.externalEventId}>
                      {requeueingEventId === selectedProviderEvent.externalEventId ? 'Requeueing…' : 'Requeue Event'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Modal>
        </Card>}

        {showSupport && showLedgerTools && <Card className="p-5">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Transaction Ledger Trace</div>
          <div className="space-y-3">
            {transactions.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)]">No transactions available.</div>
            ) : transactions.map(item => (
              <div key={item.transaction.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-bold text-[var(--text)]">{item.transaction.description}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--muted)]">
                      {item.userId} · {item.transaction.reference} · {item.transaction.status.toUpperCase()}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setShowLedgerTools(true)
                      void inspectLedger(item.transaction.id)
                    }}
                    disabled={selectedTransactionId === item.transaction.id}
                  >
                    {selectedTransactionId === item.transaction.id ? 'Loading…' : 'Inspect'}
                  </Button>
                </div>
              </div>
            ))}
            {ledgerTrace && (
              <div className="border border-[var(--gold)] bg-[rgba(79,70,229,.06)] p-4">
                <div className="text-[11px] font-bold text-[var(--text)]">{ledgerTrace.transaction.description}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  User: {ledgerTrace.userId} · Ref: {ledgerTrace.transaction.reference}
                </div>
                <div className="mt-3 space-y-2">
                  {ledgerTrace.ledgerEntries.length === 0 ? (
                    <div className="text-[10px] text-[var(--muted)]">No ledger entries for this transaction.</div>
                  ) : ledgerTrace.ledgerEntries.map(entry => (
                    <div key={entry.id} className="border border-[var(--border)] bg-[var(--coal)] p-3">
                      <div className="text-[10px] font-bold text-[var(--text)]">
                        {entry.account.toUpperCase()} · {entry.direction.toUpperCase()} · ₦{entry.amount.toLocaleString('en-NG')}
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">{entry.description || 'No description'}</div>
                      <div className="mt-1 text-[9px] text-[var(--muted)]">{new Date(entry.createdAt).toLocaleString('en-NG')}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>}

        {showSupport && showReferenceSupport && <Card className="p-5 xl:col-span-2">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Reference Support View</div>
          <div className="mb-4 flex flex-wrap gap-2">
            <input
              value={settlementSearch}
              onChange={event => setSettlementSearch(event.target.value)}
              placeholder="Search by reference"
              className="min-w-[14rem] flex-1 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void inspectReference(settlementSearch)}
              disabled={loadingReferenceCase === settlementSearch.trim() || !settlementSearch.trim()}
            >
              {loadingReferenceCase === settlementSearch.trim() && settlementSearch.trim() ? 'Opening…' : 'Open Case'}
            </Button>
          </div>
          {!referenceCase ? (
            <div className="text-[11px] text-[var(--muted)]">
              Search a settlement reference and use <span className="font-mono">Open Case</span> to inspect the linked transaction, provider records, ledger entries, events, and audit trail together.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                <div className="text-[12px] font-bold text-[var(--text)]">{referenceCase.reference}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  Transaction: {referenceCase.transaction ? `${referenceCase.transaction.transaction.status.toUpperCase()} · ${referenceCase.transaction.transaction.type}` : 'not found'}
                  {' · '}
                  Crypto order: {referenceCase.cryptoOrder ? referenceCase.cryptoOrder.status.toUpperCase() : 'none'}
                  {' · '}
                  Deposit intent: {referenceCase.depositIntent ? referenceCase.depositIntent.status.toUpperCase() : 'none'}
                  {' · '}
                  Payout request: {referenceCase.payoutRequest ? referenceCase.payoutRequest.status.toUpperCase() : 'none'}
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Transaction</div>
                  {!referenceCase.transaction ? (
                    <div className="mt-2 text-[10px] text-[var(--muted)]">No transaction linked to this reference.</div>
                  ) : (
                    <div className="mt-2 space-y-1 text-[10px] text-[var(--text2)]">
                      <div>User: {referenceCase.transaction.userId}</div>
                      <div>ID: {referenceCase.transaction.transaction.id}</div>
                      <div>Description: {referenceCase.transaction.transaction.description}</div>
                      <div>Status: {referenceCase.transaction.transaction.status.toUpperCase()}</div>
                      <div>Amount: ₦{referenceCase.transaction.transaction.amount.toLocaleString('en-NG')}</div>
                      <div>Fee: ₦{referenceCase.transaction.transaction.fee.toLocaleString('en-NG')}</div>
                      <div>Created: {new Date(referenceCase.transaction.transaction.createdAt).toLocaleString('en-NG')}</div>
                    </div>
                  )}
                </div>

                <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Provider Record</div>
                  {referenceCase.cryptoOrder ? (
                    <div className="mt-2 space-y-1 text-[10px] text-[var(--text2)]">
                      <div>Type: Crypto Order</div>
                      <div>Status: {referenceCase.cryptoOrder.status.toUpperCase()}</div>
                      <div>Pair: {referenceCase.cryptoOrder.pairId}</div>
                      <div>Side: {referenceCase.cryptoOrder.side.toUpperCase()}</div>
                      <div>NGN amount: ₦{referenceCase.cryptoOrder.amountNgn.toLocaleString('en-NG')}</div>
                      <div>Crypto amount: {referenceCase.cryptoOrder.cryptoAmount.toFixed(8)}</div>
                      <div>Quoted rate: ₦{referenceCase.cryptoOrder.unitRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</div>
                      <div>Destination: {referenceCase.cryptoOrder.destinationLabel || referenceCase.cryptoOrder.destinationType}</div>
                      {referenceCase.cryptoOrder.provider && <div>Provider: {referenceCase.cryptoOrder.provider}</div>}
                      {referenceCase.cryptoOrder.executionRail && <div>Execution rail: {referenceCase.cryptoOrder.executionRail}</div>}
                      {referenceCase.cryptoOrder.executionStatus && <div>Execution status: {referenceCase.cryptoOrder.executionStatus}</div>}
                      {referenceCase.cryptoOrder.executionReference && <div>Execution ref: {referenceCase.cryptoOrder.executionReference}</div>}
                      {referenceCase.cryptoOrder.destinationTxHash && <div className="break-all">Destination tx: {referenceCase.cryptoOrder.destinationTxHash}</div>}
                      {referenceCase.cryptoOrder.providerReference && <div>Provider ref: {referenceCase.cryptoOrder.providerReference}</div>}
                      {referenceCase.cryptoOrder.providerOrderId && <div>Provider order: {referenceCase.cryptoOrder.providerOrderId}</div>}
                      {referenceCase.cryptoOrder.providerStatus && <div>Provider status: {referenceCase.cryptoOrder.providerStatus}</div>}
                    </div>
                  ) : referenceCase.depositIntent ? (
                    <div className="mt-2 space-y-1 text-[10px] text-[var(--text2)]">
                      <div>Type: Deposit Intent</div>
                      <div>Status: {referenceCase.depositIntent.status.toUpperCase()}</div>
                      <div>Provider: {referenceCase.depositIntent.provider}</div>
                      {referenceCase.depositIntent.providerReference && <div>Provider ref: {referenceCase.depositIntent.providerReference}</div>}
                      {referenceCase.depositIntent.providerStatus && <div>Provider status: {referenceCase.depositIntent.providerStatus}</div>}
                      <div>Gross: ₦{referenceCase.depositIntent.grossAmount.toLocaleString('en-NG')}</div>
                      <div>Net: ₦{referenceCase.depositIntent.netAmount.toLocaleString('en-NG')}</div>
                      {referenceCase.depositIntent.failureReason && <div className="text-[var(--red2)]">Failure: {referenceCase.depositIntent.failureReason}</div>}
                    </div>
                  ) : referenceCase.payoutRequest ? (
                    <div className="mt-2 space-y-1 text-[10px] text-[var(--text2)]">
                      <div>Type: Payout Request</div>
                      <div>Status: {referenceCase.payoutRequest.status.toUpperCase()}</div>
                      <div>Provider: {referenceCase.payoutRequest.provider}</div>
                      {referenceCase.payoutRequest.providerReference && <div>Provider ref: {referenceCase.payoutRequest.providerReference}</div>}
                      {referenceCase.payoutRequest.providerStatus && <div>Provider status: {referenceCase.payoutRequest.providerStatus}</div>}
                      <div>Amount: ₦{referenceCase.payoutRequest.amount.toLocaleString('en-NG')}</div>
                      {referenceCase.payoutRequest.beneficiary && <div>Beneficiary: {referenceCase.payoutRequest.beneficiary}</div>}
                      {referenceCase.payoutRequest.failureReason && <div className="text-[var(--red2)]">Failure: {referenceCase.payoutRequest.failureReason}</div>}
                      {referenceCase.payoutRequest.status === 'pending' && <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void syncPayoutReference(referenceCase.reference)}
                          disabled={syncingPayoutReference === referenceCase.reference}
                        >
                          {syncingPayoutReference === referenceCase.reference ? 'Checking provider…' : 'Sync this payout'}
                        </Button>
                        {payoutSyncFeedback && <span className="text-[10px] text-[var(--muted)]">{payoutSyncFeedback}</span>}
                      </div>}
                    </div>
                  ) : (
                    <div className="mt-2 text-[10px] text-[var(--muted)]">No deposit or payout record linked to this reference.</div>
                  )}
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Provider Events</div>
                  <div className="mt-3 space-y-2">
                    {referenceCase.providerEvents.length === 0 ? (
                      <div className="text-[10px] text-[var(--muted)]">No provider events for this reference.</div>
                    ) : referenceCase.providerEvents.map(item => (
                      <div key={item.id} className="border border-[var(--border)] bg-[var(--coal)] p-3">
                        <div className="text-[10px] font-bold text-[var(--text)]">{item.externalEventId}</div>
                        <div className="mt-1 text-[9px] text-[var(--muted)]">{item.provider} · {item.status.toUpperCase()}</div>
                        {item.failureReason && <div className="mt-1 text-[9px] text-[var(--red2)]">{item.failureReason}</div>}
                        {item.payload && (
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[9px] text-[var(--muted)]">
                            {JSON.stringify(item.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Ledger Entries</div>
                  <div className="mt-3 space-y-2">
                    {referenceCase.ledgerEntries.length === 0 ? (
                      <div className="text-[10px] text-[var(--muted)]">No ledger entries linked to this reference.</div>
                    ) : referenceCase.ledgerEntries.map(item => (
                      <div key={item.id} className="border border-[var(--border)] bg-[var(--coal)] p-3">
                        <div className="text-[10px] font-bold text-[var(--text)]">
                          {item.asset} · {item.account.toUpperCase()} · {item.direction.toUpperCase()} · ₦{item.amount.toLocaleString('en-NG')}
                        </div>
                        <div className="mt-1 text-[9px] text-[var(--muted)]">{item.description || 'No description'}</div>
                        <div className="mt-1 text-[9px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString('en-NG')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Audit Trail</div>
                <div className="mt-3 space-y-2">
                  {referenceCase.auditLogs.length === 0 ? (
                    <div className="text-[10px] text-[var(--muted)]">No audit logs linked to this case.</div>
                  ) : referenceCase.auditLogs.map(item => (
                    <div key={item.id} className="border border-[var(--border)] bg-[var(--coal)] p-3">
                      <div className="text-[10px] font-bold text-[var(--text)]">{item.action}</div>
                      <div className="mt-1 text-[9px] text-[var(--muted)]">
                        Entity: {item.entityType} · {item.entityId}
                      </div>
                      <div className="mt-1 text-[9px] text-[var(--muted)]">
                        User: {item.userId ?? 'n/a'} · Actor: {item.actorUserId ?? 'system'}
                      </div>
                      {item.metadata && (
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[9px] text-[var(--muted)]">
                          {JSON.stringify(item.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>}
      </div>

      <Modal
        open={showSupport && showWebhookTester}
        onClose={() => setShowWebhookTester(false)}
        title="Webhook Acceptance Test"
        subtitle="Replay a settlement payload through the internal handler."
        size="lg"
        className="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="text-[11px] text-[var(--muted)]">
            Paste a real or simulated Flutterwave payload here to exercise the same settlement handler used by the public webhook route. This skips signature verification by design.
          </div>
          <textarea
            value={webhookTestPayload}
            onChange={event => setWebhookTestPayload(event.target.value)}
            className="min-h-[16rem] w-full border border-[var(--border)] bg-[var(--clay)] p-3 font-mono text-[10px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void runWebhookAcceptanceTest()} disabled={runningWebhookTest}>
              {runningWebhookTest ? 'Processing…' : 'Run Acceptance Test'}
            </Button>
            <div className="text-[10px] text-[var(--muted)]">
              Use a real customer email and the exact <span className="font-mono">tx_ref</span> or provider reference you want to test.
            </div>
          </div>
          {webhookTestResult && (
            <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Last Result</div>
              <div className="mt-2 text-[11px] text-[var(--text)]">HTTP {webhookTestResult.status || 'n/a'}</div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-[var(--muted)]">
                {JSON.stringify(webhookTestResult.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Modal>

      {/* Deposit event details */}
      <Modal open={!!selectedDepositEventId} onClose={() => setSelectedDepositEventId(null)} title="Crypto deposit details" size="lg">
        <div className="max-h-[75vh] space-y-4 overflow-auto p-5">
          {!selectedDepositEvent ? (
            <div className="py-8 text-center text-sm text-[var(--muted)]">Deposit details are no longer in the loaded results.</div>
          ) : (() => {
            const event = selectedDepositEvent
            const eventId = event.externalEventId || event.external_event_id
            const userId = event.userId || event.user_id
            const pairId = event.pairId || event.pair_id
            const symbol = getCryptoDisplaySymbol(String(event.assetSymbol || event.asset_symbol || getCryptoDisplaySymbolFromPairId(String(pairId || ''))))
            const txHash = event.txHash || event.tx_hash
            const sweepTxHash = event.sweepTxHash || event.sweep_tx_hash
            const sweepError = event.sweepError || event.sweep_error
            const sweepStatus = event.sweepStatus || event.sweep_status || 'pending'
            const depositStatus = event.status || event.Status
            const createdAt = event.createdAt || event.created_at
            return <>
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--clay)] p-4">
                <div>
                  <div className="text-xs text-[var(--muted)]">{pairId || 'Crypto deposit'}{event.network ? ` · ${event.network}` : ''}</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-[var(--text)]">{formatCryptoAmount(event.amountCrypto ?? event.amount_crypto)} <span className="text-base text-[var(--muted)]">{symbol}</span></div>
                  <div className="mt-2 text-xs text-[var(--muted)]">Received {formatDateTime(createdAt)}</div>
                </div>
                <div className="flex flex-wrap gap-2"><StatusBadge value={depositStatus} /><StatusBadge value={sweepStatus} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Customer', userId],
                  ['Event reference', eventId],
                  ['Source', event.source || 'onchain'],
                  ['Exchange', event.cexExchange || event.cex_exchange],
                  ['Memo', event.memo],
                  ['Block', event.blockNumber || event.block_number],
                  ['Log index', event.logIndex ?? event.log_index],
                  ['Swept at', formatDateTime(event.sweptAt || event.swept_at)],
                ].filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => (
                  <div key={String(label)} className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--clay)] p-3">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</div>
                    <div className="mt-1 break-all text-xs text-[var(--text)]">{String(value)}</div>
                  </div>
                ))}
              </div>
              {txHash && <div className="rounded-md border border-[var(--border)] bg-[var(--clay)] p-3"><div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">Deposit transaction</div><div className="mt-1 break-all font-mono text-xs text-[var(--text)]">{txHash}</div></div>}
              {sweepTxHash && <div className="rounded-md border border-[var(--border)] bg-[var(--clay)] p-3"><div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">Sweep transaction</div><div className="mt-1 break-all font-mono text-xs text-[var(--text)]">{sweepTxHash}</div></div>}
              {sweepError && <div className="rounded-md border border-[var(--border)] bg-[var(--clay)] p-3 text-sm text-[var(--red2)]"><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide">Sweep error</div>{sweepError}</div>}
              {event.payload && <details className="rounded-md border border-[var(--border)] bg-[var(--clay)] p-3"><summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">Raw provider payload</summary><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-[var(--text2)]">{JSON.stringify(event.payload, null, 2)}</pre></details>}
              <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
                {sweepStatus !== 'swept' && <Button onClick={() => { void handleResweep(eventId); setSelectedDepositEventId(null) }} disabled={!!resweepingEventId}>{resweepingEventId ? 'Re-sweeping…' : 'Re-sweep deposit'}</Button>}
                <Button variant="secondary" onClick={() => setSelectedDepositEventId(null)}>Close</Button>
              </div>
            </>
          })()}
        </div>
      </Modal>
    </>
  )
}
