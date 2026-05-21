'use client'
import { useState } from 'react'
import { toBlob, toPng } from 'html-to-image'
import { useAppStore } from '@/store'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardAction } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { Modal } from '@/components/ui/Modal'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { TransactionReceiptSheet } from '@/components/transactions/TransactionReceiptSheet'
import { fmtDate, formatNGN } from '@/lib/utils'
import type { CryptoOrder, DepositIntent, PayoutRequest, Transaction } from '@/types'

function formatCryptoQuantity(value: number) {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1) return value.toFixed(4).replace(/\.?0+$/, '')
  return value.toFixed(5).replace(/\.?0+$/, '')
}

function formatTransactionTitle(tx: Transaction, cryptoAsset?: { symbol?: string }) {
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

function getStatusIcon(status: Transaction['status']) {
  if (status === 'success') {
    return {
      icon: '✓',
      className: 'border-[var(--green)] bg-[var(--green)] text-white',
    }
  }

  if (status === 'failed') {
    return {
      icon: '✕',
      className: 'border-[var(--red2)] bg-[var(--red2)] text-white',
    }
  }

  return {
    icon: '•',
    className: 'border-[var(--gold)] bg-[var(--gold)] text-[var(--char)]',
  }
}

export function RecentTransactions() {
  const { transactions, showToast } = useAppStore()
  const router = useRouter()
  const cryptoAssets = useCryptoAssets()
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
  const recent = transactions.slice(0, 5)

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
      setSelectedId(null)
      setDetail(null)
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

  async function shareReceiptImage() {
    if (!detail) return
    const receiptElement = document.getElementById('dashboard-receipt-sheet')
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
    const receiptElement = document.getElementById('dashboard-receipt-sheet')
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

  function downloadReceiptPdf() {
    if (!detail) return
    const receiptElement = document.getElementById('dashboard-receipt-sheet')
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
    <>
      <Card pattern="soft">
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardAction onClick={() => router.push('/history')}>View All →</CardAction>
        </CardHeader>
        <div className="divide-y divide-[var(--border)]">
          {recent.map(tx => {
            const icon = 'icon' in tx && typeof tx.icon === 'string' ? tx.icon : '•'
            const pairId = typeof tx.metadata?.pairId === 'string' ? tx.metadata.pairId : ''
            const cryptoAsset = pairId ? cryptoAssets.find(asset => asset.id === pairId) : undefined
            const statusIcon = getStatusIcon(tx.status)

            return (
              <button
                key={tx.id}
                type="button"
                onClick={() => void openDetail(tx.id)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[rgba(26,26,46,.6)]"
              >
                <div className="w-8 flex-shrink-0">
                  {cryptoAsset ? (
                    <AssetLogo
                      src={cryptoAsset.icon}
                      alt={`${cryptoAsset.symbol} logo`}
                      fallback={cryptoAsset.symbol.slice(0, 1)}
                      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[rgba(79,70,229,.1)]"
                      imgClassName="h-5 w-5 object-contain"
                      textClassName="text-[15px] font-bold text-[var(--gold2)]"
                    />
                  ) : (
                    <div className="text-[18px]">{icon}</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-[13px] font-semibold text-[var(--text)]">{formatTransactionTitle(tx, cryptoAsset)}</div>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,.18)] ${statusIcon.className}`}>
                      {statusIcon.icon}
                    </span>
                  </div>
                  <div className="mt-1 text-[9px] font-mono text-[var(--muted)]">
                    {fmtDate(tx.createdAt)}
                  </div>
                </div>
                <div className={`text-right text-[13px] font-bold font-mono ${tx.amount > 0 ? 'text-[var(--green2)]' : 'text-[var(--text2)]'}`}>
                  {tx.amount > 0 ? '+' : ''}{formatNGN(tx.amount)}
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      <Modal
        open={Boolean(selectedId)}
        onClose={closeDetail}
        title={detail ? formatTransactionTitle(detail.transaction, (() => {
          const pairId = typeof detail.transaction.metadata?.pairId === 'string' ? detail.transaction.metadata.pairId : ''
          return pairId ? cryptoAssets.find(asset => asset.id === pairId) : undefined
        })()) : 'Transaction Detail'}
        subtitle={detail ? detail.transaction.reference : undefined}
        size="lg"
      >
        {loadingDetail && (
          <div className="p-8 text-center">
            <div className="spinner mx-auto mb-4" />
            <div className="text-[12px] text-[var(--text)]">Loading transaction detail…</div>
          </div>
        )}

        {!loadingDetail && detail && (
          <div className="space-y-4 p-6">
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => void shareReceiptImage()}>
                {exportingReceipt ? 'Preparing…' : 'Share Image'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void downloadReceiptImage()}>PNG</Button>
              <Button size="sm" variant="secondary" onClick={downloadReceiptPdf}>PDF</Button>
            </div>

            <TransactionReceiptSheet
              id="dashboard-receipt-sheet"
              transaction={detail.transaction}
              title={formatTransactionTitle(detail.transaction, (() => {
                const pairId = typeof detail.transaction.metadata?.pairId === 'string' ? detail.transaction.metadata.pairId : ''
                return pairId ? cryptoAssets.find(asset => asset.id === pairId) : undefined
              })())}
            />
          </div>
        )}
      </Modal>
    </>
  )
}
