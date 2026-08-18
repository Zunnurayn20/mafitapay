import { createPublicClient, erc20Abi, fallback, getAddress, http, isAddress } from 'viem'
import { arbitrum, base, bsc, linea, mainnet, optimism, polygon } from 'viem/chains'
import type { Chain, PublicClient } from 'viem'
import { sanitizeEvmRpcUrls } from '@/lib/server/evm-rpc'
import { getRobinhoodRpcUrls, robinhoodChain } from '@/lib/server/robinhood-chain'
import { fetchCoinGeckoJson } from '@/lib/server/crypto-market'
import { saveCryptoLogo } from '@/lib/server/crypto-logo-store'
import {
  type ContractLookupNetwork,
  type TokenLookupResult,
  type TokenLookupVerification,
} from '@/lib/crypto-contract-lookup'

/**
 * Turns a pasted contract address into a filled-in crypto pair draft.
 *
 * Two independent sources, deliberately kept apart because they answer different questions:
 *
 *   - The chain answers "what is this contract" — name, symbol and decimals straight from the token.
 *     Authoritative about the token's own numbers, and worth nothing as a trust signal: anyone can
 *     deploy a contract whose name() returns "Tether USD".
 *   - CoinGecko answers "is this the token people mean, and can we price it" — the coin id we quote
 *     against, the official logo, and a live USD price. A contract CoinGecko does not list cannot be
 *     priced at all, so it cannot be traded, only catalogued.
 *
 * The verification verdict is therefore about CoinGecko, never about the on-chain read.
 */

type EvmNetworkConfig = {
  chain: Chain
  /**
   * CoinGecko asset-platform id used by /coins/{platform}/contract/{address}. Null when CoinGecko
   * has no platform for the chain, which makes verification unavailable rather than negative.
   */
  platformId: string | null
  envKeys: string[]
  /**
   * Public endpoint used when no env RPC is configured. Kept clear of every host
   * sanitizeEvmRpcUrls() strips (Blast, BlockPI, llamarpc, bare Ankr paths) so the fallback is not
   * silently dropped on the way through.
   */
  defaultRpcUrl: string
}

const EVM_NETWORKS: Record<ContractLookupNetwork, EvmNetworkConfig> = {
  Ethereum: {
    chain: mainnet,
    platformId: 'ethereum',
    envKeys: ['MAFITAPAY_ETHEREUM_RPC_URLS', 'MAFITAPAY_ETHEREUM_RPC_URL'],
    defaultRpcUrl: 'https://ethereum-rpc.publicnode.com',
  },
  Base: {
    chain: base,
    platformId: 'base',
    envKeys: ['MAFITAPAY_BASE_RPC_URLS', 'MAFITAPAY_BASE_RPC_URL'],
    defaultRpcUrl: 'https://mainnet.base.org',
  },
  BSC: {
    chain: bsc,
    platformId: 'binance-smart-chain',
    envKeys: ['MAFITAPAY_BSC_RPC_URLS', 'MAFITAPAY_BSC_RPC_URL'],
    defaultRpcUrl: 'https://bsc-dataseed.binance.org',
  },
  Arbitrum: {
    chain: arbitrum,
    platformId: 'arbitrum-one',
    envKeys: ['MAFITAPAY_ARBITRUM_RPC_URLS', 'MAFITAPAY_ARBITRUM_RPC_URL'],
    defaultRpcUrl: 'https://arb1.arbitrum.io/rpc',
  },
  Optimism: {
    chain: optimism,
    platformId: 'optimistic-ethereum',
    envKeys: ['MAFITAPAY_OPTIMISM_RPC_URLS', 'MAFITAPAY_OPTIMISM_RPC_URL'],
    defaultRpcUrl: 'https://mainnet.optimism.io',
  },
  Polygon: {
    chain: polygon,
    platformId: 'polygon-pos',
    envKeys: ['MAFITAPAY_POLYGON_RPC_URLS', 'MAFITAPAY_POLYGON_RPC_URL'],
    defaultRpcUrl: 'https://polygon-rpc.com',
  },
  Linea: {
    chain: linea,
    platformId: 'linea',
    envKeys: ['MAFITAPAY_LINEA_RPC_URLS', 'MAFITAPAY_LINEA_RPC_URL'],
    defaultRpcUrl: 'https://rpc.linea.build',
  },
  Robinhood: {
    chain: robinhoodChain,
    platformId: null,
    envKeys: ['MAFITAPAY_ROBINHOOD_RPC_URLS', 'MAFITAPAY_ROBINHOOD_RPC_URL'],
    defaultRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  },
}

