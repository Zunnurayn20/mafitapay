import { getRoutedTreasuryPairConfig, getRoutedTreasuryPairConfigForAsset, isRoutedTreasuryPairId } from '@/lib/routed-assets'
import type { CryptoAsset, CryptoNetwork, CryptoPairId } from '@/types'

/**
 * Flat network/gas recovery fees (₦) when an asset has no explicit fee configured.
 *
 * These sit on top of buy/sell spread bps (margin). Gas is roughly fixed per tx,
 * so a flat NGN fee recovers executor + sweep cost better than more bps alone.
 * Sell is slightly higher than buy because deposit sweeps often cost more.
 */
const DEFAULT_NETWORK_FEE_NGN_BY_NETWORK: Partial<Record<string, { buy: number; sell: number }>> = {
  Base: { buy: 100, sell: 150 },
  BSC: { buy: 80, sell: 120 },
  Solana: { buy: 50, sell: 80 },
  Ethereum: { buy: 2_500, sell: 3_000 },
  Polygon: { buy: 60, sell: 100 },
  Arbitrum: { buy: 120, sell: 180 },
  Optimism: { buy: 120, sell: 180 },
  Linea: { buy: 120, sell: 180 },
  TON: { buy: 150, sell: 200 },
  Sui: { buy: 100, sell: 150 },
  NEAR: { buy: 100, sell: 150 },
}

const FALLBACK_NETWORK_FEE_NGN = { buy: 150, sell: 200 }

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

/** Default gas-recovery fee for a network when the asset has no override. */
export function getDefaultNetworkFeeNgn(network: CryptoNetwork | string, side: 'buy' | 'sell') {
  const entry = DEFAULT_NETWORK_FEE_NGN_BY_NETWORK[network]
    ?? DEFAULT_NETWORK_FEE_NGN_BY_NETWORK[String(network)]
    ?? FALLBACK_NETWORK_FEE_NGN
  return side === 'buy' ? entry.buy : entry.sell
}

/**
 * Network/gas fee the customer pays on top of spread margin.
 *
 * Prefer the admin-configured per-asset fee when set (>= 0). Otherwise fall
 * back to the network default so we never silently absorb on-chain costs.
 */
export function getCryptoNetworkFeeNgn(
  asset: Pick<CryptoAsset, 'network' | 'buyNetworkFeeNgn' | 'sellNetworkFeeNgn'>,
  side: 'buy' | 'sell',
): number {
  const configured = side === 'buy' ? asset.buyNetworkFeeNgn : asset.sellNetworkFeeNgn
  if (configured != null && Number.isFinite(configured) && configured >= 0) {
    return roundNgn(configured)
  }
  return roundNgn(getDefaultNetworkFeeNgn(asset.network, side))
}
