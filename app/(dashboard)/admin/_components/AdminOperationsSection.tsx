'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { AdminSubmodule } from '../admin-config'
import type { AdminWorkspaceState } from '../useAdminWorkspace'

export function AdminOperationsSection({ workspace, submodule }: { workspace: AdminWorkspaceState; submodule?: AdminSubmodule }) {
  const [selectedCryptoOrderId, setSelectedCryptoOrderId] = useState<string | null>(null)
  const [selectedSettlementReference, setSelectedSettlementReference] = useState<string | null>(null)
  const [selectedProviderEventId, setSelectedProviderEventId] = useState<string | null>(null)
  const [showWebhookTester, setShowWebhookTester] = useState(false)
  const [showLedgerTools, setShowLedgerTools] = useState(false)
  const [showReferenceSupport, setShowReferenceSupport] = useState(false)
  const [selectedDepositEventId, setSelectedDepositEventId] = useState<string | null>(null)
  const [resweepingEventId, setResweepingEventId] = useState<string | null>(null)
  const [depositPage, setDepositPage] = useState(0)
  const DEPOSIT_PAGE_SIZE = 20
  const {
    cryptoOrders,
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
      {/* Header + Stats */}
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Crypto Deposit Events</div>
          <div className="text-[10px] text-[var(--text2)]">On-chain detections from user deposit addresses • auto NGN credit at live sell rate • auto-sweep to treasury</div>
        </div>
        <div className="flex gap-2">
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

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Total Events', value: depositStats.total },
          { label: 'Matched Orders', value: depositStats.matched },
          { label: 'Direct Credits (unmatched)', value: depositStats.unmatched },
          { label: 'Swept to Treasury', value: depositStats.swept },
          { label: 'Pending / Failed Sweep', value: depositStats.pendingSweep },
        ].map((s, i) => (
          <div key={i} className="border border-[var(--border)] bg-[var(--clay)] p-2">
            <div className="text-[8px] uppercase tracking-[1px] text-[var(--muted)]">{s.label}</div>
            <div className="text-[18px] font-bold tabular-nums">{s.value}</div>
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
            onChange={(e) => applyDepositFilter({ pairId: e.target.value })}
            placeholder="Pair ID (e.g. USDC_BASE)"
            className="bg-[var(--clay2)] border border-[var(--border)] text-[10px] px-2 py-1 w-40"
          />
          <input
            value={cryptoDepositSearch}
            onChange={(e) => { setCryptoDepositSearch(e.target.value); setDepositPage(0) }}
            placeholder="Search tx / external / user"
            className="bg-[var(--clay2)] border border-[var(--border)] text-[10px] px-2 py-1 flex-1 min-w-[160px]"
          />
          <Button variant="secondary" className="text-[10px]" onClick={() => void reloadCryptoDepositEvents?.()}>Apply Filters</Button>
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
          </div>
          <div className="text-[8px] text-[var(--muted)] mt-1">Useful for missed detections, test sends, or addresses that fell outside the recent window.</div>
        </div>
      </div>

      {/* Events Table */}
      <div className="border border-[var(--border)] bg-[var(--clay)] overflow-hidden">
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-[9px]">
            <thead className="sticky top-0 bg-[var(--clay2)] text-[var(--muted)]">
              <tr>
                <th className="text-left p-2">External / Tx</th>
                <th className="text-left p-2">Asset</th>
                <th className="text-right p-2">Amount</th>
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Sweep</th>
                <th className="text-left p-2">Sweep Tx / Error</th>
                <th className="text-left p-2">Time</th>
                <th className="p-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedDepositEvents.length === 0 && (
                <tr><td colSpan={9} className="p-3 text-center text-[var(--muted)]">No events match the current filters.</td></tr>
              )}
              {paginatedDepositEvents.map((ev: any) => {
                const ext = ev.externalEventId || ev.external_event_id
                const sw = ev.sweepStatus || ev.sweep_status
                const isSwept = sw === 'swept'
                const isFailing = sw === 'failed'
                return (
                  <tr key={ev.id || ext} className="border-t border-[var(--border)] hover:bg-[var(--clay2)]">
                    <td className="p-2 font-mono text-[8px] max-w-[140px] truncate cursor-pointer" onClick={() => setSelectedDepositEventId(ext)} title={ext}>{ext}</td>
                    <td className="p-2">{ev.pairId || ev.pair_id} <span className="text-[var(--muted)]">· {ev.assetSymbol || ev.asset_symbol}</span></td>
                    <td className="p-2 text-right tabular-nums">{Number(ev.amountCrypto || ev.amount_crypto || 0).toFixed(6)}</td>
                    <td className="p-2 font-mono text-[8px]">{String(ev.userId || ev.user_id || '').slice(0, 10)}</td>
                    <td className="p-2">
                      <span className={`px-1 py-px ${ev.status === 'matched' ? 'text-[var(--green2)]' : ev.status === 'unmatched' ? 'text-[var(--gold2)]' : ''}`}>
                        {(ev.status || ev.Status || '').toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2">
                      <span className={`px-1 py-px ${isSwept ? 'text-[var(--green2)]' : isFailing ? 'text-[var(--red2)]' : 'text-[var(--muted)]'}`}>
                        {(sw || 'pending').toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-[8px] max-w-[160px] truncate" title={ev.sweepError || ev.sweep_error || ev.sweepTxHash || ev.sweep_tx_hash}>
                      {ev.sweepTxHash || ev.sweep_tx_hash || (ev.sweepError || ev.sweep_error ? 'ERR' : '—')}
                    </td>
                    <td className="p-2 text-[var(--muted)]">{new Date(ev.createdAt || ev.created_at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="p-2">
                      <div className="flex gap-1 justify-end">
                        <Button variant="secondary" className="text-[8px] px-1 py-0" onClick={() => setSelectedDepositEventId(ext)}>Details</Button>
                        {!isSwept && (
                          <Button
                            variant="secondary"
                            className="text-[8px] px-1 py-0"
                            disabled={resweepingEventId === ext}
                            onClick={() => handleResweep(ext)}
                          >
                            {resweepingEventId === ext ? '...' : 'Re-sweep'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination for option 3 deeper polish */}
        <div className="flex items-center justify-between mt-2 text-[9px]">
          <div>Page {depositPage + 1} / {totalDepositPages} ({displayedDepositEvents.length} total)</div>
          <div className="flex gap-1">
            <Button variant="secondary" className="text-[9px] py-0.5 px-2" disabled={depositPage === 0} onClick={() => setDepositPage(p => Math.max(0, p-1))}>Prev</Button>
            <Button variant="secondary" className="text-[9px] py-0.5 px-2" disabled={depositPage >= totalDepositPages - 1} onClick={() => setDepositPage(p => Math.min(totalDepositPages - 1, p+1))}>Next</Button>
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">Crypto Order Operations</div>
          <Button size="sm" variant="secondary" onClick={() => void syncAllBaseReceipts()} disabled={syncingAllBaseReceipts}>
            {syncingAllBaseReceipts ? 'Scanning Base…' : 'Sync All Base Receipts'}
          </Button>
        </div>
        <div className="grid gap-3">
          {cryptoOrders.length === 0 ? (
            <div className="text-[11px] text-[var(--muted)]">No pending crypto orders.</div>
          ) : cryptoOrders.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedCryptoOrderId(item.id)}
              className="grid gap-4 border border-[var(--border)] bg-[var(--clay)] p-4 text-left transition-all hover:border-[var(--border2)] lg:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">{item.pairId}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    {item.side.toUpperCase()} · {item.status.toUpperCase()} · ₦{item.amountNgn.toLocaleString('en-NG')}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    Crypto: {item.cryptoAmount.toFixed(8)} · Rate: ₦{item.unitRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    Destination: {item.destinationLabel || item.destinationType}
                  </div>
                  {item.provider && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider: {item.provider}</div>}
                  {item.executionRail && <div className="mt-1 text-[10px] text-[var(--muted)]">Execution rail: {item.executionRail}</div>}
                  {item.executionStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Execution status: {item.executionStatus}</div>}
                  {item.executionReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Execution ref: {item.executionReference}</div>}
                  {item.destinationTxHash && <div className="mt-1 text-[10px] text-[var(--muted)]">Destination tx: {item.destinationTxHash}</div>}
                  {item.providerStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {item.providerStatus}</div>}
                  {item.providerReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider ref: {item.providerReference}</div>}
                </div>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)] lg:self-center">Open Order Actions</div>
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
            <div className="border border-[var(--gold)] bg-[var(--clay)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">{selectedCryptoOrder.pairId}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    {selectedCryptoOrder.side.toUpperCase()} · {selectedCryptoOrder.status.toUpperCase()} · ₦{selectedCryptoOrder.amountNgn.toLocaleString('en-NG')}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">Crypto: {selectedCryptoOrder.cryptoAmount.toFixed(8)} · Rate: ₦{selectedCryptoOrder.unitRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">Destination: {selectedCryptoOrder.destinationLabel || selectedCryptoOrder.destinationType}</div>
                  {selectedCryptoOrder.provider && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider: {selectedCryptoOrder.provider}</div>}
                  {selectedCryptoOrder.executionRail && <div className="mt-1 text-[10px] text-[var(--muted)]">Execution rail: {selectedCryptoOrder.executionRail}</div>}
                  {selectedCryptoOrder.executionStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Execution status: {selectedCryptoOrder.executionStatus}</div>}
                  {selectedCryptoOrder.executionReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Execution ref: {selectedCryptoOrder.executionReference}</div>}
                  {selectedCryptoOrder.destinationTxHash && <div className="mt-1 text-[10px] text-[var(--muted)]">Destination tx: {selectedCryptoOrder.destinationTxHash}</div>}
                  {selectedCryptoOrder.providerStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {selectedCryptoOrder.providerStatus}</div>}
                  {selectedCryptoOrder.providerReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider ref: {selectedCryptoOrder.providerReference}</div>}
                </div>
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

      {/* Rich Deposit Event Detail Modal - shown from the polished deposits table */}
      <Modal open={!!selectedDepositEventId} onClose={() => setSelectedDepositEventId(null)} title="Crypto Deposit Event" size="lg">
        <div className="p-4 text-[10px] space-y-3 max-h-[65vh] overflow-auto">
          {!selectedDepositEvent ? (
            <div className="text-[var(--muted)]">Event details not available.</div>
          ) : (
            <>
              <div className="font-mono break-all bg-[var(--clay2)] p-2 text-[9px]">{selectedDepositEvent.externalEventId || selectedDepositEvent.external_event_id}</div>
              <div><span className="text-[var(--muted)]">Pair / Asset:</span> {selectedDepositEvent.pairId || selectedDepositEvent.pair_id} · {selectedDepositEvent.assetSymbol || selectedDepositEvent.asset_symbol} on {selectedDepositEvent.network}</div>
              <div><span className="text-[var(--muted)]">Amount:</span> {Number(selectedDepositEvent.amountCrypto || selectedDepositEvent.amount_crypto || 0).toFixed(8)}</div>
              <div><span className="text-[var(--muted)]">User:</span> <span className="font-mono">{selectedDepositEvent.userId || selectedDepositEvent.user_id}</span></div>
              <div><span className="text-[var(--muted)]">Status:</span> {selectedDepositEvent.status || selectedDepositEvent.Status} &nbsp; <span className="text-[var(--muted)]">Sweep:</span> {selectedDepositEvent.sweepStatus || selectedDepositEvent.sweep_status || 'pending'}</div>
              <div className="font-mono text-[9px] break-all"><span className="text-[var(--muted)]">Deposit Tx:</span> {selectedDepositEvent.txHash || selectedDepositEvent.tx_hash}</div>
              {(selectedDepositEvent.sweepTxHash || selectedDepositEvent.sweep_tx_hash) && <div className="font-mono text-[9px] break-all"><span className="text-[var(--muted)]">Sweep Tx:</span> {selectedDepositEvent.sweepTxHash || selectedDepositEvent.sweep_tx_hash}</div>}
              {(selectedDepositEvent.sweepError || selectedDepositEvent.sweep_error) && <div className="text-[var(--red2)]">Sweep error: {selectedDepositEvent.sweepError || selectedDepositEvent.sweep_error}</div>}
              <div className="text-[var(--muted)] text-[9px]">Created: {new Date(selectedDepositEvent.createdAt || selectedDepositEvent.created_at).toLocaleString('en-NG')}</div>
              {selectedDepositEvent.payload && (
                <div>
                  <div className="text-[var(--muted)] text-[9px] mb-1">Payload</div>
                  <pre className="bg-[var(--clay2)] p-2 text-[8px] overflow-auto max-h-40">{JSON.stringify(selectedDepositEvent.payload, null, 2)}</pre>
                </div>
              )}
              <div className="pt-2 flex gap-2">
                {!((selectedDepositEvent.sweepStatus || selectedDepositEvent.sweep_status) === 'swept') && (
                  <Button onClick={() => { handleResweep(selectedDepositEvent.externalEventId || selectedDepositEvent.external_event_id); setSelectedDepositEventId(null) }} disabled={!!resweepingEventId}>
                    {resweepingEventId ? 'Re-sweeping…' : 'Re-sweep'}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setSelectedDepositEventId(null)}>Close</Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
