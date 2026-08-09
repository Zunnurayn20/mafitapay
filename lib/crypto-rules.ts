import { getRoutedTreasuryPairConfig, getRoutedTreasuryPairConfigForAsset, isRoutedTreasuryPairId } from '@/lib/routed-assets'
import type { CryptoAsset, CryptoNetwork, CryptoPairId } from '@/types'

type NetworkFeePair = { buy: number; sell: number }

/**
 * Pair-specific gas recovery (₦). Tuned so:
 * - cheap L2 / L1 sidechains + simple stable transfers → lower fees
 * - native swaps (ETH/BNB/SOL) → higher (more gas / more hops)
 * - Ethereum mainnet → much higher
 * - sell ≥ buy (deposit sweep + optional gas top-up costs more than a treasury send)
 */
const DEFAULT_NETWORK_FEE_NGN_BY_PAIR: Partial<Record<string, NetworkFeePair>> = {
  // Cheap stables — transfer-only, low gas
  USDT_BSC: { buy: 50, sell: 90 },
  USDC_BASE: { buy: 60, sell: 100 },
  USDC_SOLANA: { buy: 40, sell: 70 },
  USDC_POLYGON: { buy: 40, sell: 70 },
  USDT_POLYGON: { buy: 40, sell: 70 },

  // Native / swap-heavy on L2 or sidechains
  ETH_BASE: { buy: 150, sell: 220 },
  BNB_BSC: { buy: 100, sell: 160 },
  SOL_SOLANA: { buy: 80, sell: 130 },
  POL_POLYGON: { buy: 70, sell: 120 },

  // Ethereum mainnet — expensive gas
  ETH_ETHEREUM: { buy: 3_500, sell: 4_500 },

  // Non-EVM rails
  TON_TON: { buy: 180, sell: 250 },
  SUI_SUI: { buy: 120, sell: 180 },
  NEAR_NEAR: { buy: 120, sell: 180 },
}

/**
 * Network-wide fallback when the pair has no entry above.
 * Sell is slightly higher than buy because deposit sweeps often cost more.
 */
const DEFAULT_NETWORK_FEE_NGN_BY_NETWORK: Partial<Record<string, NetworkFeePair>> = {
  Base: { buy: 100, sell: 150 },
  BSC: { buy: 80, sell: 120 },
  Solana: { buy: 50, sell: 80 },
  Ethereum: { buy: 3_000, sell: 4_000 },
  Polygon: { buy: 60, sell: 100 },
  Arbitrum: { buy: 120, sell: 180 },
  Optimism: { buy: 120, sell: 180 },
  Linea: { buy: 120, sell: 180 },
  TON: { buy: 180, sell: 250 },
  Sui: { buy: 120, sell: 180 },
  NEAR: { buy: 120, sell: 180 },
}

const FALLBACK_NETWORK_FEE_NGN: NetworkFeePair = { buy: 150, sell: 200 }

const MINIMUM_BUY_NGN_BY_PAIR: Partial<Record<CryptoPairId, number>> = {
  USDC_BASE: 500,
  ETH_BASE: 500,
  SUI_SUI: 500,
  NEAR_NEAR: 500,
  TON_TON: 800,
}

const MAX_QUOTE_TTL_SECONDS = 30
const MIN_QUOTE_TTL_SECONDS = 10

const MAX_QUOTE_DRIFT_PERCENT_BY_PAIR: Partial<Record<CryptoPairId, number>> = {
  USDC_BASE: 0.35,
  ETH_BASE: 1,
  ETH_ETHEREUM: 1,
  SUI_SUI: 1,
  NEAR_NEAR: 1,
  TON_TON: 1,
}

export function getMinimumBuyNgn(pairId: CryptoPairId) {
  if (isRoutedTreasuryPairId(pairId)) {
    return getRoutedTreasuryPairConfig(pairId).minimumBuyNgn
  }
  return MINIMUM_BUY_NGN_BY_PAIR[pairId] ?? 1000
}

