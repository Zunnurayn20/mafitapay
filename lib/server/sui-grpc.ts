import { SuiGrpcClient } from '@mysten/sui/grpc'

const DEFAULT_SUI_GRPC_URL = 'https://fullnode.mainnet.sui.io:443'

export function getSuiGrpcUrls() {
  const raw = (
    process.env.MAFITAPAY_SUI_GRPC_URLS?.trim()
    || process.env.MAFITAPAY_SUI_GRPC_URL?.trim()
    || process.env.MAFITAPAY_SUI_RPC_URLS?.trim()
    || process.env.MAFITAPAY_SUI_RPC_URL?.trim()
    || DEFAULT_SUI_GRPC_URL
  )

  const urls = raw.split(',').map(url => url.trim()).filter(Boolean)
  return urls.length > 0 ? urls : [DEFAULT_SUI_GRPC_URL]
}

export function createSuiGrpcClient(baseUrl: string) {
  return new SuiGrpcClient({ network: 'mainnet', baseUrl })
}
