import https from 'node:https'
import { NGX_MARKET_SUMMARY, NGX_STOCKS } from '@/lib/constants'
import { resolveNgxStockLogoUrl } from '@/lib/ngx-logos'
import { enrichStockQuote } from '@/lib/stock-filters'
import type { StockQuote, StocksMarketSource, StocksMarketSummary } from '@/types'

const NGN_MARKET_API_BASE_URL = process.env.NGN_MARKET_API_BASE_URL?.trim() || 'https://api.ngnmarket.com/v1'
const NGN_MARKET_API_KEY = process.env.NGN_MARKET_API_KEY?.trim()
const CACHE_TTL_MS = 20 * 60 * 1000
const FETCH_TIMEOUT_MS = 12_000
const DEBUG = process.env.MAFITAPAY_DEBUG_NGX_MARKET === '1'

type NgnSuccessEnvelope<T> = {
  success: boolean
  data: T
}

type NgnCompanyListItem = {
  id: number
  symbol: string
  name: string
  sector: string
  sub_sector?: string
  market_classification?: string
  logo_url?: string
  price: number
  price_change_percent: number
  volume?: number
  market_cap?: number
  last_updated?: string
}

type NgnCompaniesPage = {
  data: NgnCompanyListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    total_pages: number
  }
}

type NgnMarketSnapshot = {
  asi: number
  asi_change_percent: number
  updated_at: string
  total_listed_securities?: number | null
}

type MarketCache = {
  stocks: StockQuote[]
  summary: StocksMarketSummary
  source: StocksMarketSource
  fetchedAt: number
}

