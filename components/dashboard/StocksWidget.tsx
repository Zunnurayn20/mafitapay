'use client'
import { useRouter } from 'next/navigation'
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/Card'
import { StockLogo } from '@/components/ui/StockLogo'
import { useStocksMarket } from '@/lib/client/catalogs'
import { isHalalStock } from '@/lib/stock-filters'
import { formatNGN, formatPercentChange, formatRelativeSyncTime } from '@/lib/utils'

export function StocksWidget() {
  const router = useRouter()
  const { stocks, summary, source } = useStocksMarket()
  const topMovers = [...stocks]
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 4)

  return (
    <Card pattern="soft">
      <CardHeader>
        <CardTitle>NGX Stocks</CardTitle>
        <CardAction onClick={() => router.push('/stocks')}>Market →</CardAction>
      </CardHeader>
      <div className="border-b border-[var(--border)] px-5 py-3">
        <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{summary.indexName}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <div className="font-display text-[18px] font-black text-[var(--text)]">
            {summary.indexValue.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
          </div>
          <div className={`text-[10px] font-bold ${summary.changePercent >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
            {summary.changePercent >= 0 ? '▲' : '▼'} {formatPercentChange(summary.changePercent)}
          </div>
        </div>
        <div className="mt-1 text-[9px] text-[var(--muted)]">
          {source === 'live' ? 'Live NGX prices' : source === 'stale' ? 'Cached NGX prices' : 'Demo prices'}
          {' · '}
          {formatRelativeSyncTime(summary.lastUpdated)}
        </div>
      </div>
      {topMovers.map(stock => (
        <button
          key={stock.id}
          type="button"
          onClick={() => router.push('/stocks')}
          className="flex w-full items-center gap-3 border-b border-[var(--border)] px-5 py-3.5 text-left transition-colors last:border-0 hover:bg-[var(--clay)]"
        >
          <StockLogo symbol={stock.symbol} name={stock.name} logoUrl={stock.logoUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-[var(--text)]">{stock.symbol}</div>
            <div className="truncate text-[9px] text-[var(--muted)]">
              {stock.sector}
              {isHalalStock(stock) ? ' · Halal' : ''}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px] text-[var(--text)]">{formatNGN(stock.priceNgn)}</div>
            <div className={`text-[9px] ${stock.changePercent >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
              {formatPercentChange(stock.changePercent)}
            </div>
          </div>
        </button>
      ))}
    </Card>
  )
}