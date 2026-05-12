import type { CryptoAsset, CryptoNetwork, CryptoPairId, CryptoSymbol, KnownCryptoPairId } from '@/types'

export type RoutedTreasuryPairId = Extract<
  KnownCryptoPairId,
  'USDT_BSC' | 'BNB_BSC' | 'ETH_ARB' | 'ETH_OP' | 'POL_POLYGON' | 'ETH_LINEA' | 'USDC_SOLANA' | 'SOL_SOLANA'
>

export type RoutedTreasuryAddressFamily = 'evm' | 'solana'

export type RoutedTreasuryPairConfig = {
  pairId: RoutedTreasuryPairId
  symbol: CryptoSymbol
  network: CryptoNetwork
  toChain: string
  toToken: string
  decimals: number
  addressFamily: RoutedTreasuryAddressFamily
  minimumBuyNgn: number
  maxQuoteDriftPercent: number
}

export type RoutedTreasuryResolvedConfig = Omit<RoutedTreasuryPairConfig, 'pairId'> & {
  pairId: CryptoPairId
}

const EVM_NATIVE_SENTINEL = '0x0000000000000000000000000000000000000000'
const SOL_NATIVE_SENTINEL = '11111111111111111111111111111111'
const SOL_USDC_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

export const ROUTED_TREASURY_PAIR_CONFIG: Record<RoutedTreasuryPairId, RoutedTreasuryPairConfig> = {
  USDT_BSC: {
    pairId: 'USDT_BSC',
    symbol: 'USDT',
    network: 'BSC',
    toChain: '56',
    toToken: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    addressFamily: 'evm',
    minimumBuyNgn: 500,
    maxQuoteDriftPercent: 0.35,
  },
  BNB_BSC: {
    pairId: 'BNB_BSC',
    symbol: 'BNB',
    network: 'BSC',
    toChain: '56',
    toToken: EVM_NATIVE_SENTINEL,
    decimals: 18,
    addressFamily: 'evm',
    minimumBuyNgn: 500,
    maxQuoteDriftPercent: 1,
  },
  ETH_ARB: {
    pairId: 'ETH_ARB',
    symbol: 'ETH',
    network: 'Arbitrum',
    toChain: '42161',
    toToken: EVM_NATIVE_SENTINEL,
    decimals: 18,
    addressFamily: 'evm',
    minimumBuyNgn: 500,
    maxQuoteDriftPercent: 1,
  },
  ETH_OP: {
    pairId: 'ETH_OP',
    symbol: 'ETH',
    network: 'Optimism',
    toChain: '10',
    toToken: EVM_NATIVE_SENTINEL,
    decimals: 18,
    addressFamily: 'evm',
    minimumBuyNgn: 500,
    maxQuoteDriftPercent: 1,
  },
  POL_POLYGON: {
    pairId: 'POL_POLYGON',
    symbol: 'POL',
    network: 'Polygon',
    toChain: '137',
    toToken: EVM_NATIVE_SENTINEL,
    decimals: 18,
    addressFamily: 'evm',
    minimumBuyNgn: 500,
    maxQuoteDriftPercent: 1,
  },
  ETH_LINEA: {
    pairId: 'ETH_LINEA',
    symbol: 'ETH',
    network: 'Linea',
    toChain: '59144',
    toToken: EVM_NATIVE_SENTINEL,
    decimals: 18,
    addressFamily: 'evm',
    minimumBuyNgn: 500,
    maxQuoteDriftPercent: 1,
  },
  USDC_SOLANA: {
    pairId: 'USDC_SOLANA',
    symbol: 'USDC',
    network: 'Solana',
    toChain: '1151111081099710',
    toToken: SOL_USDC_ADDRESS,
    decimals: 6,
    addressFamily: 'solana',
    minimumBuyNgn: 500,
    maxQuoteDriftPercent: 0.35,
  },
  SOL_SOLANA: {
    pairId: 'SOL_SOLANA',
    symbol: 'SOL',
    network: 'Solana',
    toChain: '1151111081099710',
    toToken: SOL_NATIVE_SENTINEL,
    decimals: 9,
    addressFamily: 'solana',
    minimumBuyNgn: 500,
    maxQuoteDriftPercent: 1,
  },
}

export function isRoutedTreasuryPairId(pairId: CryptoPairId): pairId is RoutedTreasuryPairId {
  return pairId in ROUTED_TREASURY_PAIR_CONFIG
}

export function getRoutedTreasuryPairConfig(pairId: CryptoPairId) {
  if (isRoutedTreasuryPairId(pairId)) {
    return ROUTED_TREASURY_PAIR_CONFIG[pairId]
  }

  throw new Error(`${pairId} is not configured for LI.FI routed execution.`)
}

export function getRoutedTreasuryPairConfigForAsset(
  asset: Pick<CryptoAsset, 'id' | 'executionRail' | 'routedToChain' | 'routedToToken' | 'routedDecimals' | 'routedAddressFamily' | 'minimumBuyNgn' | 'maxQuoteDriftPercent' | 'network'>,
): RoutedTreasuryResolvedConfig {
  const fallback = isRoutedTreasuryPairId(asset.id) ? ROUTED_TREASURY_PAIR_CONFIG[asset.id] : null
  const executionRail = asset.executionRail ?? (fallback ? 'routed_treasury' : undefined)

  if (executionRail !== 'routed_treasury') {
    throw new Error(`${asset.id} is not configured for routed treasury execution.`)
  }

  const toChain = asset.routedToChain?.trim() || fallback?.toChain || ''
  const toToken = asset.routedToToken?.trim() || fallback?.toToken || ''
  const decimals = Number.isFinite(asset.routedDecimals) ? Number(asset.routedDecimals) : fallback?.decimals
  const addressFamily = asset.routedAddressFamily || fallback?.addressFamily
  const minimumBuyNgn = Number.isFinite(asset.minimumBuyNgn) ? Number(asset.minimumBuyNgn) : fallback?.minimumBuyNgn
  const maxQuoteDriftPercent = Number.isFinite(asset.maxQuoteDriftPercent) ? Number(asset.maxQuoteDriftPercent) : fallback?.maxQuoteDriftPercent

  if (!toChain || !toToken || !Number.isFinite(decimals) || decimals == null || decimals < 0 || !addressFamily) {
    throw new Error(`${asset.id} routed treasury config is incomplete.`)
  }

  const inferredSymbol = String(asset.id).split('_')[0] || 'TOKEN'

  return {
    pairId: asset.id,
    symbol: inferredSymbol,
    network: asset.network,
    toChain,
    toToken,
    decimals,
    addressFamily,
    minimumBuyNgn: minimumBuyNgn ?? 500,
    maxQuoteDriftPercent: maxQuoteDriftPercent ?? 1,
  }
}

export function findRoutedTreasuryPairId(symbol: string, network: CryptoNetwork) {
  const normalizedSymbol = symbol.trim().toUpperCase()
  const entry = Object.values(ROUTED_TREASURY_PAIR_CONFIG).find(item => item.symbol === normalizedSymbol && item.network === network)
  return entry?.pairId ?? null
}

export function buildCryptoPairId(symbol: string, network: CryptoNetwork) {
  const configuredPairId = findRoutedTreasuryPairId(symbol, network)
  if (configuredPairId) return configuredPairId
  return `${symbol.trim().toUpperCase()}_${network.trim().toUpperCase().replace(/\s+/g, '_')}`
}
