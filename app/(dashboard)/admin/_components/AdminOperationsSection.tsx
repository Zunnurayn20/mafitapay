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
  const {
    cryptoOrders,
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
  const showSupport = !submodule || submodule === 'support'
  const selectedCryptoOrder = cryptoOrders.find(item => item.id === selectedCryptoOrderId) ?? null
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cryptoOrders.length === 0 ? (
            <div className="text-[11px] text-[var(--muted)]">No pending crypto orders.</div>
          ) : cryptoOrders.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedCryptoOrderId(item.id)}
              className="border border-[var(--border)] bg-[var(--clay)] p-4 text-left transition-all hover:border-[var(--border2)]"
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
              <div className="mt-3 text-[10px] text-[var(--gold2)]">Open Order Actions</div>
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {showSettlements && <Card className="p-5">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Settlement Operations</div>
          <div className="mb-4 flex gap-2">
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
          <div className="grid gap-4 xl:grid-cols-2">
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Deposit Intents</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {depositIntents.length === 0 ? (
                  <div className="text-[10px] text-[var(--muted)]">No deposit intents found.</div>
                ) : depositIntents.map(item => (
                  <button key={item.id} type="button" onClick={() => setSelectedSettlementReference(item.reference)} className="border border-[var(--border)] bg-[var(--clay)] p-3 text-left transition-all hover:border-[var(--border2)]">
                    <div className="text-[11px] font-bold text-[var(--text)]">{item.reference}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.provider} · {item.status.toUpperCase()} · Net ₦{item.netAmount.toLocaleString('en-NG')}</div>
                    {item.providerReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider ref: {item.providerReference}</div>}
                    {item.providerStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {item.providerStatus}</div>}
                    <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                    {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                    <div className="mt-2 text-[10px] text-[var(--gold2)]">Open Case</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Payout Requests</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {payoutRequests.length === 0 ? (
                  <div className="text-[10px] text-[var(--muted)]">No payout requests found.</div>
                ) : payoutRequests.map(item => (
                  <button key={item.id} type="button" onClick={() => setSelectedSettlementReference(item.reference)} className="border border-[var(--border)] bg-[var(--clay)] p-3 text-left transition-all hover:border-[var(--border2)]">
                    <div className="text-[11px] font-bold text-[var(--text)]">{item.reference}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.provider} · {item.status.toUpperCase()} · ₦{item.amount.toLocaleString('en-NG')}</div>
                    {item.beneficiary && <div className="mt-1 text-[10px] text-[var(--muted)]">Beneficiary: {item.beneficiary}</div>}
                    {item.providerReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider ref: {item.providerReference}</div>}
                    {item.providerStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {item.providerStatus}</div>}
                    <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                    {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                    <div className="mt-2 text-[10px] text-[var(--gold2)]">Open Case</div>
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
        <div className="mb-4 flex gap-2">
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {providerEvents.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)]">No provider events recorded yet.</div>
            ) : providerEvents.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedProviderEventId(item.id)}
                className="border border-[var(--border)] bg-[var(--clay)] p-3 text-left transition-all hover:border-[var(--border2)]"
              >
                <div className="text-[11px] font-bold text-[var(--text)]">{item.provider} · {item.status.toUpperCase()}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Reference: {item.reference}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Event: {item.externalEventId}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  {item.processedAt ? `Processed ${new Date(item.processedAt).toLocaleString('en-NG')}` : 'Pending processing'}
                </div>
                <div className="mt-2 text-[10px] text-[var(--gold2)]">Open Event</div>
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
    </>
  )
}
