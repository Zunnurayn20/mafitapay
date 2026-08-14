import { defineChain } from 'viem'
import { sanitizeEvmRpcUrls } from '@/lib/server/evm-rpc'

export const DEFAULT_ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
})

export function getRobinhoodRpcUrls() {
  const alchemyKey = process.env.ALCHEMY_API_KEY?.trim()
  const fallbackUrl = alchemyKey
    ? `https://robinhood-mainnet.g.alchemy.com/v2/${alchemyKey}`
    : DEFAULT_ROBINHOOD_RPC_URL
  const raw = process.env.MAFITAPAY_ROBINHOOD_RPC_URLS?.trim()
    || process.env.MAFITAPAY_ROBINHOOD_RPC_URL?.trim()
    || fallbackUrl
  return sanitizeEvmRpcUrls(raw, fallbackUrl)
}
