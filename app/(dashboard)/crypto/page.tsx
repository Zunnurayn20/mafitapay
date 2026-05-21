'use client'
import { useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { useCryptoAssets, useCryptoAssetsRefreshing } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { formatNGN, formatPercentChange, formatUSDAdaptive, fmtDate } from '@/lib/utils'
import type { CryptoOrder, DepositIntent, PayoutRequest, Transaction } from '@/types'

function formatCryptoQuantity(value: number) {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1) return value.toFixed(4).replace(/\.?0+$/, '')
  return value.toFixed(5).replace(/\.?0+$/, '')
}

function formatTradeTitle(tx: Transaction) {
  const side = tx.type === 'crypto_sell' ? 'Sell' : 'Buy'
  const amount =
    typeof tx.metadata?.cryptoAmount === 'number' && Number.isFinite(tx.metadata.cryptoAmount)
      ? formatCryptoQuantity(tx.metadata.cryptoAmount)
      : null
  const symbol = typeof tx.metadata?.symbol === 'string' ? tx.metadata.symbol : ''
  const providerLabel = ''
  return `${side}${providerLabel}${amount && symbol ? ` ${amount} ${symbol}` : ''}`
}

function isStablecoin(symbol: string) {
  return new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'BUSD', 'USDE']).has(symbol.toUpperCase())
}

