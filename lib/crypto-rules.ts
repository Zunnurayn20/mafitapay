import { getRoutedTreasuryPairConfig, getRoutedTreasuryPairConfigForAsset, isRoutedTreasuryPairId } from '@/lib/routed-assets'
import type { CryptoAsset, CryptoPairId } from '@/types'

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