export function getMinimumBuyNgnForAsset(asset: Pick<CryptoAsset, 'id' | 'network' | 'executionRail' | 'routedToChain' | 'routedToToken' | 'routedDecimals' | 'routedAddressFamily' | 'minimumBuyNgn' | 'maxQuoteDriftPercent'>) {
  if (asset.executionRail === 'routed_treasury') {
    return getRoutedTreasuryPairConfigForAsset(asset).minimumBuyNgn
  }
  return getMinimumBuyNgn(asset.id)
}

export function getEffectiveQuoteTtlSeconds(_pairId: CryptoPairId, configuredTtl?: number) {
  const ttl = Number.isFinite(configuredTtl) ? Number(configuredTtl) : MAX_QUOTE_TTL_SECONDS
  return Math.min(MAX_QUOTE_TTL_SECONDS, Math.max(MIN_QUOTE_TTL_SECONDS, ttl))
}

export function getMaxQuoteDriftPercent(pairId: CryptoPairId) {
  if (isRoutedTreasuryPairId(pairId)) {
    return getRoutedTreasuryPairConfig(pairId).maxQuoteDriftPercent
  }
  return MAX_QUOTE_DRIFT_PERCENT_BY_PAIR[pairId] ?? 1
}

export function getMaxQuoteDriftPercentForAsset(asset: Pick<CryptoAsset, 'id' | 'network' | 'executionRail' | 'routedToChain' | 'routedToToken' | 'routedDecimals' | 'routedAddressFamily' | 'minimumBuyNgn' | 'maxQuoteDriftPercent'>) {
  if (asset.executionRail === 'routed_treasury') {
    return getRoutedTreasuryPairConfigForAsset(asset).maxQuoteDriftPercent
  }
  return getMaxQuoteDriftPercent(asset.id)
}

export function getQuoteDriftPercent(quotedRate: number, liveRate: number) {
  if (!Number.isFinite(quotedRate) || quotedRate <= 0) return Infinity
  if (!Number.isFinite(liveRate) || liveRate <= 0) return Infinity
  return (Math.abs(liveRate - quotedRate) / quotedRate) * 100
}

function roundNgn(value: number) {
  return Math.round(value * 100) / 100
}

function pickFee(entry: NetworkFeePair, side: 'buy' | 'sell') {
  return side === 'buy' ? entry.buy : entry.sell
}

/** Pair-specific default when known; otherwise network fallback. */
export function getDefaultNetworkFeeNgn(
  network: CryptoNetwork | string,
  side: 'buy' | 'sell',
  pairId?: CryptoPairId | string,
) {
  if (pairId) {
    const pairEntry = DEFAULT_NETWORK_FEE_NGN_BY_PAIR[pairId]
      ?? DEFAULT_NETWORK_FEE_NGN_BY_PAIR[String(pairId)]
    if (pairEntry) return pickFee(pairEntry, side)
  }

  const networkEntry = DEFAULT_NETWORK_FEE_NGN_BY_NETWORK[network]
    ?? DEFAULT_NETWORK_FEE_NGN_BY_NETWORK[String(network)]
    ?? FALLBACK_NETWORK_FEE_NGN
  return pickFee(networkEntry, side)
}

/**
 * Network/gas fee the customer pays on top of spread margin.
 *
 * Order: admin override on the asset → pair default → network default.
 * Explicit 0 is allowed (admin chose free gas); null/undefined uses defaults.
 */
export function getCryptoNetworkFeeNgn(
  asset: Pick<CryptoAsset, 'id' | 'network' | 'buyNetworkFeeNgn' | 'sellNetworkFeeNgn'>,
  side: 'buy' | 'sell',
): number {
  const configured = side === 'buy' ? asset.buyNetworkFeeNgn : asset.sellNetworkFeeNgn
  if (configured != null && Number.isFinite(configured) && configured >= 0) {
    return roundNgn(configured)
  }
  return roundNgn(getDefaultNetworkFeeNgn(asset.network, side, asset.id))
}

/** Full default fee pair for admin previews / seeding. */
export function getDefaultNetworkFeePair(
  network: CryptoNetwork | string,
  pairId?: CryptoPairId | string,
): NetworkFeePair {
  return {
    buy: getDefaultNetworkFeeNgn(network, 'buy', pairId),
    sell: getDefaultNetworkFeeNgn(network, 'sell', pairId),
  }
}
