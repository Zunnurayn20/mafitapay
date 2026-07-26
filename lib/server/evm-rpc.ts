const DEAD_EVM_RPC_HOSTS = [
  'blastapi.io',
  'public.blastapi.io',
  'blockpi.network', // frequently returns "unknown host" / invalid params on Base getBlock
  'llamarpc.com',
]

const BARE_ANKR_CHAIN_PATHS = new Set([
  '/bsc',
  '/polygon',
  '/eth',
  '/base',
  '/arbitrum',
  '/avax',
  '/optimism',
])

function isUnauthenticatedAnkrUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('ankr.com')) return false
    if (parsed.pathname.includes('/multichain/') && parsed.pathname.length > 24) return false
    if (parsed.pathname.includes('/v2/') && parsed.pathname.length > 10) return false
    const normalized = parsed.pathname.replace(/\/+$/, '').toLowerCase()
    return BARE_ANKR_CHAIN_PATHS.has(normalized)
  } catch {
    return false
  }
}

const NON_EVM_RPC_MARKERS = [
  'mainnet-beta.solana',
  'rpcpool.com/solana',
  'solana-mainnet',
  '/solana',
  'fullnode.mainnet.sui.io',
  'near.drpc.org',
  'near.lava.build',
  'toncenter.com',
]

export function sanitizeEvmRpcUrls(raw: string | undefined, fallback: string) {
  if (!raw?.trim()) return { rpcUrls: [fallback], dropped: [] }

  const dropped: string[] = []
  const valid = raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .filter(url => {
      const lower = url.toLowerCase()
      if (!lower.startsWith('http')) {
        dropped.push(url)
        return false
      }
      if (DEAD_EVM_RPC_HOSTS.some(host => lower.includes(host))) {
        dropped.push(url)
        return false
      }
      if (NON_EVM_RPC_MARKERS.some(marker => lower.includes(marker))) {
        dropped.push(url)
        return false
      }
      if (lower.includes('solana') && !lower.includes('base')) {
        dropped.push(url)
        return false
      }
      if (isUnauthenticatedAnkrUrl(url)) {
        dropped.push(url)
        return false
      }
      return true
    })

  return {
    rpcUrls: valid.length > 0 ? valid : [fallback],
    dropped,
  }
}
