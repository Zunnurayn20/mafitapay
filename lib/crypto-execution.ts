import type { CryptoAsset, CryptoOrder, CryptoPairId } from '@/types'
import { isRoutedTreasuryPairId } from '@/lib/routed-assets'

export function getExecutionRailForPair(pairId: CryptoPairId): CryptoOrder['executionRail'] | null {
  if (pairId === 'USDC_BASE' || pairId === 'ETH_BASE') return 'base_treasury'
  if (isRoutedTreasuryPairId(pairId)) return 'routed_treasury'
  if (pairId === 'SUI_SUI') return 'sui_treasury'
  if (pairId === 'TON_TON') return 'ton_treasury'
  if (pairId === 'NEAR_NEAR') return 'near_intents'
  return null
}

export function getExecutionRailForAsset(asset: Pick<CryptoAsset, 'id' | 'executionRail'>): CryptoOrder['executionRail'] | null {
  return asset.executionRail ?? getExecutionRailForPair(asset.id)
}
