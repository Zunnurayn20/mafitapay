'use client'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets, useCryptoAssetsRefreshing } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { formatNGN, formatPercentChange, formatUSDAdaptive, fmtDate } from '@/lib/utils'

export default function CryptoPage() {
  const { openModal, setModalData, transactions } = useAppStore()
  const assets = useCryptoAssets()
  const refreshingAssets = useCryptoAssetsRefreshing()
  const cryptoTxs = transactions.filter(tx => tx.type.startsWith('crypto'))
  const shouldMaskStaleSnapshot = refreshingAssets && assets.some(asset => asset.pricingSource !== 'live')
  const formatMarketUsd = (marketPriceUsd: number | undefined, pricingSource?: 'live' | 'backup' | 'safe') => {
    if (shouldMaskStaleSnapshot && pricingSource !== 'live') return 'Refreshing…'
    if ((!marketPriceUsd || marketPriceUsd <= 0) || pricingSource === 'safe') return 'Live unavailable'
    return formatUSDAdaptive(marketPriceUsd)
  }
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {assets.map(a => (
              <div key={a.id}>
                <div className="text-[9px] text-[var(--muted)]">{a.symbol} · {a.network}</div>
                <div className="text-[16px] font-bold font-mono text-[var(--text)]">
                  {formatMarketUsd(a.marketPriceUsd, a.pricingSource)}
                </div>
                <div className="flex items-center gap-2">
                  <div className={`text-[9px] ${a.change24h >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                    {a.change24h >= 0 ? '▲' : '▼'} {formatPercentChange(a.change24h)} 24h
                  </div>
                  <div className={`text-[8px] ${a.refreshDirection === 'up' ? 'text-[var(--green2)]' : a.refreshDirection === 'down' ? 'text-[var(--red2)]' : 'text-[var(--muted)]'}`}>
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
          {assets.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] last:border-0 hover:bg-[var(--clay)] transition-colors cursor-pointer" onClick={() => { setModalData({ cryptoAsset: a, cryptoPairId: a.id }); openModal('buy') }}>
              <AssetLogo
                src={a.icon}
                alt={`${a.symbol} logo`}
                fallback={a.symbol.slice(0, 1)}
                className="h-14 w-14 flex items-center justify-center flex-shrink-0 overflow-hidden"
                imgClassName="h-12 w-12 object-contain"
                textClassName="font-display font-bold text-2xl text-[var(--gold2)]"
              />
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[var(--text)]">{a.name} ({a.symbol})</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div className="text-[9px] text-[var(--muted)]">{a.network}</div>
                  <div className={`border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[.8px] ${shouldMaskStaleSnapshot && a.pricingSource !== 'live' ? 'border-[rgba(99,102,241,.25)] bg-[rgba(79,70,229,.08)] text-[var(--gold2)]' : a.pricingSource === 'live' ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]' : a.pricingSource === 'backup' ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]' : 'border-[rgba(220,38,38,.25)] bg-[rgba(220,38,38,.08)] text-[var(--red2)]'}`}>
                    {shouldMaskStaleSnapshot && a.pricingSource !== 'live' ? 'Refreshing' : a.pricingSource === 'live' ? 'Live' : a.pricingSource === 'backup' ? 'Cached' : 'Unavailable'}
                  </div>
                </div>
              </div>
              <div className="text-right mr-4">
                <div className="text-[8px] text-[var(--muted)] uppercase tracking-[.8px]">Market Price</div>
                <div className="text-[13px] font-bold font-mono text-[var(--text)]">
                  {formatMarketUsd(a.marketPriceUsd, a.pricingSource)}
                </div>
                <div className="mt-1 text-[8px] text-[var(--muted)]">
                  Buy rate: {formatNGN(a.buyRate)}
                </div>
              </div>
              <div className="mr-3 text-right">
                <div className={`text-[9px] ${a.change24h >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                  {a.change24h >= 0 ? '▲' : '▼'} {formatPercentChange(a.change24h)}
                </div>
                <div className={`mt-1 text-[8px] ${a.refreshDirection === 'up' ? 'text-[var(--green2)]' : a.refreshDirection === 'down' ? 'text-[var(--red2)]' : 'text-[var(--muted)]'}`}>
                  {a.refreshDirection === 'up' ? '↗' : a.refreshDirection === 'down' ? '↘' : '•'}
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); setModalData({ cryptoAsset: a, cryptoPairId: a.id }); openModal('buy') }}
                className="px-3 py-1.5 text-[9px] font-bold uppercase bg-[var(--gold)] text-white hover:bg-[var(--terra2)] transition-colors flex-shrink-0">
                Trade
              </button>
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
            <div key={tx.id} className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] last:border-0">
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
                <div className="text-[13px] font-semibold text-[var(--text)]">{tx.description}</div>
                <div className="text-[9px] text-[var(--muted)] font-mono">{fmtDate(tx.createdAt)}</div>
              </div>
              <div className={`text-[13px] font-bold font-mono ${tx.amount > 0 ? 'text-[var(--green2)]' : 'text-[var(--text2)]'}`}>
                {tx.amount > 0 ? '+' : ''}{formatNGN(tx.amount)}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
