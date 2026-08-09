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

/** Default ₦ profit added (buy) or removed (sell) per $1 of asset value when unset. */
export const DEFAULT_USD_MARGIN_NGN = 50

export function getDefaultCryptoMarketSourceId(symbol: string) {
  return DEFAULT_CRYPTO_MARKET_SOURCE_IDS[symbol.trim().toUpperCase() as KnownCryptoSymbol] || ''
}

function roundRate(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  // Keep enough precision for high-priced assets (ETH) without noisy float dust.
  return Math.round(value * 1e8) / 1e8
}

/**
 * Customer buy rate in ₦ per 1 unit of crypto.
 *
 * Profit is applied on the dollar leg, not as a % of the asset:
 *   buyRate = marketPriceUsd × (usdNgnMid + buyMarginNgnPerUsd)
 *
 * Example: live USD/NGN = 1500, margin = 50 → user pays ₦1,550 per $1 of SOL.
 *   SOL at $180 → buyRate = 180 × 1550 = ₦279,000
 *
 * `marketRate` is the mid (marketPriceUsd × usdNgn). Used to recover mid FX when both are present.
 */
export function computeBuyRate(
  marketPriceUsd: number,
  marketRate: number,
  buyMarginNgnPerUsd: number = DEFAULT_USD_MARGIN_NGN,
): number {
  const margin = Math.max(0, Number.isFinite(buyMarginNgnPerUsd) ? buyMarginNgnPerUsd : 0)
  if (marketPriceUsd > 0 && marketRate > 0) {
    const usdNgn = marketRate / marketPriceUsd
    return roundRate(marketPriceUsd * (usdNgn + margin))
  }
  // Without a USD price we cannot price margin-on-dollar; surface mid only.
  return marketRate > 0 ? roundRate(marketRate) : 0
}

/**
 * Customer sell rate in ₦ per 1 unit of crypto.
 *
 *   sellRate = marketPriceUsd × max(0, usdNgnMid − sellMarginNgnPerUsd)
 *
 * Example: mid 1500, margin 50 → user receives ₦1,450 per $1 of crypto value.
 */
export function computeSellRate(
  marketPriceUsd: number,
  marketRate: number,
  sellMarginNgnPerUsd: number = DEFAULT_USD_MARGIN_NGN,
): number {
  const margin = Math.max(0, Number.isFinite(sellMarginNgnPerUsd) ? sellMarginNgnPerUsd : 0)
  if (marketPriceUsd > 0 && marketRate > 0) {
    const usdNgn = marketRate / marketPriceUsd
    return roundRate(marketPriceUsd * Math.max(0, usdNgn - margin))
  }
  return marketRate > 0 ? roundRate(marketRate) : 0
}

/** Mid FX implied by a priced asset (₦ per $1). */
export function impliedUsdNgn(marketPriceUsd: number, marketRate: number): number {
  if (!(marketPriceUsd > 0) || !(marketRate > 0)) return 0
  return marketRate / marketPriceUsd
}
