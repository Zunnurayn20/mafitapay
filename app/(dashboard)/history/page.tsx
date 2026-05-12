'use client'
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { fmtDate, formatNGN } from '@/lib/utils'
import type { CryptoOrder, DepositIntent, LedgerEntry, PayoutRequest, ProviderEvent, Transaction } from '@/types'

const FILTERS = ['All','Deposits','Withdrawals','Bills','Crypto','P2P']

function compactHash(value: string, head = 8, tail = 6) {
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function formatPairLabel(pairId: string) {
  return pairId.replace(/_/g, ' · ')
}

function formatCryptoQuantity(value: number) {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1) return value.toFixed(6).replace(/\.?0+$/, '')
  return value.toFixed(8).replace(/\.?0+$/, '')
}

function buildCryptoOrderProgress(order: CryptoOrder) {
  const currentKey =
    order.status === 'fulfilled'
      ? 'delivered'
      : order.status === 'failed' || order.status === 'expired'
        ? 'failed'
        : order.destinationTxHash
          ? 'delivered'
          : order.executionStatus === 'broadcasted'
            ? 'confirming'
            : order.provider === 'lifi'
              ? 'broadcasting'
              : order.provider === 'near_intents'
                ? 'broadcasting'
              : order.provider === '0x'
              ? 'broadcasting'
              : 'queued'

  const steps = [
    { key: 'queued', label: 'Queued', active: true },
    { key: 'broadcasting', label: order.provider === 'lifi' || order.provider === 'near_intents' ? 'Routing' : order.provider === '0x' ? 'Swapping' : 'Broadcasting', active: currentKey !== 'queued' },
    { key: 'confirming', label: 'Onchain confirmation', active: currentKey === 'confirming' || currentKey === 'delivered' || currentKey === 'failed' },
    { key: 'delivered', label: 'Delivered', active: currentKey === 'delivered' },
  ]

  const statusLabel =
    currentKey === 'failed'
      ? 'Failed'
      : currentKey === 'delivered'
        ? 'Delivered'
        : currentKey === 'confirming'
          ? order.executionRail === 'sui_treasury'
            ? order.providerStatus === 'DONE:AWAITING_SUI_PAYOUT'
              ? 'Awaiting treasury payout'
              : 'Awaiting SUI settlement'
            : order.provider === 'lifi'
            ? 'Awaiting bridge confirmation'
            : order.provider === 'near_intents'
              ? order.providerStatus === 'SUCCESS:AWAITING_NATIVE_PAYOUT'
                ? 'Awaiting treasury payout'
                : 'Awaiting NEAR settlement'
              : 'Awaiting onchain confirmation'
          : currentKey === 'broadcasting'
            ? 'Submitting execution'
            : 'Queued for execution'

  return { currentKey, statusLabel, steps }
}

function getCryptoSettlementTone(order: CryptoOrder) {
  if (order.status === 'fulfilled' || order.destinationTxHash) return 'success'
  if (order.status === 'failed' || order.status === 'expired') return 'failed'
  return 'pending'
}

function getCryptoSettlementLabel(order: CryptoOrder) {
  if (order.status === 'fulfilled' || order.destinationTxHash) return 'Delivered to wallet'
  if (order.status === 'failed') return 'Delivery failed'
  if (order.status === 'expired') return 'Quote expired'
  if (order.executionRail === 'sui_treasury' && order.providerStatus === 'DONE:AWAITING_SUI_PAYOUT') {
    return 'Awaiting treasury payout'
  }
  if (order.provider === 'near_intents' && order.providerStatus === 'SUCCESS:AWAITING_NATIVE_PAYOUT') {
    return 'Awaiting treasury payout'
  }
  if (order.executionStatus === 'broadcasted') return 'Awaiting onchain confirmation'
  if (order.executionRail === 'sui_treasury') return 'Routing through Sui treasury'
  if (order.provider === 'lifi') return 'Routing through bridge'
  if (order.provider === 'near_intents') return 'Routing through NEAR Intents'
  if (order.provider === '0x') return 'Submitting swap'
  return 'Queued for execution'
}

