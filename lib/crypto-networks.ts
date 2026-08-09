import type { CryptoNetwork } from '@/types'

/**
 * Chain logos, keyed by network name.
 *
 * Distinct from an asset's own icon. A token that exists on several chains carries one icon
 * everywhere -- USDC is the same mark on Base, Solana and Polygon -- so a network picker keyed on
 * the asset icon renders identical rows and tells the user nothing. These are the chain marks.
 *
 * Several files are named eth-* for historical reasons but hold the L2's own logo, not Ethereum's:
 * eth-arb.png is the Arbitrum mark, eth-op.png Optimism, eth-linea.png Linea.
 * base.png is the Base chain mark; eth.png is the Ethereum token logo (used for ETH on any chain).
 */
const NETWORK_ICONS: Record<string, string> = {
  arbitrum: '/crypto-assets/eth-arb.png',
  base: '/crypto-assets/base.png',
  bsc: '/crypto-assets/bnb.png',
  ethereum: '/crypto-assets/eth.png',
  linea: '/crypto-assets/eth-linea.png',
  near: '/crypto-assets/near.png',
  optimism: '/crypto-assets/eth-op.png',
  polygon: '/crypto-assets/pol.png',
  solana: '/crypto-assets/sol.png',
  sui: '/crypto-assets/sui.png',
  ton: '/crypto-assets/ton.png',
}

/** Local logo for a chain, or undefined when there is no accurate one to show. */
export function getNetworkIconUrl(network?: CryptoNetwork | string): string | undefined {
  const key = network?.trim().toLowerCase()
  if (!key) return undefined
  return NETWORK_ICONS[key]
}

/** Short label for the text fallback when a chain has no logo. */
export function getNetworkFallbackLabel(network?: CryptoNetwork | string): string {
  const trimmed = network?.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 1).toUpperCase()
}
