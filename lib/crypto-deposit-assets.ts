import type { CryptoAsset, CryptoDepositAddressFamily } from '@/types'

// Networks that share a single derived EVM deposit address. This list is the client-safe
// source of truth for both the deposit pickers and the server-side address derivation in
// lib/server/crypto-deposit-addresses.ts, which imports the resolver below. It used to be
// copied into each of those three call sites, so adding a chain here meant remembering to
// add it in two other files or the pair silently vanished from the sell list.
const EVM_DEPOSIT_NETWORKS = new Set([
  'base',
  'bsc',
  'ethereum',
  'polygon',
  'matic',
  'arbitrum',
  'optimism',
  'linea',
  'robinhood',
])

// Keep this aligned with the chain scanner and sweep adapter. An EVM-shaped address by itself
// does not mean the backend can identify, credit, and safely sweep that asset.
const SCANNED_CRYPTO_DEPOSIT_PAIRS = new Set([
  'ETH_BASE',
  'USDC_BASE',
  'CNGN_BASE',
  'RIZE_BASE',
  'BNB_BSC',
  'USDT_BSC',
  'POL_POLYGON',
  'USDC_POLYGON',
  'USDT_POLYGON',
  'ETH_ROBINHOOD',
  'USDC_SOLANA',
  'SOL_SOLANA',
  'TON_TON',
  'SUI_SUI',
  'NEAR_NEAR',
])

export function getCryptoDepositAddressFamilyForAsset(
  asset?: CryptoAsset | null,
): CryptoDepositAddressFamily | null {
  if (!asset) return null
  const network = asset.network.trim().toLowerCase()
  if (asset.routedAddressFamily === 'solana' || network === 'solana') return 'solana'
  if (network === 'ton') return 'ton'
  if (network === 'near') return 'near'
  if (network === 'sui') return 'sui'
  if (EVM_DEPOSIT_NETWORKS.has(network) || asset.routedAddressFamily === 'evm') return 'evm'
  return null
}

/** A pair can only be deposited against if we can derive an address for its chain. */
export function isDepositableCryptoAsset(asset?: CryptoAsset | null) {
  return Boolean(asset && SCANNED_CRYPTO_DEPOSIT_PAIRS.has(asset.id) && getCryptoDepositAddressFamilyForAsset(asset))
}

export type CryptoDepositAssetGroup = {
  symbol: string
  name: string
  icon: string
  options: CryptoAsset[]
}

/**
 * Collapses the pair list to one entry per symbol, so a token that exists on several chains
 * — ETH on six, USDC on three — is chosen once and then narrowed to a network. Listing raw
 * pairs instead renders identical logos side by side with nothing to tell them apart, which
 * is dangerous in a deposit flow where the wrong chain loses the funds.
 */
export function groupCryptoAssetsBySymbol(assets: CryptoAsset[]): CryptoDepositAssetGroup[] {
  const groups = new Map<string, CryptoAsset[]>()

  for (const asset of assets) {
    const key = asset.symbol.toUpperCase()
    const current = groups.get(key) ?? []
    current.push(asset)
    groups.set(key, current)
  }

  return Array.from(groups.entries()).map(([symbol, options]) => {
    const sorted = [...options].sort((a, b) => a.network.localeCompare(b.network))
    return {
      symbol,
      name: sorted[0]?.name ?? symbol,
      icon: sorted[0]?.icon ?? '',
      options: sorted,
    }
  })
}
