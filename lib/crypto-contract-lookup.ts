import type { CryptoAsset } from '@/types'

/**
 * Shared contract between the admin form and the server lookup, so the two cannot disagree about
 * which networks support pasting an address or what a lookup returns.
 *
 * EVM only. name(), symbol() and decimals() are ERC-20 calls; Solana, Sui, TON and NEAR each hold
 * token metadata somewhere else entirely, so pairs on those chains are still entered by hand.
 *
 * `satisfies` keeps this list honest against CryptoAsset['network'] — renaming a network in the type
 * breaks the build here instead of silently disabling lookup for it.
 */
export const CONTRACT_LOOKUP_NETWORKS = [
  'Ethereum',
  'Base',
  'BSC',
  'Arbitrum',
  'Optimism',
  'Polygon',
  'Linea',
  'Robinhood',
] as const satisfies readonly CryptoAsset['network'][]

export type ContractLookupNetwork = (typeof CONTRACT_LOOKUP_NETWORKS)[number]

export function isContractLookupNetwork(value: string): value is ContractLookupNetwork {
  return (CONTRACT_LOOKUP_NETWORKS as readonly string[]).includes(value)
}

/**
 * 'verified'    — CoinGecko lists this contract, so it has a price feed and can be traded.
 * 'unlisted'    — CoinGecko does not list it. No feed exists, so it can only be catalogued.
 * 'unavailable' — CoinGecko could not be reached, or has no platform for this chain. Verdict unknown.
 */
export type TokenLookupVerification = 'verified' | 'unlisted' | 'unavailable'

export type TokenLookupResult = {
  network: ContractLookupNetwork
  chainId: number
  address: string
  addressFamily: NonNullable<CryptoAsset['routedAddressFamily']>
  symbol: string
  name: string
  decimals: number | null
  marketSourceId: string
  iconPath: string
  priceUsd: number | null
  verification: TokenLookupVerification
  /** Operator-facing sentence explaining the verdict. Shown verbatim in the admin form. */
  verificationMessage: string
  /** True when the chain would not answer name/symbol/decimals at all. */
  onChainReadFailed: boolean
  warnings: string[]
}
