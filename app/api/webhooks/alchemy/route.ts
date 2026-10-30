import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCryptoDepositAddressByAddress } from '@/lib/server/data'
import { forceScanDepositAddress, processAlchemyErc20Activity } from '@/lib/server/crypto-deposit-scanner'
import { getAlchemyWebhookChain, getAlchemyWebhookSigningKey, getSolanaDepositAddressMap } from '@/lib/server/alchemy-address-webhooks'

export const runtime = 'nodejs'

type AlchemyActivity = {
  toAddress?: unknown
  rawContract?: { address?: unknown }
  blockNum?: unknown
  log?: {
    address?: unknown
    topics?: unknown
    data?: unknown
    blockNumber?: unknown
    transactionHash?: unknown
    logIndex?: unknown
    removed?: unknown
  }
}

type AlchemyPayload = {
  webhookId?: unknown
  event?: {
    network?: unknown
    activity?: unknown
  }
}

function isValidSignature(rawBody: string, signature: string | null, signingKey: string) {
  if (!signingKey || !signature) return false
  const expected = createHmac('sha256', signingKey).update(rawBody, 'utf8').digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  let payload: AlchemyPayload
  try {
    payload = JSON.parse(rawBody) as AlchemyPayload
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 })
  }

  // The untrusted webhook ID is used only to choose its configured signing key; the raw body is
  // then authenticated before any event data is acted upon.
  if (!isValidSignature(rawBody, request.headers.get('x-alchemy-signature'), getAlchemyWebhookSigningKey(payload.webhookId))) {
    console.warn('[alchemy-webhook] rejected request with invalid signature')
    return NextResponse.json({ success: false, error: 'Invalid webhook signature.' }, { status: 401 })
  }

  const chain = getAlchemyWebhookChain({
    webhookId: payload.webhookId,
    network: payload.event?.network,
  })
  if (!chain) {
    console.warn('[alchemy-webhook] ignored event from an unconfigured webhook')
    return NextResponse.json({ success: true, ignored: true })
  }

  const activity = Array.isArray(payload.event?.activity) ? payload.event.activity as AlchemyActivity[] : []
  const addresses = [...new Set(activity
    .map(item => typeof item?.toAddress === 'string' ? item.toAddress.trim() : '')
    .filter(Boolean))]
  const solanaAddressMap = chain === 'solana' ? await getSolanaDepositAddressMap() : null

  if (chain === 'solana' && addresses.length === 0) {
    const first = activity[0] && typeof activity[0] === 'object' ? activity[0] as Record<string, unknown> : null
    console.warn('[alchemy-webhook] Solana activity had no destination address', {
      activityCount: activity.length,
      firstActivityFields: first ? Object.keys(first).sort().join(',') : '',
    })
  }

  let scanned = 0
  let ignored = 0
  let processedFromWebhook = 0
  const webhookProcessedAddresses = new Set<string>()
  for (const item of activity) {
    const address = typeof item?.toAddress === 'string' ? item.toAddress.trim() : ''
    if (!address) continue
    const record = chain === 'solana'
      ? solanaAddressMap?.get(address) ?? null
      : await getCryptoDepositAddressByAddress(address)
    if (!record || record.addressFamily !== 'evm') continue
    try {
      const result = await processAlchemyErc20Activity({ address: record.address, chain, activity: item })
      if (result.processed) {
        processedFromWebhook += 1
        webhookProcessedAddresses.add(record.address.toLowerCase())
      }
    } catch (error) {
      console.error('[alchemy-webhook] signed transfer processing failed', {
        chain,
        address: record.address,
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json({ success: false, error: 'Deposit processing failed; please retry.' }, { status: 500 })
    }
  }

  for (const address of addresses) {
    // Address Activity includes outbound activity too. Only scan a known receiving address.
    const record = chain === 'solana'
      ? solanaAddressMap?.get(address) ?? null
      : await getCryptoDepositAddressByAddress(address)
    if (!record) {
      ignored += 1
      continue
    }
    const expectedFamily = chain === 'solana' ? 'solana' : 'evm'
    if (record.addressFamily !== expectedFamily) {
      ignored += 1
      continue
    }
    if (webhookProcessedAddresses.has(record.address.toLowerCase())) continue
    try {
      await forceScanDepositAddress({ address: record.address, chain, backgroundReconcile: false })
      scanned += 1
    } catch (error) {
      // Return 500 so Alchemy retries a genuine processing failure. Database event IDs make a
      // retried delivery safe and prevent duplicate NGN crediting.
      console.error('[alchemy-webhook] deposit scan failed', { chain, address: record.address, error: error instanceof Error ? error.message : String(error) })
      return NextResponse.json({ success: false, error: 'Deposit processing failed; please retry.' }, { status: 500 })
    }
  }

  console.log(`[alchemy-webhook] processed chain=${chain} receivingAddresses=${addresses.length} webhookTransfers=${processedFromWebhook} scanned=${scanned} ignored=${ignored}`)
  return NextResponse.json({ success: true, webhookTransfers: processedFromWebhook, scanned, ignored })
}
