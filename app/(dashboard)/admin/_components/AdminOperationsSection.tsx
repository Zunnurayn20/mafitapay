'use client'

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { AdminSubmodule } from '../admin-config'
import type { AdminWorkspaceState } from '../useAdminWorkspace'

export function AdminOperationsSection({ workspace, submodule }: { workspace: AdminWorkspaceState; submodule?: AdminSubmodule }) {
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

  return (
    <>
      {showOrders && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">Crypto Order Operations</div>
          <Button size="sm" variant="secondary" onClick={() => void syncAllBaseReceipts()} disabled={syncingAllBaseReceipts}>
            {syncingAllBaseReceipts ? 'Scanning Base…' : 'Sync All Base Receipts'}
          </Button>
        </div>
        <div className="space-y-3">
          {cryptoOrders.length === 0 ? (
            <div className="text-[11px] text-[var(--muted)]">No pending crypto orders.</div>
          ) : cryptoOrders.map(item => (
            <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-4">
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
                <div className="flex gap-2">
                  {(item.executionRail === 'base_legacy' || item.executionRail === 'base_treasury') && item.pairId === 'ETH_BASE' && item.executionStatus !== 'broadcasted' && (
                    <Button size="sm" variant="secondary" onClick={() => void executeZeroExSwap(item.id)} disabled={broadcastingCryptoOrderId === item.id || resolvingCryptoOrderId === item.id}>
                      {broadcastingCryptoOrderId === item.id ? 'Swapping…' : 'Swap via 0x'}
                    </Button>
                  )}
                  {item.executionRail === 'routed_treasury' && item.executionStatus !== 'broadcasted' && (
                    <Button size="sm" variant="secondary" onClick={() => void broadcastCryptoOrder(item.id)} disabled={broadcastingCryptoOrderId === item.id || resolvingCryptoOrderId === item.id}>
                      {broadcastingCryptoOrderId === item.id ? 'Routing…' : 'Route via LI.FI'}
                    </Button>
                  )}
                  {item.executionRail === 'sui_treasury' && item.executionStatus !== 'broadcasted' && (
                    <Button size="sm" variant="secondary" onClick={() => void broadcastCryptoOrder(item.id)} disabled={broadcastingCryptoOrderId === item.id || resolvingCryptoOrderId === item.id}>
                      {broadcastingCryptoOrderId === item.id ? 'Routing…' : 'Route to Sui Treasury'}
                    </Button>
                  )}
                  {item.executionRail === 'near_intents' && item.executionStatus !== 'broadcasted' && (
                    <Button size="sm" variant="secondary" onClick={() => void broadcastCryptoOrder(item.id)} disabled={broadcastingCryptoOrderId === item.id || resolvingCryptoOrderId === item.id}>
                      {broadcastingCryptoOrderId === item.id ? 'Routing…' : 'Route via NEAR Intents'}
                    </Button>
                  )}
                  {(item.executionRail === 'base_legacy' || item.executionRail === 'base_treasury' || item.executionRail === 'bsc_treasury') && item.provider !== '0x' && item.executionStatus !== 'broadcasted' && (
                    <Button size="sm" variant="secondary" onClick={() => void broadcastCryptoOrder(item.id)} disabled={broadcastingCryptoOrderId === item.id || resolvingCryptoOrderId === item.id}>
                      {broadcastingCryptoOrderId === item.id ? 'Broadcasting…' : 'Broadcast Delivery'}
                    </Button>
                  )}
                  {(item.executionRail === 'base_legacy' || item.executionRail === 'base_treasury' || item.executionRail === 'bsc_treasury' || item.executionRail === 'routed_treasury' || item.executionRail === 'sui_treasury' || item.executionRail === 'near_intents') && item.executionStatus === 'broadcasted' && (item.destinationTxHash || typeof item.providerPayload?.swapTxHash === 'string' || typeof item.providerPayload?.sendingTxHash === 'string' || typeof item.providerPayload?.originTxHash === 'string') && (
                    <Button size="sm" variant="secondary" onClick={() => void syncBaseReceipt(item.id)} disabled={syncingBaseReceiptOrderId === item.id || resolvingCryptoOrderId === item.id}>
                      {syncingBaseReceiptOrderId === item.id ? 'Syncing…' : 'Sync Receipt'}
                    </Button>
                  )}
                  {(item.executionRail === 'base_legacy' || item.executionRail === 'base_treasury' || item.executionRail === 'bsc_treasury' || item.executionRail === 'routed_treasury' || item.executionRail === 'sui_treasury' || item.executionRail === 'near_intents') && item.executionStatus !== 'broadcasted' && (
                    <Button size="sm" variant="secondary" onClick={() => void updateCryptoExecution(item.id, 'broadcasted')} disabled={updatingCryptoExecutionId === item.id || resolvingCryptoOrderId === item.id}>
                      {updatingCryptoExecutionId === item.id ? 'Updating…' : 'Mark Broadcasted'}
                    </Button>
                  )}
                  {item.provider === 'transak' && (
                    <Button size="sm" variant="secondary" onClick={() => void syncCryptoOrder(item.id)} disabled={syncingCryptoOrderId === item.id || resolvingCryptoOrderId === item.id}>
                      {syncingCryptoOrderId === item.id ? 'Syncing…' : 'Sync'}
                    </Button>
                  )}
                  {item.executionRail !== 'base_legacy' && item.executionRail !== 'base_treasury' && item.executionRail !== 'bsc_treasury' && item.executionRail !== 'routed_treasury' && item.executionRail !== 'sui_treasury' && (
                    <>
                      <Button size="sm" onClick={() => void resolveCryptoOrder(item.id, 'fulfilled')} disabled={resolvingCryptoOrderId === item.id}>
                        {resolvingCryptoOrderId === item.id ? 'Updating…' : 'Fulfill'}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void resolveCryptoOrder(item.id, 'failed')} disabled={resolvingCryptoOrderId === item.id}>
                        Fail
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
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
        <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Webhook Acceptance Test</div>
        <div className="mb-3 text-[11px] text-[var(--muted)]">
          Paste a real or simulated Flutterwave payload here to exercise the same settlement handler used by the public webhook route. This is admin-only and skips signature verification by design.
        </div>
        <textarea
          value={webhookTestPayload}
          onChange={event => setWebhookTestPayload(event.target.value)}
          className="min-h-[16rem] w-full border border-[var(--border)] bg-[var(--clay)] p-3 font-mono text-[10px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
          spellCheck={false}
        />
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void runWebhookAcceptanceTest()} disabled={runningWebhookTest}>
            {runningWebhookTest ? 'Processing…' : 'Run Acceptance Test'}
          </Button>
          <div className="text-[10px] text-[var(--muted)]">
            Use a real customer email and the exact <span className="font-mono">tx_ref</span> or provider reference you want to test.
          </div>
        </div>
        {webhookTestResult && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Last Result</div>
            <div className="mt-2 text-[11px] text-[var(--text)]">HTTP {webhookTestResult.status || 'n/a'}</div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-[var(--muted)]">
              {JSON.stringify(webhookTestResult.body, null, 2)}
            </pre>
          </div>
        )}
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
              onChange={event => setSettlementStatusFilter(event.target.value)}
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
            <Button variant="secondary" size="sm" onClick={() => void syncAllPendingPayouts()} disabled={syncingAllPayouts}>
              {syncingAllPayouts ? 'Syncing Payouts…' : 'Sync Pending Payouts'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void reloadSettlementQueues(settlementSearch, settlementStatusFilter, settlementProviderFilter)}>Search</Button>
            <Button variant="secondary" size="sm" onClick={() => void inspectReference(settlementSearch)} disabled={loadingReferenceCase === settlementSearch.trim()}>
              {loadingReferenceCase === settlementSearch.trim() && settlementSearch.trim() ? 'Opening…' : 'Open Case'}
            </Button>
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Deposit Intents</div>
              <div className="space-y-2">
                {depositIntents.length === 0 ? (
                  <div className="text-[10px] text-[var(--muted)]">No deposit intents found.</div>
                ) : depositIntents.map(item => (
                  <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                    <div className="text-[11px] font-bold text-[var(--text)]">{item.reference}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.provider} · {item.status.toUpperCase()} · Net ₦{item.netAmount.toLocaleString('en-NG')}</div>
                    {item.providerReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider ref: {item.providerReference}</div>}
                    {item.providerStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {item.providerStatus}</div>}
                    <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                    {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                    {item.status === 'pending' && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => void resolveSettlement(item.reference, 'success')} disabled={resolvingReference === item.reference}>
                          {resolvingReference === item.reference ? 'Resolving…' : 'Mark Success'}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => void resolveSettlement(item.reference, 'failed')} disabled={resolvingReference === item.reference}>
                          Fail
                        </Button>
                      </div>
                    )}
                    {item.status === 'failed' && (
                      <div className="mt-2">
                        <Button variant="secondary" size="sm" onClick={() => void requeueSettlement(item.reference)} disabled={requeueingReference === item.reference}>
                          {requeueingReference === item.reference ? 'Requeueing…' : 'Requeue'}
                        </Button>
                      </div>
                    )}
                    {item.status === 'success' && (
                      <div className="mt-2 text-[10px] text-[var(--green2)]">Terminal record. Manual resolution is disabled.</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Payout Requests</div>
              <div className="space-y-2">
                {payoutRequests.length === 0 ? (
                  <div className="text-[10px] text-[var(--muted)]">No payout requests found.</div>
                ) : payoutRequests.map(item => (
                  <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                    <div className="text-[11px] font-bold text-[var(--text)]">{item.reference}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.provider} · {item.status.toUpperCase()} · ₦{item.amount.toLocaleString('en-NG')}</div>
                    {item.beneficiary && <div className="mt-1 text-[10px] text-[var(--muted)]">Beneficiary: {item.beneficiary}</div>}
                    {item.providerReference && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider ref: {item.providerReference}</div>}
                    {item.providerStatus && <div className="mt-1 text-[10px] text-[var(--muted)]">Provider status: {item.providerStatus}</div>}
                    <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                    {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                    {item.status === 'pending' && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => void resolveSettlement(item.reference, 'success')} disabled={resolvingReference === item.reference}>
                          {resolvingReference === item.reference ? 'Resolving…' : 'Mark Success'}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => void resolveSettlement(item.reference, 'failed')} disabled={resolvingReference === item.reference}>
                          Fail
                        </Button>
                      </div>
                    )}
                    {item.status === 'failed' && (
                      <div className="mt-2">
                        <Button variant="secondary" size="sm" onClick={() => void requeueSettlement(item.reference)} disabled={requeueingReference === item.reference}>
                          {requeueingReference === item.reference ? 'Requeueing…' : 'Requeue'}
                        </Button>
                      </div>
                    )}
                    {item.status === 'success' && (
                      <div className="mt-2 text-[10px] text-[var(--green2)]">Terminal record. Manual resolution is disabled.</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>}

      {showEvents && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">Provider Events</div>
          <Button variant="secondary" size="sm" onClick={() => void Promise.all([
            reloadProviderEvents(providerEventStatusFilter, providerEventProviderFilter, settlementSearch),
            reloadProviderDiagnosticsReport(),
          ])} disabled={refreshingProviderDiagnostics}>
            {refreshingProviderDiagnostics ? 'Refreshing…' : 'Refresh'}
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
              onChange={event => setProviderEventStatusFilter(event.target.value)}
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
            <Button variant="secondary" size="sm" onClick={() => void reloadProviderEvents(providerEventStatusFilter, providerEventProviderFilter, settlementSearch)}>Filter</Button>
          </div>
          <div className="space-y-3">
            {providerEvents.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)]">No provider events recorded yet.</div>
            ) : providerEvents.map(item => (
              <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[11px] font-bold text-[var(--text)]">{item.provider} · {item.status.toUpperCase()}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Reference: {item.reference}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Event: {item.externalEventId}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  {item.processedAt ? `Processed ${new Date(item.processedAt).toLocaleString('en-NG')}` : 'Pending processing'}
                </div>
                {item.processedAt && (
                  <div className="mt-2">
                    <Button variant="secondary" size="sm" onClick={() => void requeueEvent(item.externalEventId)} disabled={requeueingEventId === item.externalEventId}>
                      {requeueingEventId === item.externalEventId ? 'Requeueing…' : 'Requeue Event'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>}

        {showSupport && <Card className="p-5">
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
                  <Button size="sm" onClick={() => void inspectLedger(item.transaction.id)} disabled={selectedTransactionId === item.transaction.id}>
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

        {showSupport && <Card className="p-5 xl:col-span-2">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Reference Support View</div>
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
    </>
  )
}
