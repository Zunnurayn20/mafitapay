import { listCryptoDepositAddressesByFamily } from '@/lib/server/data'
import type { CryptoDepositAddressFamily } from '@/types'

type AlchemyWebhookChain = 'base' | 'bsc' | 'polygon' | 'robinhood' | 'solana'

const WEBHOOK_ID_ENV: Record<AlchemyWebhookChain, string> = {
  base: 'MAFITAPAY_ALCHEMY_WEBHOOK_BASE_ID',
  bsc: 'MAFITAPAY_ALCHEMY_WEBHOOK_BSC_ID',
  polygon: 'MAFITAPAY_ALCHEMY_WEBHOOK_POLYGON_ID',
  robinhood: 'MAFITAPAY_ALCHEMY_WEBHOOK_ROBINHOOD_ID',
  solana: 'MAFITAPAY_ALCHEMY_WEBHOOK_SOLANA_ID',
}

const CHAIN_BY_NETWORK: Record<string, AlchemyWebhookChain> = {
  BASE_MAINNET: 'base',
  BNB_MAINNET: 'bsc',
  BSC_MAINNET: 'bsc',
  MATIC_MAINNET: 'polygon',
  POLYGON_MAINNET: 'polygon',
  ROBINHOOD_MAINNET: 'robinhood',
  SOLANA_MAINNET: 'solana',
}

export function getAlchemyWebhookId(chain: AlchemyWebhookChain) {
  return process.env[WEBHOOK_ID_ENV[chain]]?.trim() || ''
}

export function getAlchemyWebhookSigningKey(webhookId: unknown) {
  const chain = getAlchemyWebhookChain({ webhookId })
  if (chain) {
    const chainKey = process.env[`MAFITAPAY_ALCHEMY_WEBHOOK_${chain.toUpperCase()}_SIGNING_KEY`]?.trim()
    if (chainKey) return chainKey
  }
  // Retained for a single-webhook installation and for a gradual Railway rollout.
  return process.env.MAFITAPAY_ALCHEMY_WEBHOOK_SIGNING_KEY?.trim() || ''
}

export function getAlchemyWebhookChain(input: { webhookId?: unknown; network?: unknown }): AlchemyWebhookChain | null {
  const webhookId = typeof input.webhookId === 'string' ? input.webhookId.trim() : ''
  if (webhookId) {
    for (const chain of Object.keys(WEBHOOK_ID_ENV) as AlchemyWebhookChain[]) {
      if (webhookId === getAlchemyWebhookId(chain)) return chain
    }
    // A configured webhook ID is the source of truth. Do not trust a claimed network from an
    // otherwise unknown sender, even after its signature has been checked.
    return null
  }

  const network = typeof input.network === 'string' ? input.network.trim().toUpperCase() : ''
  return CHAIN_BY_NETWORK[network] ?? null
}

function getAlchemyAuthToken() {
  return process.env.MAFITAPAY_ALCHEMY_AUTH_TOKEN?.trim() || ''
}

async function addAddressesToWebhook(webhookId: string, addresses: string[]) {
  const token = getAlchemyAuthToken()
  if (!token || !webhookId || addresses.length === 0) return { configured: false, added: 0 }

  const response = await fetch('https://dashboard.alchemy.com/api/update-webhook-addresses', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Alchemy-Token': token,
    },
    body: JSON.stringify({ webhook_id: webhookId, addresses_to_add: addresses, addresses_to_remove: [] }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Alchemy address subscription failed (HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''})`)
  }
  return { configured: true, added: addresses.length }
}

/** Subscribe deposit addresses to every configured chain webhook. This API is idempotent. */
export async function subscribeCryptoDepositAddressesToAlchemy(input: {
  evmAddresses?: string[]
  solanaAddresses?: string[]
}) {
  const evmAddresses = [...new Set((input.evmAddresses ?? []).map(address => address.trim()).filter(Boolean))]
  const solanaAddresses = [...new Set((input.solanaAddresses ?? []).map(address => address.trim()).filter(Boolean))]
  const results: Partial<Record<AlchemyWebhookChain, { configured: boolean; added: number }>> = {}

  await Promise.all((['base', 'bsc', 'polygon', 'robinhood'] as const).map(async (chain) => {
    results[chain] = await addAddressesToWebhook(getAlchemyWebhookId(chain), evmAddresses)
  }))
  results.solana = await addAddressesToWebhook(getAlchemyWebhookId('solana'), solanaAddresses)
  return results
}

/** Add all pre-existing customer addresses after webhook IDs are configured in Railway. */
export async function syncAllCryptoDepositAddressesToAlchemy() {
  const [evm, solana] = await Promise.all([
    listCryptoDepositAddressesByFamily('evm' as CryptoDepositAddressFamily),
    listCryptoDepositAddressesByFamily('solana' as CryptoDepositAddressFamily),
  ])
  const result = await subscribeCryptoDepositAddressesToAlchemy({
    evmAddresses: evm.map(item => item.address),
    solanaAddresses: solana.map(item => item.address),
  })
  return {
    addresses: { evm: evm.length, solana: solana.length },
    webhooks: result,
  }
}
