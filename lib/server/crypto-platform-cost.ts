import type { CryptoAsset, CryptoOrder } from '@/types'

export type PlatformCryptoCost = {
  version: 1
  basis: 'quote_market_rate'
  status: 'estimate'
  principalNgn: number
  assetMarketRateNgn: number
  assetMarketRateSource: CryptoAsset['marketSnapshotSource'] | 'unknown'
  nativeFeeSymbol?: string
  nativeFeeRateNgn?: number
  usdNgnRate?: number
}

export function createPlatformCryptoCostSnapshot(input: {
  asset: CryptoAsset
  cryptoAmount: number
  nativeAsset?: CryptoAsset
  usdAsset?: CryptoAsset
}): PlatformCryptoCost {
  return {
    version: 1,
    basis: 'quote_market_rate',
    status: 'estimate',
    principalNgn: input.cryptoAmount * input.asset.marketRate,
    assetMarketRateNgn: input.asset.marketRate,
    assetMarketRateSource: input.asset.marketSnapshotSource ?? 'unknown',
    ...(input.nativeAsset ? {
      nativeFeeSymbol: input.nativeAsset.symbol,
      nativeFeeRateNgn: input.nativeAsset.marketRate,
    } : {}),
    ...(input.usdAsset ? { usdNgnRate: input.usdAsset.marketRate } : {}),
  }
}

export function getPlatformCryptoCost(order: CryptoOrder): PlatformCryptoCost | null {
  const value = order.providerPayload?.platformCost
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const cost = value as Partial<PlatformCryptoCost>
  if (cost.version !== 1 || cost.basis !== 'quote_market_rate' || typeof cost.principalNgn !== 'number') return null
  return cost as PlatformCryptoCost
}

export function getActualNativeFee(order: CryptoOrder) {
  const payload = order.providerPayload ?? {}
  const cost = getPlatformCryptoCost(order)
  const receiptKeys = ['swapReceipt', 'deliveryReceipt'] as const
  const summedBySymbol = new Map<string, number>()

  for (const key of receiptKeys) {
    const receipt = payload[key]
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) continue
    const fee = receipt as { gasCostNative?: unknown; gasCostSymbol?: unknown }
    if (typeof fee.gasCostNative !== 'string' || typeof fee.gasCostSymbol !== 'string') continue
    const amount = Number(fee.gasCostNative)
    if (!Number.isFinite(amount) || amount < 0) continue
    summedBySymbol.set(fee.gasCostSymbol, (summedBySymbol.get(fee.gasCostSymbol) ?? 0) + amount)
  }

  if (summedBySymbol.size === 0) return null
  return [...summedBySymbol.entries()].map(([symbol, amount]) => ({
    symbol,
    amount,
    amountNgnEstimate: cost?.nativeFeeSymbol === symbol && typeof cost.nativeFeeRateNgn === 'number'
      ? amount * cost.nativeFeeRateNgn
      : null,
  }))
}

export function getProviderFeeEstimate(order: CryptoOrder) {
  const payload = order.providerPayload ?? {}
  const cost = getPlatformCryptoCost(order)
  const rawFees = Array.isArray(payload.providerFeeCosts) ? payload.providerFeeCosts : []

  return rawFees.flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const fee = value as { type?: unknown; amount?: unknown; amountUSD?: unknown; token?: { symbol?: unknown } }
    const amount = typeof fee.amount === 'string' ? fee.amount : null
    const amountUsd = typeof fee.amountUSD === 'string' ? Number(fee.amountUSD) : null
    const amountNgn = amountUsd !== null && Number.isFinite(amountUsd) && cost?.usdNgnRate
      ? amountUsd * cost.usdNgnRate
      : null
    if (!amount && amountNgn === null) return []
    return [{
      id: `${String(fee.type ?? 'provider-fee')}-${index}`,
      type: typeof fee.type === 'string' ? fee.type : 'provider fee',
      amount,
      symbol: typeof fee.token?.symbol === 'string' ? fee.token.symbol : undefined,
      amountNgn,
    }]
  })
}