function log(event: string, details?: Record<string, unknown>) {
  if (!DEBUG) return
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[ngx-market] ${event}${payload}`)
}

function getCacheState() {
  return globalThis as typeof globalThis & {
    __mafitapayNgxMarketCache?: MarketCache
    __mafitapayNgxMarketInflight?: Promise<MarketCache>
  }
}

function buildSeedMarket(): MarketCache {
  return {
    stocks: NGX_STOCKS.map(enrichStockQuote),
    summary: { ...NGX_MARKET_SUMMARY, source: 'seed' },
    source: 'seed',
    fetchedAt: Date.now(),
  }
}

function symbolToId(symbol: string) {
  return symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function mapCompany(company: NgnCompanyListItem): StockQuote | null {
  const priceNgn = Number(company.price)
  const changePercent = Number(company.price_change_percent)
  if (!company.symbol || !Number.isFinite(priceNgn) || priceNgn <= 0) return null

  return enrichStockQuote({
    id: symbolToId(company.symbol),
    symbol: company.symbol,
    name: company.name,
    sector: company.sector || 'Other',
    subSector: company.sub_sector || undefined,
    marketClassification: company.market_classification || undefined,
    exchange: 'NGX',
    logoUrl: resolveNgxStockLogoUrl(company.symbol, company.logo_url),
    priceNgn,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    volume: Number.isFinite(Number(company.volume)) ? Number(company.volume) : undefined,
    marketCapNgn: Number.isFinite(Number(company.market_cap)) ? Number(company.market_cap) : undefined,
    isWatchOnly: true,
  })
}

async function fetchNgnMarketJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  if (!NGN_MARKET_API_KEY) {
    throw new Error('NGN_MARKET_API_KEY is not configured.')
  }

  const url = new URL(`${NGN_MARKET_API_BASE_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value))
    }
  }

  return await new Promise<T>((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${NGN_MARKET_API_KEY}`,
        'user-agent': 'mafitapay/0.1.0',
      },
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        const statusCode = response.statusCode ?? 0
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`NGN Market request failed (${statusCode}): ${body.slice(0, 200)}`))
          return
        }

        try {
          resolve(JSON.parse(body) as T)
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Invalid JSON from NGN Market.'))
        }
      })
    })

    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error('NGN Market request timed out.'))
    })
    request.on('error', reject)
    request.end()
  })
}

async function fetchAllCompanies(): Promise<NgnCompanyListItem[]> {
  const first = await fetchNgnMarketJson<NgnSuccessEnvelope<NgnCompaniesPage>>('companies', {
    limit: 200,
    sort: 'market_cap',
    order: 'desc',
    page: 1,
  })

  const rows = [...(first.data?.data ?? [])]
  const totalPages = first.data?.pagination?.total_pages ?? 1

  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchNgnMarketJson<NgnSuccessEnvelope<NgnCompaniesPage>>('companies', {
      limit: 200,
      sort: 'market_cap',
      order: 'desc',
      page,
    })
    rows.push(...(next.data?.data ?? []))
  }

  return rows
}

async function fetchMarketSnapshot(): Promise<NgnMarketSnapshot | null> {
  const response = await fetchNgnMarketJson<NgnSuccessEnvelope<NgnMarketSnapshot>>('market/snapshot')
  return response.data ?? null
}

async function refreshLiveMarket(): Promise<MarketCache> {
  log('refresh.start')

  const [companies, snapshot] = await Promise.all([
    fetchAllCompanies(),
    fetchMarketSnapshot().catch(() => null),
  ])

  const stocks = companies
    .map(mapCompany)
    .filter((item): item is StockQuote => item !== null)
    .sort((a, b) => (b.marketCapNgn ?? 0) - (a.marketCapNgn ?? 0))

  if (stocks.length === 0) {
    throw new Error('NGN Market returned no usable stock quotes.')
  }

  const lastUpdated = snapshot?.updated_at ?? new Date().toISOString()
  const summary: StocksMarketSummary = {
    indexName: 'NGX All-Share Index',
    indexValue: Number(snapshot?.asi) > 0 ? Number(snapshot!.asi) : NGX_MARKET_SUMMARY.indexValue,
    changePercent: Number.isFinite(Number(snapshot?.asi_change_percent))
      ? Number(snapshot!.asi_change_percent)
      : NGX_MARKET_SUMMARY.changePercent,
    marketStatus: 'watch_only',
    exchange: 'NGX',
    lastUpdated,
    source: 'live',
    listedCount: snapshot?.total_listed_securities ?? stocks.length,
  }

  const cache: MarketCache = {
    stocks,
    summary,
    source: 'live',
    fetchedAt: Date.now(),
  }

  log('refresh.success', { stocks: stocks.length, asi: summary.indexValue })
  return cache
}

export async function getStocksMarket() {
  const state = getCacheState()
  const cached = state.__mafitapayNgxMarketCache
  const cacheIsFresh = cached && Date.now() - cached.fetchedAt <= CACHE_TTL_MS

  if (cacheIsFresh) {
    return {
      stocks: cached.stocks,
      summary: cached.summary,
      watchOnly: true as const,
      source: cached.source,
    }
  }

  if (!NGN_MARKET_API_KEY) {
    const seed = buildSeedMarket()
    state.__mafitapayNgxMarketCache = seed
    return {
      stocks: seed.stocks,
      summary: seed.summary,
      watchOnly: true as const,
      source: 'seed' as StocksMarketSource,
    }
  }

  if (state.__mafitapayNgxMarketInflight) {
    const inflight = await state.__mafitapayNgxMarketInflight
    return {
      stocks: inflight.stocks,
      summary: inflight.summary,
      watchOnly: true as const,
      source: inflight.source,
    }
  }

  state.__mafitapayNgxMarketInflight = refreshLiveMarket()
    .then(cache => {
      state.__mafitapayNgxMarketCache = cache
      return cache
    })
    .catch(error => {
      log('refresh.error', { message: error instanceof Error ? error.message : String(error) })
      if (cached) {
        return {
          ...cached,
          summary: { ...cached.summary, source: 'stale' as StocksMarketSource },
          source: 'stale' as StocksMarketSource,
        }
      }
      return buildSeedMarket()
    })
    .finally(() => {
      state.__mafitapayNgxMarketInflight = undefined
    })

  const result = await state.__mafitapayNgxMarketInflight
  return {
    stocks: result.stocks,
    summary: result.summary,
    watchOnly: true as const,
    source: result.source,
  }
}

export function getNgxMarketHealth() {
  const state = getCacheState()
  const cached = state.__mafitapayNgxMarketCache

  return {
    configured: Boolean(NGN_MARKET_API_KEY),
    source: cached?.source ?? (NGN_MARKET_API_KEY ? 'pending' : 'seed'),
    lastFetchedAt: cached ? new Date(cached.fetchedAt).toISOString() : null,
    stockCount: cached?.stocks.length ?? NGX_STOCKS.length,
    cacheTtlMs: CACHE_TTL_MS,
  }
}