type CoinGeckoContractResponse = {
  id?: string
  symbol?: string
  name?: string
  image?: { thumb?: string; small?: string; large?: string }
  detail_platforms?: Record<string, { decimal_place?: number | null; contract_address?: string }>
  market_data?: { current_price?: Record<string, number> }
}

function createClientFor(network: ContractLookupNetwork): PublicClient {
  const config = EVM_NETWORKS[network]

  // Robinhood already owns its RPC resolution (and its own dead-host list), so defer to it.
  const rpcUrls = network === 'Robinhood'
    ? getRobinhoodRpcUrls().rpcUrls
    : sanitizeEvmRpcUrls(
        config.envKeys.map(key => process.env[key]?.trim()).find(Boolean),
        config.defaultRpcUrl,
      ).rpcUrls

  const endpoints = rpcUrls.length > 0 ? rpcUrls : [config.defaultRpcUrl]
  const transport = endpoints.length > 1
    ? fallback(endpoints.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(endpoints[0], { retryCount: 1, timeout: 10_000 })

  return createPublicClient({ chain: config.chain, transport }) as PublicClient
}

/**
 * name(), symbol() and decimals() are the *optional* half of ERC-20, and proxy tokens sometimes
 * revert on them, so each is read independently — one missing field must not lose the other two.
 */
async function readOnChainMetadata(network: ContractLookupNetwork, address: `0x${string}`) {
  const client = createClientFor(network)
  const call = { address, abi: erc20Abi } as const

  const [name, symbol, decimals] = await Promise.allSettled([
    client.readContract({ ...call, functionName: 'name' }),
    client.readContract({ ...call, functionName: 'symbol' }),
    client.readContract({ ...call, functionName: 'decimals' }),
  ])

  return {
    name: name.status === 'fulfilled' && typeof name.value === 'string' ? name.value.trim() : '',
    symbol: symbol.status === 'fulfilled' && typeof symbol.value === 'string' ? symbol.value.trim() : '',
    decimals: decimals.status === 'fulfilled' && Number.isFinite(Number(decimals.value)) ? Number(decimals.value) : null,
    // Nothing answered at all: either the address holds no ERC-20 or the RPC is unreachable. Either
    // way the operator needs to know the chain contributed nothing.
    allFailed: name.status === 'rejected' && symbol.status === 'rejected' && decimals.status === 'rejected',
  }
}

async function lookupCoinGeckoContract(platformId: string, address: string) {
  try {
    const data = await fetchCoinGeckoJson<CoinGeckoContractResponse>(
      `coins/${encodeURIComponent(platformId)}/contract/${encodeURIComponent(address.toLowerCase())}`,
    )
    return { status: 'listed' as const, data }
  } catch (error) {
    const statusCode = (error as Error & { statusCode?: number }).statusCode
    if (statusCode === 404) return { status: 'unlisted' as const, data: null }
    return {
      status: 'unavailable' as const,
      data: null,
      message: error instanceof Error ? error.message : 'CoinGecko lookup failed.',
    }
  }
}

/** Pulls the official logo onto our own volume so the pair never hotlinks a third-party CDN. */
async function importLogo(imageUrl: string | undefined, basename: string) {
  if (!imageUrl) return ''

  try {
    // CoinGecko decorates image URLs with a cache-busting query; the bare path serves the same file.
    const response = await fetch(imageUrl.split('?')[0], {
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return ''

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const saved = await saveCryptoLogo(Buffer.from(await response.arrayBuffer()), contentType, basename)
    return saved.path
  } catch {
    // A logo we could not fetch is a cosmetic loss — the operator can still upload one by hand, so
    // it must not fail the whole lookup.
    return ''
  }
}

export async function lookupTokenByContract(network: ContractLookupNetwork, rawAddress: string): Promise<TokenLookupResult> {
  const trimmed = rawAddress.trim()
  if (!isAddress(trimmed, { strict: false })) {
    throw Object.assign(new Error('That is not a valid EVM contract address.'), { statusCode: 400 })
  }

  const config = EVM_NETWORKS[network]
  // Checksum from the lowercased form so a pasted all-caps or mixed-case address cannot fail on a
  // checksum mismatch before we ever reach the chain.
  const address = getAddress(trimmed.toLowerCase())
  const warnings: string[] = []

  const [onChain, coinGecko] = await Promise.all([
    readOnChainMetadata(network, address),
    config.platformId
      ? lookupCoinGeckoContract(config.platformId, address)
      : Promise.resolve({ status: 'unavailable' as const, data: null, message: `CoinGecko has no asset platform for ${network}.` }),
  ])

  const listing = coinGecko.status === 'listed' ? coinGecko.data : null
  const platformDetail = listing && config.platformId ? listing.detail_platforms?.[config.platformId] : undefined

  const symbol = (onChain.symbol || listing?.symbol || '').toUpperCase()
  const name = onChain.name || listing?.name || ''
  const decimals = onChain.decimals ?? (
    typeof platformDetail?.decimal_place === 'number' ? platformDetail.decimal_place : null
  )

  if (onChain.allFailed) {
    warnings.push(`Could not read this contract on ${network}. Check the address is on the right chain.`)
  }
  if (onChain.symbol && listing?.symbol && onChain.symbol.toUpperCase() !== listing.symbol.toUpperCase()) {
    warnings.push(`The contract calls itself ${onChain.symbol.toUpperCase()} but CoinGecko lists it as ${listing.symbol.toUpperCase()}.`)
  }
  if (listing && config.platformId && !platformDetail) {
    warnings.push(`CoinGecko knows this coin but does not list it on ${network}. Confirm you have the right chain.`)
  }
  if (decimals == null) {
    warnings.push('Decimals could not be determined — set them by hand under Advanced.')
  }

  const verification: TokenLookupVerification =
    coinGecko.status === 'listed' ? 'verified' : coinGecko.status === 'unlisted' ? 'unlisted' : 'unavailable'

  const verificationMessage =
    verification === 'verified'
      ? `Verified on CoinGecko as ${listing?.name ?? name}. Live pricing is available.`
      : verification === 'unlisted'
        ? `CoinGecko does not list this contract on ${network}, so there is no price feed for it. You can still catalogue the coin, but it cannot be traded in-app.`
        : `Could not reach CoinGecko for ${network}${'message' in coinGecko && coinGecko.message ? ` (${coinGecko.message})` : ''}. Details below come from the chain only — set the price feed by hand before enabling trading.`

  const iconPath = await importLogo(listing?.image?.large || listing?.image?.small, symbol || address)

  return {
    network,
    chainId: config.chain.id,
    address,
    addressFamily: 'evm',
    symbol,
    name,
    decimals,
    marketSourceId: listing?.id ?? '',
    iconPath,
    priceUsd: typeof listing?.market_data?.current_price?.usd === 'number'
      ? listing.market_data.current_price.usd
      : null,
    verification,
    verificationMessage,
    onChainReadFailed: onChain.allFailed,
    warnings,
  }
}
