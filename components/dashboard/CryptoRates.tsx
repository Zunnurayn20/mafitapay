'use client'
import { useAppStore } from '@/store'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardAction } from '@/components/ui/Card'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { formatNGN, formatPercentChange, formatUSDAdaptive } from '@/lib/utils'

export function CryptoRates() {
  const { openModal, setModalData } = useAppStore()
  const assets = useCryptoAssets()
  const router = useRouter()
  const formatMarketUsd = (marketPriceUsd: number | undefined, pricingSource?: 'live' | 'backup' | 'safe') => {
    if ((!marketPriceUsd || marketPriceUsd <= 0) || pricingSource === 'safe') return 'Live unavailable'
    return formatUSDAdaptive(marketPriceUsd)
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Crypto Assets</CardTitle>
        <CardAction onClick={() => router.push('/crypto')}>Trade →</CardAction>
      </CardHeader>
      {assets.map(a => (
        <div key={a.id} onClick={() => { setModalData({ cryptoAsset: a, cryptoPairId: a.id }); openModal('buy') }}
          className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--border)] last:border-0 cursor-pointer hover:bg-[var(--clay)] transition-colors">
          <AssetLogo
            src={a.icon}
            alt={`${a.symbol} logo`}
            fallback={a.symbol.slice(0, 1)}
            className="w-9 h-9 bg-[rgba(79,70,229,.1)] border border-[var(--border)] flex items-center justify-center flex-shrink-0 overflow-hidden"
            imgClassName="h-6 w-6 object-contain"
            textClassName="font-display font-bold text-[17px] text-[var(--gold2)]"
          />
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-[var(--text)]">{a.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <div className="text-[9px] text-[var(--muted)]">{a.symbol} · {a.network}</div>
              <div className={`border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[.8px] ${a.pricingSource === 'live' ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]' : a.pricingSource === 'backup' ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]' : 'border-[rgba(220,38,38,.25)] bg-[rgba(220,38,38,.08)] text-[var(--red2)]'}`}>
                {a.pricingSource === 'live' ? 'Live' : a.pricingSource === 'backup' ? 'Cached' : 'Unavailable'}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[13px] font-bold font-mono text-[var(--text2)]">
              {formatMarketUsd(a.marketPriceUsd, a.pricingSource)}
            </div>
            <div className="mt-1 text-[8px] text-[var(--muted)]">
              Buy: {formatNGN(a.buyRate)}
            </div>
            <div className="flex items-center justify-end gap-2">
              <div className={`text-[9px] ${a.change24h >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                {a.change24h >= 0 ? '▲' : '▼'} {formatPercentChange(a.change24h)}
              </div>
              <div className={`text-[8px] ${a.refreshDirection === 'up' ? 'text-[var(--green2)]' : a.refreshDirection === 'down' ? 'text-[var(--red2)]' : 'text-[var(--muted)]'}`}>
                {a.refreshDirection === 'up' ? '↗' : a.refreshDirection === 'down' ? '↘' : '•'}
              </div>
            </div>
          </div>
        </div>
      ))}
    </Card>
  )
}
