'use client'
import { useState } from 'react'
import { toBlob, toPng } from 'html-to-image'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { fmtDate, formatNGN } from '@/lib/utils'
import type { CryptoOrder, DepositIntent, PayoutRequest, Transaction } from '@/types'

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
  if (value >= 1) return value.toFixed(4).replace(/\.?0+$/, '')
  return value.toFixed(5).replace(/\.?0+$/, '')
}

function formatHistoryTitle(tx: Transaction, cryptoAsset?: { network?: string; symbol?: string }) {
  if (!tx.type.startsWith('crypto')) {
    switch (tx.type) {
      case 'deposit':
        return 'Bank Deposit'
      case 'withdrawal':
        return 'Bank Withdrawal'
      case 'transfer_in':
        return 'Funds Received'
      case 'transfer_out':
        return tx.metadata?.settlementKind === 'bank_transfer_out' ? 'Bank Transfer' : 'Internal Transfer'
      case 'airtime':
        return 'Airtime'
      case 'data':
        return 'Data'
      case 'electric':
        return 'Electricity'
      case 'cable':
        return 'Cable TV'
      case 'education':
        return 'Education'
      case 'gas':
        return 'Gas'
      case 'insurance':
        return 'Insurance'
      case 'water':
        return 'Water'
      case 'referral_bonus':
        return 'Referral Bonus'
      case 'reward_bonus':
        return 'Reward Bonus'
      case 'p2p_deposit':
        return 'P2P Deposit'
      case 'p2p_withdrawal':
        return 'P2P Withdrawal'
      default:
        return tx.description
    }
  }

  const side = tx.type === 'crypto_sell' ? 'Sell' : 'Buy'
  const amount =
    typeof tx.metadata?.cryptoAmount === 'number' && Number.isFinite(tx.metadata.cryptoAmount)
      ? formatCryptoQuantity(tx.metadata.cryptoAmount)
      : null
  const symbol =
    cryptoAsset?.symbol
    || (typeof tx.metadata?.symbol === 'string' ? tx.metadata.symbol : '')

  const amountLabel = amount && symbol ? `${amount} ${symbol}` : ''
  const providerLabel = ''

  return `${side}${providerLabel}${amountLabel ? ` ${amountLabel}` : ''}`
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

function buildReceiptShareText(detail: {
  transaction: Transaction
  cryptoOrder: CryptoOrder | null
}, cryptoAsset?: { symbol?: string; network?: string }) {
  return [
    'MafitaPay Receipt',
    formatHistoryTitle(detail.transaction, cryptoAsset),
    `Amount: ${formatNGN(detail.transaction.amount)}`,
    `Status: ${detail.transaction.status}`,
    `Reference: ${detail.transaction.reference}`,
    `Date: ${fmtDate(detail.transaction.createdAt)}`,
  ].join('\n')
}

export default function HistoryPage() {
  const { refreshSession, showToast, transactions } = useAppStore()
  const cryptoAssets = useCryptoAssets()
  const [filter, setFilter] = useState('All')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [exportingReceipt, setExportingReceipt] = useState(false)
  const [detail, setDetail] = useState<{
    transaction: Transaction
    cryptoOrder: CryptoOrder | null
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

  function closeDetail() {
    setSelectedId(null)
    setDetail(null)
    setLoadingDetail(false)
  }

  async function shareReceipt() {
    if (!detail) return
    const pairId = typeof detail.transaction.metadata?.pairId === 'string' ? detail.transaction.metadata.pairId : ''
    const cryptoAsset = pairId ? cryptoAssets.find(asset => asset.id === pairId) : undefined
    const text = buildReceiptShareText(detail, cryptoAsset)

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: 'MafitaPay Receipt',
          text,
        })
        return
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        showToast('Receipt summary copied.')
        return
      }

      showToast('Sharing is not available on this device.', 'error')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      showToast(error instanceof Error ? error.message : 'Failed to share receipt.', 'error')
    }
  }

  async function shareReceiptImage() {
    if (!detail) return
    const receiptElement = document.getElementById('history-receipt-sheet')
    if (!receiptElement) {
      showToast('Receipt is not ready yet.', 'error')
      return
    }

    setExportingReceipt(true)
    try {
      const blob = await toBlob(receiptElement, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#f6efdd',
      })
      if (!blob) throw new Error('Failed to render receipt image.')

      const fileName = `${detail.transaction.reference}.png`
      const file = new File([blob], fileName, { type: 'image/png' })

      if (
        typeof navigator !== 'undefined'
        && typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: 'MafitaPay Receipt',
          files: [file],
        })
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
      showToast('Receipt image downloaded.')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      showToast(error instanceof Error ? error.message : 'Failed to share receipt image.', 'error')
    } finally {
      setExportingReceipt(false)
    }
  }

  async function downloadReceiptImage() {
    if (!detail) return
    const receiptElement = document.getElementById('history-receipt-sheet')
    if (!receiptElement) {
      showToast('Receipt is not ready yet.', 'error')
      return
    }

    setExportingReceipt(true)
    try {
      const dataUrl = await toPng(receiptElement, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#f6efdd',
      })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `${detail.transaction.reference}.png`
      link.click()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to download receipt image.', 'error')
    } finally {
      setExportingReceipt(false)
    }
  }

  function downloadReceipt() {
    if (!detail) return
    const receiptElement = document.getElementById('history-receipt-sheet')
    if (!receiptElement) {
      showToast('Receipt is not ready yet.', 'error')
      return
    }

    const popup = window.open('', '_blank', 'noopener,noreferrer,width=720,height=900')
    if (!popup) {
      showToast('Popup was blocked. Allow popups to download the receipt.', 'error')
      return
    }

    popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>MafitaPay Receipt</title>
    <style>
      body { margin: 0; padding: 24px; background: #f5efe2; font-family: Arial, sans-serif; color: #2c2418; }
      .receipt-shell { max-width: 720px; margin: 0 auto; }
      @media print {
        body { padding: 0; background: #fff; }
        .receipt-shell { max-width: none; }
      }
    </style>
  </head>
  <body>
    <div class="receipt-shell">${receiptElement.outerHTML}</div>
  </body>
</html>`)
    popup.document.close()
    popup.focus()
    popup.print()
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
                {['','Description','Date & Time','Reference','Status','Amount','Actions'].map((h,i) => (
                  <th key={i} className={`px-4 py-3 text-left text-[8px] font-bold uppercase tracking-[1.3px] text-[var(--muted)] border-b border-[var(--border)] bg-[var(--clay)] ${i===5?'text-right':''}`}>{h}</th>
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
                      <div className="text-[13px] font-semibold text-[var(--text)]">{formatHistoryTitle(tx, cryptoAsset)}</div>
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
      <Card className="hidden overflow-hidden p-0 xl:block">
        <div className="mx-auto w-full max-w-2xl xl:max-w-none">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--clay)] px-5 py-4 text-[11px] font-bold text-[var(--text)]">
          <span>Transaction Detail</span>
        </div>
        {!selectedId ? (
          <div className="p-5 text-[11px] text-[var(--muted)]">Select a transaction to inspect its settlement summary.</div>
        ) : loadingDetail ? (
          <div className="p-5 text-[11px] text-[var(--muted)]">Loading detail…</div>
        ) : !detail ? (
          <div className="p-5 text-[11px] text-[var(--muted)]">No detail available.</div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => void shareReceiptImage()} disabled={exportingReceipt}>
                {exportingReceipt ? 'Preparing…' : 'Share Image'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void downloadReceiptImage()} disabled={exportingReceipt}>
                PNG
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void shareReceipt()}>
                Share
              </Button>
              <Button size="sm" variant="secondary" onClick={downloadReceipt}>
                PDF
              </Button>
            </div>
            <div
              id="history-receipt-sheet"
              className="relative mt-3 overflow-hidden border border-[rgba(202,165,96,.26)] bg-[linear-gradient(180deg,#fcf7ec_0%,#f6efdd_100%)] p-5 text-[#2c2418] shadow-[0_18px_40px_rgba(0,0,0,.18)]"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-[-2.5rem] w-40 bg-center bg-no-repeat opacity-[0.07]"
                style={{ backgroundImage: "url('/mafitapay-logo.jpg')", backgroundSize: 'contain' }}
              />
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(90deg,rgba(202,165,96,.55)_0_16px,transparent_16px_24px)]" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[2px] text-[#8c6b31]">MafitaPay Receipt</div>
                    <div className="mt-2 text-[18px] font-bold text-[#1f1a12]">
                      {formatHistoryTitle(detail.transaction, typeof detail.transaction.metadata?.pairId === 'string'
                        ? cryptoAssets.find(asset => asset.id === detail.transaction.metadata?.pairId)
                        : undefined)}
                    </div>
                    <div className="mt-1 text-[11px] font-mono text-[#7c6a4b]">{detail.transaction.reference}</div>
                  </div>
                  <div className="rounded-full border border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.7)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[1px] text-[#8c6b31]">
                    Official Copy
                  </div>
                </div>

                <div className="mt-5 border-y border-dashed border-[rgba(140,107,49,.3)] py-4">
                  <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#8c6b31]">Amount</div>
                  <div className={`mt-1 text-[28px] font-black tracking-[-0.02em] ${detail.transaction.amount > 0 ? 'text-[#227a45]' : 'text-[#1f1a12]'}`}>
                    {detail.transaction.amount > 0 ? '+' : ''}{formatNGN(detail.transaction.amount)}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-3">
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Recorded</div>
                    <div className="mt-1 text-[11px] font-mono text-[#3a3123]">{fmtDate(detail.transaction.createdAt)}</div>
                  </div>
                  <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-3">
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Status</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="pending">{detail.transaction.type.replace(/_/g, ' ')}</Badge>
                      <Badge variant={detail.transaction.status === 'success' ? 'success' : detail.transaction.status === 'failed' ? 'failed' : 'pending'}>
                        {detail.transaction.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {(detail.transaction.recipient || detail.transaction.narration) && (
              <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                <div className="grid gap-3">
                  {detail.transaction.recipient && (
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recipient</div>
                      <div className="mt-1 text-[11px] text-[var(--text)]">{detail.transaction.recipient}</div>
                    </div>
                  )}
                  {detail.transaction.narration && (
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Narration</div>
                      <div className="mt-1 text-[11px] text-[var(--text)]">{detail.transaction.narration}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {detail.timeline.length > 1 && (
            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Timeline</div>
              <div className="grid gap-2">
                {detail.timeline.map((item, index) => (
                  <div key={`${item.label}-${index}`} className="flex items-center justify-between gap-3 border border-[var(--border)] bg-[var(--clay)] p-3">
                    <div className="text-[11px] font-bold text-[var(--text)]">{item.label}</div>
                    <div className="text-[10px] text-[var(--muted)]">{fmtDate(item.at)}</div>
                  </div>
                ))}
              </div>
            </div>
            )}

            {(detail.depositIntent || detail.payoutRequest) && (
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Settlement Record</div>
                <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                  {detail.depositIntent ? (
                    <>
                      <div>Deposit intent · {detail.depositIntent.status.toUpperCase()}</div>
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
                      <div className="border border-[var(--border)] bg-[rgba(79,70,229,.06)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Execution</div>
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
                        <div className="mt-3 space-y-1">
                          <div>Wallet: <span className="font-mono text-[var(--text)]">{detail.cryptoOrder.walletAddress ? compactHash(detail.cryptoOrder.walletAddress, 10, 8) : detail.cryptoOrder.destinationLabel || detail.cryptoOrder.destinationType || 'Wallet delivery'}</span></div>
                          {detail.cryptoOrder.destinationTxHash && (
                            <div>Tx: <span className="font-mono text-[var(--text)]">{compactHash(detail.cryptoOrder.destinationTxHash)}</span></div>
                          )}
                          <div>Rate: <span className="text-[var(--text)]">{formatNGN(detail.cryptoOrder.unitRate)}</span></div>
                          {(detail.cryptoOrder.exchange || detail.cryptoOrder.executionStatus) && (
                            <div>
                              {detail.cryptoOrder.executionStatus ? `Status: ${detail.cryptoOrder.executionStatus}` : 'Execution in progress'}
                              {detail.cryptoOrder.exchange ? ` · Route: ${detail.cryptoOrder.exchange}` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}
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
                  {typeof detail.transaction.metadata?.platformFee === 'number' && Number(detail.transaction.metadata.platformFee) > 0 && (
                    <div className="mt-1">Platform fee: {formatNGN(Number(detail.transaction.metadata.platformFee))}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </Card>
      </div>
      {selectedId && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(10,12,24,.92)] p-3 xl:hidden">
          <Card className="mx-auto min-h-full w-full max-w-2xl overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--clay)] px-5 py-4 text-[11px] font-bold text-[var(--text)]">
              <span>Transaction Detail</span>
              <button
                type="button"
                onClick={closeDetail}
                className="inline-flex h-8 items-center justify-center border border-[var(--border)] px-3 text-[10px] font-bold uppercase tracking-[1px] text-[var(--text2)]"
              >
                Close
              </button>
            </div>
            {loadingDetail ? (
              <div className="p-5 text-[11px] text-[var(--muted)]">Loading detail…</div>
            ) : !detail ? (
              <div className="p-5 text-[11px] text-[var(--muted)]">No detail available.</div>
            ) : (
              <div className="space-y-4 p-4">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void shareReceiptImage()} disabled={exportingReceipt}>
                    {exportingReceipt ? 'Preparing…' : 'Share Image'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void downloadReceiptImage()} disabled={exportingReceipt}>
                    PNG
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void shareReceipt()}>
                    Share
                  </Button>
                  <Button size="sm" variant="secondary" onClick={downloadReceipt}>
                    PDF
                  </Button>
                </div>
                <div
                  id="history-receipt-sheet"
                  className="relative mt-3 overflow-hidden border border-[rgba(202,165,96,.26)] bg-[linear-gradient(180deg,#fcf7ec_0%,#f6efdd_100%)] p-5 text-[#2c2418] shadow-[0_18px_40px_rgba(0,0,0,.18)]"
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 right-[-2.5rem] w-40 bg-center bg-no-repeat opacity-[0.07]"
                    style={{ backgroundImage: "url('/mafitapay-logo.jpg')", backgroundSize: 'contain' }}
                  />
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(90deg,rgba(202,165,96,.55)_0_16px,transparent_16px_24px)]" />
                  <div className="relative">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[2px] text-[#8c6b31]">MafitaPay Receipt</div>
                        <div className="mt-2 text-[18px] font-bold text-[#1f1a12]">
                          {formatHistoryTitle(detail.transaction, typeof detail.transaction.metadata?.pairId === 'string'
                            ? cryptoAssets.find(asset => asset.id === detail.transaction.metadata?.pairId)
                            : undefined)}
                        </div>
                        <div className="mt-1 text-[11px] font-mono text-[#7c6a4b]">{detail.transaction.reference}</div>
                      </div>
                      <div className="rounded-full border border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.7)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[1px] text-[#8c6b31]">
                        Official Copy
                      </div>
                    </div>

                    <div className="mt-5 border-y border-dashed border-[rgba(140,107,49,.3)] py-4">
                      <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#8c6b31]">Amount</div>
                      <div className={`mt-1 text-[28px] font-black tracking-[-0.02em] ${detail.transaction.amount > 0 ? 'text-[#227a45]' : 'text-[#1f1a12]'}`}>
                        {detail.transaction.amount > 0 ? '+' : ''}{formatNGN(detail.transaction.amount)}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-3">
                        <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Recorded</div>
                        <div className="mt-1 text-[11px] font-mono text-[#3a3123]">{fmtDate(detail.transaction.createdAt)}</div>
                      </div>
                      <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-3">
                        <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Status</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="pending">{detail.transaction.type.replace(/_/g, ' ')}</Badge>
                          <Badge variant={detail.transaction.status === 'success' ? 'success' : detail.transaction.status === 'failed' ? 'failed' : 'pending'}>
                            {detail.transaction.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {(detail.transaction.recipient || detail.transaction.narration) && (
                  <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                    <div className="grid gap-3">
                      {detail.transaction.recipient && (
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recipient</div>
                          <div className="mt-1 text-[11px] text-[var(--text)]">{detail.transaction.recipient}</div>
                        </div>
                      )}
                      {detail.transaction.narration && (
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Narration</div>
                          <div className="mt-1 text-[11px] text-[var(--text)]">{detail.transaction.narration}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {detail.timeline.length > 1 && (
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Timeline</div>
                    <div className="grid gap-2">
                      {detail.timeline.map((item, index) => (
                        <div key={`${item.label}-${index}`} className="flex items-center justify-between gap-3 border border-[var(--border)] bg-[var(--clay)] p-3">
                          <div className="text-[11px] font-bold text-[var(--text)]">{item.label}</div>
                          <div className="text-[10px] text-[var(--muted)]">{fmtDate(item.at)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(detail.depositIntent || detail.payoutRequest) && (
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Settlement Record</div>
                    <div className="border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--text2)]">
                      {detail.depositIntent ? (
                        <>
                          <div>Deposit intent · {detail.depositIntent.status.toUpperCase()}</div>
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
                          {detail.payoutRequest.beneficiary && <div className="mt-1">Beneficiary: {detail.payoutRequest.beneficiary}</div>}
                          {detail.payoutRequest.lastSyncAt && <div className="mt-1">Last sync: {fmtDate(detail.payoutRequest.lastSyncAt)}{detail.payoutRequest.lastSyncStatus ? ` · ${detail.payoutRequest.lastSyncStatus}` : ''}</div>}
                          {detail.payoutRequest.failureReason && <div className="mt-1 text-[var(--red2)]">Failure: {detail.payoutRequest.failureReason}</div>}
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
