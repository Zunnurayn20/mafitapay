import { isAddress } from 'viem'
import { getRoutedTreasuryPairConfigForAsset, getRoutedTreasuryPairConfig, isRoutedTreasuryPairId } from '@/lib/routed-assets'
import type { CryptoAsset, CryptoNetwork, CryptoPairId } from '@/types'

const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const SUI_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{1,64}$/
const TON_RAW_ADDRESS_PATTERN = /^-?\d+:[0-9a-fA-F]{64}$/
const TON_USER_FRIENDLY_ADDRESS_PATTERN = /^[A-Za-z0-9_-]{48}$/
const NEAR_IMPLICIT_ACCOUNT_PATTERN = /^[0-9a-f]{64}$/
const NEAR_NAMED_ACCOUNT_PATTERN = /^(?=.{2,64}$)(?!.*\.\.)(?!.*--)(?!.*__)[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/

function getCryptoNetworkForPair(pairId: CryptoPairId): CryptoNetwork {
  if (isRoutedTreasuryPairId(pairId)) {
    return getRoutedTreasuryPairConfig(pairId).network
  }

  switch (pairId) {
    case 'USDC_BASE':
    case 'ETH_BASE':
      return 'Base'
    case 'ETH_ETHEREUM':
      return 'Ethereum'
    case 'SUI_SUI':
      return 'Sui'
    case 'NEAR_NEAR':
      return 'NEAR'
    case 'TON_TON':
      return 'TON'
  }

  const parts = String(pairId).split('_')
  const inferredNetwork = parts[parts.length - 1]
  return inferredNetwork ? inferredNetwork[0].toUpperCase() + inferredNetwork.slice(1).toLowerCase() : 'Ethereum'
}

export function getWalletAddressPlaceholder(pairId: CryptoPairId) {
  const network = getCryptoNetworkForPair(pairId)
  if (network === 'Solana') return 'Paste Solana wallet address…'
  if (network === 'Sui') return 'Paste Sui wallet address…'
  if (network === 'TON') return 'Paste TON wallet address…'
  if (network === 'NEAR') return 'Paste NEAR wallet address…'
  return 'Paste 0x wallet address…'
}

export function getWalletAddressHint(pairId: CryptoPairId) {
  const network = getCryptoNetworkForPair(pairId)
  if (network === 'TON') {
    return 'Enter a valid TON wallet address in user-friendly or raw format.'
  }
  if (network === 'Sui') {
    return 'Enter a valid Sui wallet address starting with 0x.'
  }
  if (network === 'NEAR') {
    return 'Enter a valid NEAR account ID or implicit account address.'
  }
  return network === 'Solana'
    ? 'Enter a valid Solana wallet address for this asset.'
    : `Enter a valid ${network} EVM wallet address starting with 0x.`
}

export function validateWalletAddressForPair(pairId: CryptoPairId, walletAddress: string) {
  return validateWalletAddressForAsset({
    id: pairId,
    network: getCryptoNetworkForPair(pairId),
    executionRail: undefined,
  }, walletAddress)
}

export function validateWalletAddressForAsset(
  asset: Pick<CryptoAsset, 'id' | 'network' | 'executionRail' | 'routedToChain' | 'routedToToken' | 'routedDecimals' | 'routedAddressFamily' | 'minimumBuyNgn' | 'maxQuoteDriftPercent'>,
  walletAddress: string,
) {
  const trimmed = walletAddress.trim()
  if (!trimmed) {
    return {
      valid: false,
      error: 'Destination wallet address is required.',
    }
  }

  if (asset.executionRail === 'routed_treasury') {
    const routedConfig = getRoutedTreasuryPairConfigForAsset(asset)
    if (routedConfig.addressFamily === 'solana') {
      const valid = SOLANA_ADDRESS_PATTERN.test(trimmed)
      return {
        valid,
        error: valid ? undefined : 'Enter a valid Solana wallet address for this asset.',
      }
    }

    const valid = isAddress(trimmed)
    return {
      valid,
      error: valid ? undefined : `Enter a valid ${asset.network} wallet address starting with 0x.`,
    }
  }

  const network = asset.network
  if (network === 'Solana') {
    const valid = SOLANA_ADDRESS_PATTERN.test(trimmed)
    return {
      valid,
      error: valid ? undefined : 'Enter a valid Solana wallet address for this asset.',
    }
  }
  if (network === 'TON') {
    const valid = TON_USER_FRIENDLY_ADDRESS_PATTERN.test(trimmed) || TON_RAW_ADDRESS_PATTERN.test(trimmed)
    return {
      valid,
      error: valid ? undefined : 'Enter a valid TON wallet address in user-friendly or raw format.',
    }
  }
  if (network === 'Sui') {
    const valid = SUI_ADDRESS_PATTERN.test(trimmed)
    return {
      valid,
      error: valid ? undefined : 'Enter a valid Sui wallet address starting with 0x.',
    }
  }
  if (network === 'NEAR') {
    const normalized = trimmed.toLowerCase()
    const valid = NEAR_IMPLICIT_ACCOUNT_PATTERN.test(normalized) || NEAR_NAMED_ACCOUNT_PATTERN.test(normalized)
    return {
      valid,
      error: valid ? undefined : 'Enter a valid NEAR account ID or implicit account address.',
    }
  }

  const valid = isAddress(trimmed)
  return {
    valid,
    error: valid ? undefined : `Enter a valid ${network} wallet address starting with 0x.`,
  }
}
