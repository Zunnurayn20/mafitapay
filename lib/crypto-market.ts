import type { KnownCryptoSymbol } from '@/types'

export const DEFAULT_CRYPTO_MARKET_SOURCE_IDS: Record<KnownCryptoSymbol, string> = {
  USDT: 'tether',
  USDC: 'usd-coin',
  ETH: 'ethereum',
  POL: 'polygon-ecosystem-token',
  SOL: 'solana',
  BNB: 'binancecoin',
  TON: 'the-open-network',
  SUI: 'sui',
  NEAR: 'near',
}

export function getDefaultCryptoMarketSourceId(symbol: string) {
  return DEFAULT_CRYPTO_MARKET_SOURCE_IDS[symbol.trim().toUpperCase() as KnownCryptoSymbol] || ''
}

export function computeBuyRate(marketRate: number, buySpreadBps: number) {
  return marketRate * (1 + buySpreadBps / 10000)
}

export function computeSellRate(marketRate: number, sellSpreadBps: number) {
  return marketRate * (1 - sellSpreadBps / 10000)
}