export default function HistoryPage() {
  const { refreshSession, showToast, transactions } = useAppStore()
  const cryptoAssets = useCryptoAssets()
  const [filter, setFilter] = useState('All')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detail, setDetail] = useState<{
    transaction: Transaction
    cryptoOrder: CryptoOrder | null
    ledgerEntries: LedgerEntry[]
    providerEvents: ProviderEvent[]
    depositIntent: DepositIntent | null
    payoutRequest: PayoutRequest | null
    timeline: Array<{ label: string; at: string; tone: string }>
  } | null>(null)

  const filtered = transactions.filter(tx => {
    if (filter === 'All') return true
    if (filter === 'Deposits')    return tx.type.includes('deposit')
    if (filter === 'Withdrawals') return tx.type.includes('withdrawal') || tx.type.includes('transfer_out')
    if (filter === 'Bills')       return ['airtime','data','electric','cable','education','gas','insurance','water'].includes(tx.type)
    if (filter === 'Crypto')      return tx.type.startsWith('crypto')
    if (filter === 'P2P')         return tx.type.startsWith('p2p')
    return true
  })

  async function updateStatus(id: string, status: 'success' | 'failed') {
    setUpdatingId(id)
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Transaction update failed.')
      }

      await refreshSession()
      showToast(status === 'success' ? 'Transaction settled.' : 'Transaction failed and funds released.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Transaction update failed.', 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  async function openDetail(id: string) {
    setSelectedId(id)
    setLoadingDetail(true)
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Failed to load transaction detail.')
      }
      setDetail(payload.data)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load transaction detail.', 'error')
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 flex-wrap">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 text-[10px] font-bold border transition-all ${filter === f ? 'border-[var(--gold)] text-[var(--gold2)] bg-[rgba(79,70,229,.08)]' : 'border-[var(--border)] text-[var(--text2)] bg-[var(--clay)] hover:border-[var(--border2)]'}`}>
            {f}
          </button>
        ))}
        <button className="ml-auto px-3.5 py-1.5 text-[10px] font-bold border border-[var(--border)] text-[var(--text2)] bg-[var(--clay)] flex items-center gap-1.5">
          ⊟ Filter
        </button>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(21rem,0.9fr)]">
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-[52rem] w-full border-collapse">
            <thead>
              <tr>
                {['','Description','Date & Time','Reference','Type','Status','Amount','Actions'].map((h,i) => (
                  <th key={i} className={`px-4 py-3 text-left text-[8px] font-bold uppercase tracking-[1.3px] text-[var(--muted)] border-b border-[var(--border)] bg-[var(--clay)] ${i===6?'text-right':''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => {
                const icon = 'icon' in tx && typeof tx.icon === 'string' ? tx.icon : '•'
                const pairId = typeof tx.metadata?.pairId === 'string' ? tx.metadata.pairId : ''
                const cryptoAsset = pairId ? cryptoAssets.find(asset => asset.id === pairId) : undefined
                const statusVariant =
                  tx.status === 'success' ? 'success' : tx.status === 'failed' ? 'failed' : 'pending'
                const isPendingCryptoOrder =
                  tx.type.startsWith('crypto')
                  && tx.status === 'pending'

                return (
                  <tr key={tx.id} className="hover:bg-[rgba(26,26,46,.6)] cursor-pointer transition-colors" onClick={() => void openDetail(tx.id)}>
                    <td className="px-4 py-3 w-9">
                      {cryptoAsset ? (
                        <AssetLogo
                          src={cryptoAsset.icon}
                          alt={`${cryptoAsset.symbol} logo`}
                          fallback={cryptoAsset.symbol.slice(0, 1)}
                          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[rgba(79,70,229,.1)]"
                          imgClassName="h-6 w-6 object-contain"
                          textClassName="text-[18px] font-bold text-[var(--gold2)]"
                        />
                      ) : (
                        <span className="text-[18px]">{icon}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-semibold text-[var(--text)]">{tx.description}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-[var(--muted)] font-mono">
                        {isPendingCryptoOrder && (
                          <span className="inline-flex items-center gap-1.5 border border-[rgba(99,102,241,.25)] bg-[rgba(79,70,229,.08)] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.6px] text-[var(--gold2)]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold2)] animate-soft-pulse" />
                            Processing
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-[var(--muted)] font-mono whitespace-nowrap">{fmtDate(tx.createdAt)}</td>
                    <td className="px-4 py-3 text-[10px] text-[var(--muted)] font-mono">{tx.reference}</td>
                    <td className="px-4 py-3"><Badge variant="pending">{tx.type.replace(/_/g,' ')}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={statusVariant}>{tx.status}</Badge></td>
                    <td className={`px-4 py-3 text-right text-[13px] font-bold font-mono ${tx.amount > 0 ? 'text-[var(--green2)]' : 'text-[var(--text2)]'}`}>
                      {tx.amount > 0 ? '+' : ''}{formatNGN(tx.amount)}
                    </td>
                    <td className="px-4 py-3">
                      {tx.status === 'pending' && typeof tx.metadata?.provider !== 'string' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={event => { event.stopPropagation(); void updateStatus(tx.id, 'success') }}
                            disabled={updatingId === tx.id}
                            className="border border-[rgba(46,170,92,.35)] bg-[rgba(46,170,92,.12)] px-2.5 py-1 text-[8px] font-bold uppercase text-[var(--green2)] disabled:opacity-50"
                          >
                            {updatingId === tx.id ? 'Updating…' : 'Settle'}
                          </button>
                          <button
                            onClick={event => { event.stopPropagation(); void updateStatus(tx.id, 'failed') }}
                            disabled={updatingId === tx.id}
                            className="border border-[rgba(196,52,26,.35)] bg-[rgba(196,52,26,.08)] px-2.5 py-1 text-[8px] font-bold uppercase text-[var(--red2)] disabled:opacity-50"
                          >
                            Fail
                          </button>
                        </div>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={event => { event.stopPropagation(); void openDetail(tx.id) }}>
                          Inspect
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-[var(--muted)] text-[12px]">No transactions found for this filter.</div>
        )}
      </Card>
      <Card className="p-5">
        <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Transaction Detail</div>
        {!selectedId ? (
          <div className="text-[11px] text-[var(--muted)]">Select a transaction to inspect its settlement summary.</div>
        ) : loadingDetail ? (
          <div className="text-[11px] text-[var(--muted)]">Loading detail…</div>
        ) : !detail ? (
          <div className="text-[11px] text-[var(--muted)]">No detail available.</div>
        ) : (
          <div className="space-y-4">
            <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="text-[12px] font-bold text-[var(--text)]">{detail.transaction.description}</div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">{detail.transaction.reference}</div>
              <div className="mt-2 flex gap-2">
                <Badge variant="pending">{detail.transaction.type.replace(/_/g, ' ')}</Badge>
                <Badge variant={detail.transaction.status === 'success' ? 'success' : detail.transaction.status === 'failed' ? 'failed' : 'pending'}>
                  {detail.transaction.status}
                </Badge>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Timeline</div>
              <div className="space-y-2">
                {detail.timeline.map((item, index) => (
                  <div key={`${item.label}-${index}`} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                    <div className="text-[11px] font-bold text-[var(--text)]">{item.label}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{fmtDate(item.at)}</div>
                  </div>
                ))}
              </div>
            </div>

            {(detail.depositIntent || detail.payoutRequest) && (
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Settlement Record</div>
                <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                  {detail.depositIntent ? (
                    <>
                      <div>Deposit intent · {detail.depositIntent.status.toUpperCase()}</div>
                      <div className="mt-1">Gross: {formatNGN(detail.depositIntent.grossAmount)} · Net: {formatNGN(detail.depositIntent.netAmount)} · Fee: {formatNGN(detail.depositIntent.fee)}</div>
                      {detail.depositIntent.bankName && detail.depositIntent.accountNumber && (
                        <div className="mt-1">Funding account: {detail.depositIntent.bankName} · {detail.depositIntent.accountNumber}</div>
                      )}
                      {detail.depositIntent.accountName && <div className="mt-1">Account label: {detail.depositIntent.accountName}</div>}
                      {detail.depositIntent.expiresAt && <div className="mt-1">Expiry: {fmtDate(detail.depositIntent.expiresAt)}</div>}
                      {detail.depositIntent.failureReason && <div className="mt-1 text-[var(--red2)]">Failure: {detail.depositIntent.failureReason}</div>}
                    </>
                  ) : detail.payoutRequest ? (
                    <>
                      <div>Payout request · {detail.payoutRequest.status.toUpperCase()}</div>
                      <div className="mt-1">Amount: {formatNGN(detail.payoutRequest.amount)}</div>
                      {detail.payoutRequest.beneficiary && <div className="mt-1">Beneficiary: {detail.payoutRequest.beneficiary}</div>}
                      {detail.payoutRequest.lastSyncAt && <div className="mt-1">Last sync: {fmtDate(detail.payoutRequest.lastSyncAt)}{detail.payoutRequest.lastSyncStatus ? ` · ${detail.payoutRequest.lastSyncStatus}` : ''}</div>}
                      {detail.payoutRequest.failureReason && <div className="mt-1 text-[var(--red2)]">Failure: {detail.payoutRequest.failureReason}</div>}
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {detail.cryptoOrder && (
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Crypto Order</div>
                <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                  {(() => {
                    const progress = buildCryptoOrderProgress(detail.cryptoOrder)
                    const settlementTone = getCryptoSettlementTone(detail.cryptoOrder)
                    const settlementLabel = getCryptoSettlementLabel(detail.cryptoOrder)
                    return (
                      <div className="mb-4 border border-[var(--border)] bg-[rgba(79,70,229,.06)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Execution Progress</div>
                          <Badge
                            variant={
                              detail.cryptoOrder.status === 'fulfilled'
                                ? 'success'
                                : detail.cryptoOrder.status === 'failed' || detail.cryptoOrder.status === 'expired'
                                  ? 'failed'
                                  : 'pending'
                            }
                            className={detail.cryptoOrder.status === 'pending' ? 'inline-flex items-center gap-1.5' : undefined}
                          >
                            {detail.cryptoOrder.status === 'pending' && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold2)] animate-soft-pulse" />
                            )}
                            {progress.statusLabel}
                          </Badge>
                        </div>
                        <div className={`mt-3 border px-3 py-2 text-[11px] font-semibold ${
                          settlementTone === 'success'
                            ? 'border-[rgba(46,170,92,.3)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]'
                            : settlementTone === 'failed'
                              ? 'border-[rgba(196,52,26,.3)] bg-[rgba(196,52,26,.08)] text-[var(--red2)]'
                              : 'border-[rgba(202,165,96,.3)] bg-[rgba(202,165,96,.1)] text-[var(--gold2)]'
                        }`}>
                          {settlementLabel}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-4">
                          {progress.steps.map(step => (
                            <div
                              key={step.key}
                              className={`border px-3 py-2 text-[9px] font-bold uppercase tracking-[0.8px] ${
                                progress.currentKey === step.key
                                  ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)] text-[var(--gold2)]'
                                  : step.active
                                    ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]'
                                    : 'border-[var(--border)] bg-[var(--coal)] text-[var(--muted)]'
                              }`}
                            >
                              {step.label}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="border border-[var(--border)] bg-[var(--coal)] p-3">
                      <div className="text-[9px] font-bold uppercase tracking-[0.8px] text-[var(--muted)]">Order</div>
                      <div className="mt-2 text-[11px] font-semibold text-[var(--text)]">
                        {detail.cryptoOrder.side.toUpperCase()} · {formatPairLabel(detail.cryptoOrder.pairId)}
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--text2)]">
                        {formatNGN(detail.cryptoOrder.amountNgn)} for {formatCryptoQuantity(detail.cryptoOrder.cryptoAmount)}
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        Rate: {formatNGN(detail.cryptoOrder.unitRate)}
                      </div>
                    </div>
                    <div className="border border-[var(--border)] bg-[var(--coal)] p-3">
                      <div className="text-[9px] font-bold uppercase tracking-[0.8px] text-[var(--muted)]">Destination</div>
                      <div className="mt-2 text-[11px] font-semibold text-[var(--text)]">
                        {detail.cryptoOrder.walletAddress
                          ? compactHash(detail.cryptoOrder.walletAddress, 10, 8)
                          : detail.cryptoOrder.destinationLabel || detail.cryptoOrder.destinationType || 'Wallet delivery'}
                      </div>
                      {detail.cryptoOrder.walletAddress && (
                        <div className="mt-1 break-all font-mono text-[10px] text-[var(--text2)]">
                          {detail.cryptoOrder.walletAddress}
                        </div>
                      )}
                      {detail.cryptoOrder.destinationTxHash && (
                        <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                          Tx: {compactHash(detail.cryptoOrder.destinationTxHash)}
                        </div>
                      )}
                    </div>
                  </div>
                  {(detail.cryptoOrder.exchange || detail.cryptoOrder.executionStatus) && (
                    <div className="mt-3 border border-[var(--border)] bg-[var(--coal)] p-3">
                      <div className="text-[9px] font-bold uppercase tracking-[0.8px] text-[var(--muted)]">Execution</div>
                      <div className="mt-2 text-[10px] text-[var(--text2)]">
                        {detail.cryptoOrder.executionStatus ? `Status: ${detail.cryptoOrder.executionStatus}` : 'Execution in progress'}
                        {detail.cryptoOrder.exchange ? ` · Route: ${detail.cryptoOrder.exchange}` : ''}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!detail.cryptoOrder && ['airtime', 'data', 'electric', 'cable', 'education', 'gas', 'insurance', 'water'].includes(detail.transaction.type) && (
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Bill Payment</div>
                <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                  <div>Service: {String(detail.transaction.metadata?.serviceName || detail.transaction.description)}</div>
                  {typeof detail.transaction.metadata?.provider === 'string' && (
                    <div className="mt-1">Network: {detail.transaction.metadata.provider}</div>
                  )}
                  {typeof detail.transaction.metadata?.account === 'string' && (
                    <div className="mt-1">Account: {detail.transaction.metadata.account}</div>
                  )}
                  {typeof detail.transaction.metadata?.providerName === 'string' && (
                    <div className="mt-1">Rail: {String(detail.transaction.metadata.providerName).toUpperCase()}</div>
                  )}
                  <div className="mt-1">
                    Charge: {formatNGN(Math.abs(detail.transaction.amount))}
                    {typeof detail.transaction.metadata?.providerBaseAmount === 'number' && typeof detail.transaction.metadata?.platformFee === 'number' && Number(detail.transaction.metadata.platformFee) > 0
                      ? ` · Provider: ${formatNGN(Number(detail.transaction.metadata.providerBaseAmount))} · Platform fee: ${formatNGN(Number(detail.transaction.metadata.platformFee))}`
                      : ''}
                  </div>
                </div>
              </div>
            )}

            <details className="border border-[var(--border)] bg-[var(--clay)] p-3">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">
                Technical Details
              </summary>
              <div className="mt-3 space-y-4">
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Provider Events</div>
                  <div className="space-y-2">
                    {detail.providerEvents.length === 0 ? (
                      <div className="text-[10px] text-[var(--muted)]">No provider events received.</div>
                    ) : detail.providerEvents.map(item => (
                      <div key={item.id} className="border border-[var(--border)] bg-[var(--coal)] p-3">
                        <div className="text-[11px] font-bold text-[var(--text)]">{item.provider} · {item.status.toUpperCase()}</div>
                        <div className="mt-1 text-[10px] text-[var(--muted)]">{item.externalEventId || 'No external event id'}</div>
                        <div className="mt-1 text-[10px] text-[var(--muted)]">{fmtDate(item.createdAt)}</div>
                        <div className="mt-1 text-[10px] text-[var(--muted)]">Retries: {item.retryCount ?? 0}</div>
                        {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">Failure: {item.failureReason}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Ledger Entries</div>
                  <div className="space-y-2">
                    {detail.ledgerEntries.length === 0 ? (
                      <div className="text-[10px] text-[var(--muted)]">No ledger entries attached to this transaction.</div>
                    ) : detail.ledgerEntries.map(item => (
                      <div key={item.id} className="border border-[var(--border)] bg-[var(--coal)] p-3">
                        <div className="text-[11px] font-bold text-[var(--text)]">{item.asset} · {item.account.toUpperCase()} · {item.direction.toUpperCase()} · {formatNGN(item.amount)}</div>
                        <div className="mt-1 text-[10px] text-[var(--muted)]">{item.description || 'No description'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}
      </Card>
      </div>
    </div>
  )
}