export default function CryptoPage() {
  const { openModal, setModalData, transactions } = useAppStore()
  const assets = useCryptoAssets()
  const refreshingAssets = useCryptoAssetsRefreshing()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detail, setDetail] = useState<{
    transaction: Transaction
    cryptoOrder: CryptoOrder | null
    depositIntent: DepositIntent | null
    payoutRequest: PayoutRequest | null
    timeline: Array<{ label: string; at: string; tone: string }>
  } | null>(null)
  const cryptoTxs = transactions.filter(tx => tx.type.startsWith('crypto'))
  const shouldMaskStaleSnapshot = refreshingAssets && assets.some(asset => asset.pricingSource !== 'live')
  const marketStripAssets = Array.from(
    assets.reduce((map, asset) => {
      const current = map.get(asset.symbol)
      if (!current) {
        map.set(asset.symbol, asset)
        return map
      }

      const currentRank =
        current.pricingSource === 'live' ? 3
        : current.pricingSource === 'backup' ? 2
        : 1
      const nextRank =
        asset.pricingSource === 'live' ? 3
        : asset.pricingSource === 'backup' ? 2
        : 1

      if (nextRank > currentRank) {
        map.set(asset.symbol, asset)
      }
      return map
    }, new Map<string, (typeof assets)[number]>()),
  ).map(([, asset]) => asset)
  const formatMarketUsd = (symbol: string, marketPriceUsd: number | undefined, pricingSource?: 'live' | 'backup' | 'safe') => {
    if (isStablecoin(symbol)) return '$1'
    if (shouldMaskStaleSnapshot && pricingSource !== 'live') return 'Refreshing…'
    if ((!marketPriceUsd || marketPriceUsd <= 0) || pricingSource === 'safe') return 'Live unavailable'
    return formatUSDAdaptive(marketPriceUsd)
  }
  const getDetailNetwork = () => {
    const network = detail?.transaction.metadata?.network
    return typeof network === 'string' && network.trim() ? network : 'Unknown'
  }

  async function openTradeDetail(id: string) {
    setSelectedId(id)
    setLoadingDetail(true)
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
        credentials: 'include',
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Failed to load transaction detail.')
      }
      setDetail(payload.data)
    } catch {
      setDetail(null)
      setSelectedId(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  function closeTradeDetail() {
    setSelectedId(null)
    setDetail(null)
    setLoadingDetail(false)
  }

  const showMarketSkeleton = assets.length === 0 && refreshingAssets
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border border-[var(--border)] bg-[var(--clay)] px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <div className="text-[8px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">Market Prices (USD)</div>
            {refreshingAssets && (
              <div className="border border-[rgba(46,170,92,.2)] bg-[rgba(46,170,92,.08)] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[.8px] text-[var(--green2)]">
                Refreshing Market…
              </div>
            )}
          </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
              {showMarketSkeleton ? Array.from({ length: 8 }).map((_, index) => (
                <div key={`market-skeleton-${index}`} className="space-y-1.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              )) : marketStripAssets.map(a => (
              <div key={a.id}>
                <div className="flex items-center gap-1.5">
                  <AssetLogo
                    src={a.icon}
                    alt={`${a.symbol} logo`}
                    fallback={a.symbol.slice(0, 1)}
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[rgba(255,255,255,.03)]"
                    imgClassName="h-4 w-4 object-contain"
                    textClassName="font-display text-[10px] font-bold text-[var(--gold2)]"
                  />
                  <div className="truncate text-[12px] font-bold font-mono text-[var(--text)]">
                    {formatMarketUsd(a.symbol, a.marketPriceUsd, a.pricingSource)}
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <div className={`truncate text-[8px] ${a.change24h >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                    {a.change24h >= 0 ? '▲' : '▼'} {formatPercentChange(a.change24h)}
                  </div>
                  <div className={`text-[7px] ${a.refreshDirection === 'up' ? 'text-[var(--green2)]' : a.refreshDirection === 'down' ? 'text-[var(--red2)]' : 'text-[var(--muted)]'}`}>
                    {a.refreshDirection === 'up' ? '↗' : a.refreshDirection === 'down' ? '↘' : '•'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openModal('buy')} size="sm">⬇ Buy Crypto</Button>
          <Button variant="secondary" onClick={() => openModal('sell')} size="sm">⬆ Sell Crypto</Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
            <div className="text-[8px] font-bold text-[var(--muted)] bg-[var(--clay)] border border-[var(--border)] px-2 py-1">Live when available</div>
          </CardHeader>
          {showMarketSkeleton ? Array.from({ length: 6 }).map((_, index) => (
            <div key={`asset-skeleton-${index}`} className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4 last:border-0">
              <Skeleton className="h-14 w-14 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="mr-4 space-y-2 text-right">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-8 w-16" />
            </div>
          )) : assets.map(a => (
            <div
              key={a.id}
              className="flex items-center gap-2.5 border-b border-[var(--border)] px-3 py-3 last:border-0 transition-colors hover:bg-[var(--clay)] sm:gap-3 sm:px-5 sm:py-4 cursor-pointer"
              onClick={() => { setModalData({ cryptoAsset: a, cryptoPairId: a.id }); openModal('buy') }}
            >
              <AssetLogo
                src={a.icon}
                alt={`${a.symbol} logo`}
                fallback={a.symbol.slice(0, 1)}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden sm:h-14 sm:w-14"
                imgClassName="h-9 w-9 object-contain sm:h-12 sm:w-12"
                textClassName="font-display text-xl font-bold text-[var(--gold2)] sm:text-2xl"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-bold text-[var(--gold2)] sm:text-[14px]">{a.name} ({a.symbol})</div>
                <div className="mt-0.5 truncate text-[8px] font-medium text-[var(--text2)] sm:mt-1 sm:text-[9px]">{a.network}</div>
              </div>
              <div className="min-w-0 text-right">
                <div className="truncate text-[11px] font-bold font-mono text-[var(--text)] sm:text-[13px]">
                  {formatMarketUsd(a.symbol, a.marketPriceUsd, a.pricingSource)}
                </div>
                <div className="mt-0.5 text-[8px] font-mono text-[var(--muted)] sm:mt-1">
                  {formatNGN(a.buyRate)}
                </div>
              </div>
              <div className="w-[3.2rem] flex-shrink-0 text-right sm:w-[3.75rem]">
                <div className={`text-[8px] sm:text-[9px] ${a.change24h >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                  {a.change24h >= 0 ? '▲' : '▼'} {formatPercentChange(a.change24h)}
                </div>
                <div className={`mt-0.5 text-[7px] sm:mt-1 sm:text-[8px] ${a.refreshDirection === 'up' ? 'text-[var(--green2)]' : a.refreshDirection === 'down' ? 'text-[var(--red2)]' : 'text-[var(--muted)]'}`}>
                  {a.refreshDirection === 'up' ? '↗' : a.refreshDirection === 'down' ? '↘' : '•'}
                </div>
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <CardHeader><CardTitle>Trade History</CardTitle></CardHeader>
        {cryptoTxs.length === 0 ? (
          <div className="py-14 text-center text-[var(--muted)] text-[12px]">
            <div className="text-[28px] mb-3">₿</div>
            No crypto trades yet. Buy or sell to get started.
          </div>
        ) : cryptoTxs.map(tx => (
            <button key={tx.id} type="button" onClick={() => void openTradeDetail(tx.id)} className="flex w-full items-center gap-3 px-5 py-4 border-b border-[var(--border)] last:border-0 text-left transition-colors hover:bg-[var(--clay)]">
              {(() => {
                const pairId = typeof tx.metadata?.pairId === 'string' ? tx.metadata.pairId : ''
                const asset = pairId ? assets.find(item => item.id === pairId) : undefined
                return asset ? (
                  <AssetLogo
                    src={asset.icon}
                    alt={`${asset.symbol} logo`}
                    fallback={asset.symbol.slice(0, 1)}
                    className="w-10 h-10 bg-[rgba(79,70,229,.1)] border border-[var(--border)] flex items-center justify-center flex-shrink-0 overflow-hidden"
                    imgClassName="h-7 w-7 object-contain"
                    textClassName="font-display font-bold text-lg text-[var(--gold2)]"
                  />
                ) : (
                  <div className="w-10 h-10 bg-[rgba(79,70,229,.1)] border border-[var(--border)] flex items-center justify-center font-display font-bold text-lg text-[var(--gold2)] flex-shrink-0">₿</div>
                )
              })()}
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[var(--text)]">{formatTradeTitle(tx)}</div>
                <div className="text-[9px] text-[var(--muted)] font-mono">{fmtDate(tx.createdAt)}</div>
              </div>
              <div className={`text-[13px] font-bold font-mono ${tx.amount > 0 ? 'text-[var(--green2)]' : 'text-[var(--text2)]'}`}>
                {tx.amount > 0 ? '+' : ''}{formatNGN(tx.amount)}
              </div>
            </button>
          ))}
        </Card>
      </div>

      <Modal
        open={Boolean(selectedId)}
        onClose={closeTradeDetail}
        title={detail ? formatTradeTitle(detail.transaction) : 'Trade Detail'}
        subtitle={detail ? detail.transaction.reference : undefined}
        size="lg"
        className="max-w-3xl"
      >
        {loadingDetail && (
          <div className="p-8 text-center">
            <div className="spinner mx-auto mb-4" />
            <div className="text-[12px] text-[var(--text)]">Loading trade detail…</div>
          </div>
        )}

        {!loadingDetail && detail && (
          <div className="p-6 space-y-4">
            <div className="relative overflow-hidden border border-[rgba(202,165,96,.26)] bg-[linear-gradient(180deg,#fcf7ec_0%,#f6efdd_100%)] p-5 text-[#2c2418] shadow-[0_18px_40px_rgba(0,0,0,.18)]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-[-2.5rem] w-40 bg-center bg-no-repeat opacity-[0.07]"
                style={{ backgroundImage: "url('/mafitapay-logo.jpg')", backgroundSize: 'contain' }}
              />
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(90deg,rgba(202,165,96,.55)_0_16px,transparent_16px_24px)]" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[2px] text-[#8c6b31]">MafitaPay Crypto Receipt</div>
                  <div className="mt-2 text-[22px] font-black text-[#1f1a12]">
                    {formatNGN(detail.transaction.amount)}
                  </div>
                  <div className="mt-2 text-[11px] font-mono text-[#7c6a4b]">{fmtDate(detail.transaction.createdAt)}</div>
                </div>
                <div className={`rounded-full border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.8px] ${
                  detail.transaction.status === 'success'
                    ? 'border-[rgba(34,122,69,.18)] bg-[rgba(255,255,255,.72)] text-[#227a45]'
                    : detail.transaction.status === 'failed'
                      ? 'border-[rgba(196,52,26,.18)] bg-[rgba(255,255,255,.72)] text-[#b54027]'
                      : 'border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.72)] text-[#8c6b31]'
                }`}>
                  {detail.transaction.status}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-4">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Reference</div>
                <div className="mt-2 text-[12px] font-mono text-[#7c5f2a]">{detail.transaction.reference}</div>
              </div>
              <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-4">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Wallet Address</div>
                <div className="mt-2 break-all text-[12px] font-mono text-[#3a3123]">
                  {detail.cryptoOrder?.walletAddress || 'Not available'}
                </div>
              </div>
            </div>

            {detail.cryptoOrder && (
              <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Asset</div>
                    <div className="mt-2 text-[12px] text-[#3a3123]">
                      {formatCryptoQuantity(detail.cryptoOrder.cryptoAmount)} {String(detail.cryptoOrder.pairId).split('_')[0]}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Rate</div>
                    <div className="mt-2 text-[12px] text-[#3a3123]">{formatNGN(detail.cryptoOrder.unitRate)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Network</div>
                    <div className="mt-2 text-[12px] text-[#3a3123]">{getDetailNetwork()}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Execution</div>
                    <div className="mt-2 text-[12px] text-[#3a3123]">{detail.cryptoOrder.executionStatus || 'Pending'}</div>
                  </div>
                </div>
                {detail.cryptoOrder.destinationTxHash && (
                  <div className="mt-4">
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Destination Tx</div>
                    <div className="mt-2 break-all text-[12px] font-mono text-[#7c5f2a]">{detail.cryptoOrder.destinationTxHash}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
