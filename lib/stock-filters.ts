import type { StockQuote } from '@/types'

/** NGX Lotus Islamic Index constituents (Shariah-screened). */
export const NGX_HALAL_SYMBOLS = new Set([
  'ARADEL',
  'BUACEMENT',
  'BUAFOODS',
  'CAP',
  'DANGCEM',
  'JAIZBANK',
  'MTNN',
  'NAHCO',
  'NASCON',
  'OKOMUOIL',
  'PRESCO',
  'WAPCO',
])

export type StockListFilter = 'all' | 'halal' | 'gainers' | 'losers'
export type StockSortKey = 'market_cap' | 'change' | 'volume' | 'price' | 'name'

export const STOCK_LIST_FILTERS: Array<{ id: StockListFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'halal', label: 'Halal' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
]

export const STOCK_SORT_OPTIONS: Array<{ id: StockSortKey; label: string }> = [
  { id: 'market_cap', label: 'Market cap' },
  { id: 'change', label: 'Day change' },
  { id: 'volume', label: 'Volume' },
  { id: 'price', label: 'Price' },
  { id: 'name', label: 'Name A–Z' },
]

export function isHalalStock(stock: Pick<StockQuote, 'symbol' | 'isHalal'>) {
  if (stock.isHalal === true) return true
  return NGX_HALAL_SYMBOLS.has(stock.symbol.trim().toUpperCase())
}

export function enrichStockQuote<T extends StockQuote>(stock: T): T {
  return {
    ...stock,
    isHalal: isHalalStock(stock),
  }
}

export function stockSearchHaystack(stock: StockQuote) {
  return [
    stock.symbol,
    stock.name,
    stock.sector,
    stock.subSector,
    stock.marketClassification,
    stock.isHalal ? 'halal sharia islamic lotus' : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function matchesStockSearch(stock: StockQuote, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const tokens = normalized.split(/\s+/).filter(Boolean)
  const haystack = stockSearchHaystack(stock)
  return tokens.every(token => haystack.includes(token))
}

export function filterStocks(
  stocks: StockQuote[],
  options: {
    search?: string
    sector?: string
    listFilter?: StockListFilter
  },
) {
  const sector = options.sector?.trim()
  const listFilter = options.listFilter ?? 'all'

  return stocks.filter(stock => {
    if (sector && sector !== 'all' && stock.sector !== sector) return false

    if (listFilter === 'halal' && !isHalalStock(stock)) return false
    if (listFilter === 'gainers' && stock.changePercent <= 0) return false
    if (listFilter === 'losers' && stock.changePercent >= 0) return false

    if (!matchesStockSearch(stock, options.search ?? '')) return false

    return true
  })
}

export function sortStocks(stocks: StockQuote[], sortKey: StockSortKey) {
  const rows = [...stocks]

  rows.sort((a, b) => {
    switch (sortKey) {
      case 'change':
        return b.changePercent - a.changePercent
      case 'volume':
        return (b.volume ?? 0) - (a.volume ?? 0)
      case 'price':
        return b.priceNgn - a.priceNgn
      case 'name':
        return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
      case 'market_cap':
      default:
        return (b.marketCapNgn ?? 0) - (a.marketCapNgn ?? 0)
    }
  })

  return rows
}

export function collectStockSectors(stocks: StockQuote[]) {
  return Array.from(new Set(stocks.map(item => item.sector).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }),
  )
}