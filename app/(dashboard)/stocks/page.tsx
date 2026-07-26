'use client'
import { useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { StockLogo } from '@/components/ui/StockLogo'
import { useStocksMarket } from '@/lib/client/catalogs'
import {
  STOCK_LIST_FILTERS,
  STOCK_SORT_OPTIONS,
  collectStockSectors,
  filterStocks,
  isHalalStock,
  sortStocks,
  type StockListFilter,
  type StockSortKey,
} from '@/lib/stock-filters'
import { formatNGN, formatPercentChange, formatRelativeSyncTime } from '@/lib/utils'
import type { StocksMarketSource, StockQuote } from '@/types'

function sourceLabel(source: StocksMarketSource) {
  if (source === 'live') return 'Live NGX prices'
  if (source === 'stale') return 'Cached NGX prices'
  return 'Demo prices'
}

function formatCompactNgn(value?: number) {
  if (!value || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function StockRow({ stock }: { stock: StockQuote }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4 transition-colors last:border-0 hover:bg-[var(--clay)]">
      <StockLogo symbol={stock.symbol} name={stock.name} logoUrl={stock.logoUrl} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold text-[var(--text)]">{stock.symbol}</div>
        <div className="truncate text-[10px] text-[var(--muted)]">{stock.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[8px] uppercase tracking-[1px] text-[var(--text2)]">{stock.sector}</span>
          {isHalalStock(stock) && (
            <span className="border border-[rgba(34,197,94,.28)] bg-[rgba(34,197,94,.08)] px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-[1px] text-[var(--green2)]">
              Halal
            </span>
          )}
        </div>
      </div>
      <div className="hidden text-right sm:block">
        <div className="text-[8px] uppercase tracking-[1px] text-[var(--muted)]">Volume</div>
        <div className="font-mono text-[10px] text-[var(--text2)]">{stock.volume?.toLocaleString('en-NG') ?? '—'}</div>
      </div>
      <div className="hidden text-right md:block">
        <div className="text-[8px] uppercase tracking-[1px] text-[var(--muted)]">Mkt Cap</div>
        <div className="font-mono text-[10px] text-[var(--text2)]">{formatCompactNgn(stock.marketCapNgn)}</div>
      </div>
      <div className="text-right">
        <div className="font-mono text-[12px] font-bold text-[var(--text)]">{formatNGN(stock.priceNgn)}</div>
        <div className={`text-[10px] font-bold ${stock.changePercent >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
          {stock.changePercent >= 0 ? '▲' : '▼'} {formatPercentChange(stock.changePercent)}
        </div>
      </div>
    </div>
  )
}

export default function StocksPage() {
  const { stocks, summary, source } = useStocksMarket()
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('all')
  const [listFilter, setListFilter] = useState<StockListFilter>('all')
  const [sortKey, setSortKey] = useState<StockSortKey>('market_cap')

  const sectors = useMemo(() => collectStockSectors(stocks), [stocks])

  const filtered = useMemo(() => {
    const rows = filterStocks(stocks, { search, sector, listFilter })
    return sortStocks(rows, sortKey)
  }, [search, sector, listFilter, sortKey, stocks])

  const gainers = useMemo(
    () => [...stocks].sort((a, b) => b.changePercent - a.changePercent).slice(0, 3),
    [stocks],
  )
  const losers = useMemo(
    () => [...stocks].sort((a, b) => a.changePercent - b.changePercent).slice(0, 3),
    [stocks],
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <Card className="p-5">
          <div className="text-[8px] font-bold uppercase tracking-[1.4px] text-[var(--muted)]">Nigerian Exchange</div>
          <div className="mt-2 font-display text-[30px] font-black leading-none text-[var(--text)]">
            {summary.indexValue.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className={`text-[12px] font-bold ${summary.changePercent >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
              {summary.changePercent >= 0 ? '▲' : '▼'} {formatPercentChange(summary.changePercent)} today
            </div>
            <div className="border border-[rgba(202,165,96,.28)] bg-[rgba(202,165,96,.08)] px-2 py-1 text-[8px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">
              Watch Only
            </div>
            <div className={`px-2 py-1 text-[8px] font-bold uppercase tracking-[1px] ${
              source === 'live'
                ? 'border border-[rgba(34,197,94,.28)] bg-[rgba(34,197,94,.08)] text-[var(--green2)]'
                : 'border border-[var(--border)] bg-[var(--clay)] text-[var(--muted)]'
            }`}>
              {sourceLabel(source)}
            </div>
          </div>
          <div className="mt-3 text-[11px] leading-relaxed text-[var(--text2)]">
            Track NGX-listed stocks in one place. Trading and investing will be added in a later release.
          </div>
          <div className="mt-2 text-[10px] text-[var(--muted)]">
            {formatRelativeSyncTime(summary.lastUpdated)}
            {summary.listedCount ? ` · ${summary.listedCount} listed securities` : ''}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Market Snapshot</div>
          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted)]">Exchange</span>
              <span className="font-bold text-[var(--text)]">{summary.exchange}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted)]">Listed stocks</span>
              <span className="font-bold text-[var(--text)]">{summary.listedCount ?? stocks.length}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--muted)]">Mode</span>
              <span className="font-bold text-[var(--gold2)]">Watch-only</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Gainers</CardTitle>
          </CardHeader>
          {gainers.map(stock => <StockRow key={`gain-${stock.id}`} stock={stock} />)}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Losers</CardTitle>
          </CardHeader>
          {losers.map(stock => <StockRow key={`loss-${stock.id}`} stock={stock} />)}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All NGX Stocks</CardTitle>
          <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Prices for monitoring only</div>
        </CardHeader>
        <div className="space-y-3 border-b border-[var(--border)] px-5 py-4">
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search symbol, company, sector, halal..."
            className="w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
          />

          <div className="flex flex-wrap gap-2">
            {STOCK_LIST_FILTERS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setListFilter(item.id)}
                className={[
                  'px-3 py-1.5 text-[10px] font-bold border transition-all',
                  listFilter === item.id
                    ? 'border-[var(--gold)] text-[var(--gold2)] bg-[rgba(79,70,229,.08)]'
                    : 'border-[var(--border)] text-[var(--text2)] bg-[var(--clay)] hover:border-[var(--border2)]',
                ].join(' ')}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              value={sector}
              onChange={event => setSector(event.target.value)}
              className="flex-1 border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
            >
              <option value="all">All sectors</option>
              {sectors.map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={event => setSortKey(event.target.value as StockSortKey)}
              className="flex-1 border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
            >
              {STOCK_SORT_OPTIONS.map(item => (
                <option key={item.id} value={item.id}>Sort: {item.label}</option>
              ))}
            </select>
          </div>

          <div className="text-[10px] text-[var(--muted)]">
            Showing {filtered.length} of {stocks.length} stocks
            {listFilter === 'halal' ? ' · NGX Lotus Islamic Index constituents' : ''}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-[12px] text-[var(--muted)]">No stocks match your filters.</div>
        ) : (
          filtered.map(stock => <StockRow key={stock.id} stock={stock} />)
        )}
      </Card>
    </div>
  )
}