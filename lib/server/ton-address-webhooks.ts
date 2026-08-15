import { Address as TonAddress } from '@ton/ton'
import { listCryptoDepositAddressesByFamily } from '@/lib/server/data'

const TONAPI_WEBHOOKS_BASE = 'https://rt.tonapi.io/webhooks'
const SUBSCRIBE_BATCH = 50

export function getTonWebhookId() {
  return process.env.MAFITAPAY_TON_WEBHOOK_ID?.trim() || ''
}

export function getTonWebhookToken() {
  return process.env.MAFITAPAY_TON_WEBHOOK_TOKEN?.trim() || ''
}

function getTonapiKey() {
  return process.env.MAFITAPAY_TONAPI_KEY?.trim() || ''
}

/** Friendly non-bounceable form stored on crypto_deposit_addresses. */
export function toStoredTonAddress(value: string) {
  return TonAddress.parse(value.trim()).toString({ bounceable: false, urlSafe: true })
}

/** Raw `workchain:hex` form TonAPI subscriptions and deliveries use. */
export function toTonAccountId(value: string) {
  return TonAddress.parse(value.trim()).toRawString()
}

export function isTonWebhookConfigured() {
  return Boolean(getTonapiKey() && getTonWebhookId() && getTonWebhookToken())
}

async function tonapiRequest(path: string, init: RequestInit) {
  const key = getTonapiKey()
  const webhookId = getTonWebhookId()
  if (!key || !webhookId) return { configured: false as const, status: 0, body: '' }

  const response = await fetch(`${TONAPI_WEBHOOKS_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  })
  const body = await response.text().catch(() => '')
  if (!response.ok) {
    throw new Error(`TonAPI webhook request failed (HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''})`)
  }
  return { configured: true as const, status: response.status, body }
}

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

/** Subscribe TON deposit addresses. Idempotent; no-ops when TonAPI is not configured. */
export async function subscribeCryptoDepositAddressesToTon(input: { tonAddresses?: string[] }) {
  const unique = [...new Set((input.tonAddresses ?? []).map(address => address.trim()).filter(Boolean))]
  if (!getTonapiKey() || !getTonWebhookId()) {
    return { configured: false, added: 0 }
  }
  if (unique.length === 0) return { configured: true, added: 0 }

  const accountIds: string[] = []
  for (const address of unique) {
    try {
      accountIds.push(toTonAccountId(address))
    } catch {
      console.warn('[ton-webhook] skipped unparseable TON deposit address')
    }
  }
  if (accountIds.length === 0) return { configured: true, added: 0 }

  const webhookId = getTonWebhookId()
  for (const batch of chunk(accountIds, SUBSCRIBE_BATCH)) {
    await tonapiRequest(`/${encodeURIComponent(webhookId)}/account-tx/subscribe`, {
      method: 'POST',
      body: JSON.stringify({
        accounts: batch.map(account_id => ({ account_id })),
      }),
    })
  }
  return { configured: true, added: accountIds.length }
}

/** Add every existing TON deposit address after webhook env is set in Railway. */
export async function syncAllCryptoDepositAddressesToTon() {
  const ton = await listCryptoDepositAddressesByFamily('ton')
  const result = await subscribeCryptoDepositAddressesToTon({
    tonAddresses: ton.map(item => item.address),
  })
  return {
    addresses: { ton: ton.length },
    webhook: result,
  }
}
