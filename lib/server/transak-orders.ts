import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  getCryptoOrderByProviderOrderId,
  getCryptoOrderByProviderReference,
  insertAuditLog,
  markProviderEventProcessed,
  recordProviderEvent,
  updateCryptoOrderProviderState,
  updateTransactionStatus,
} from '@/lib/server/data'
import { getTransakOrderByPartnerOrderId, mapTransakStatusToLocalOrderStatus, type TransakOrderSnapshot } from '@/lib/server/transak'

function normalizeWebhookPayload(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : payload
  const providerOrderId =
    typeof data._id === 'string' ? data._id
    : typeof data.orderId === 'string' ? data.orderId
      : ''
  const partnerOrderId =
    typeof data.partnerOrderId === 'string' ? data.partnerOrderId
    : typeof payload.partnerOrderId === 'string' ? payload.partnerOrderId
      : ''
  const status =
    typeof data.status === 'string' ? data.status
    : typeof payload.status === 'string' ? payload.status
      : ''
  const eventId =
    typeof payload.eventID === 'string' ? payload.eventID
    : typeof payload.eventId === 'string' ? payload.eventId
      : typeof payload.id === 'string' ? payload.id
        : `transak:${providerOrderId || partnerOrderId}:${status || 'update'}`

  const raw: Record<string, unknown> = data

  const snapshot: TransakOrderSnapshot | null = providerOrderId
    ? {
        providerOrderId,
        partnerOrderId: partnerOrderId || undefined,
        status: status || 'PROCESSING',
        cryptoAmount: typeof raw.cryptoAmount === 'number' ? raw.cryptoAmount : undefined,
        fiatAmount: typeof raw.fiatAmount === 'number' ? raw.fiatAmount : undefined,
        walletAddress: typeof raw.walletAddress === 'string' ? raw.walletAddress : undefined,
        network: typeof raw.network === 'string' ? raw.network : undefined,
        cryptoCurrency: typeof raw.cryptoCurrency === 'string' ? raw.cryptoCurrency : undefined,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
        txHash: typeof raw.txHash === 'string' ? raw.txHash : undefined,
        raw,
      }
    : null

  return {
    eventId,
    snapshot,
    partnerOrderId,
    providerOrderId,
    status,
  }
}

async function applyTransakSnapshot(order: Awaited<ReturnType<typeof getCryptoOrderByProviderReference>>, snapshot: TransakOrderSnapshot, source: 'webhook' | 'manual_sync') {
  if (!order) {
    return { applied: false as const, reason: 'Crypto order not found.' }
  }

  const localStatus = mapTransakStatusToLocalOrderStatus(snapshot.status)
  const updatedOrder = await updateCryptoOrderProviderState({
    id: order.id,
    provider: 'transak',
    providerOrderId: snapshot.providerOrderId,
    providerStatus: snapshot.status,
    providerReference: snapshot.partnerOrderId ?? order.providerReference ?? undefined,
    providerPayload: snapshot.raw,
    webhookReceivedAt: source === 'webhook' ? new Date().toISOString() : undefined,
    status: localStatus,
  })

  const terminal = localStatus === 'fulfilled' || localStatus === 'failed' || localStatus === 'expired'
  const updatedTransaction = terminal
    ? await updateTransactionStatus(order.userId, order.transactionId, localStatus === 'fulfilled' ? 'success' : 'failed')
    : null

  if (terminal) {
    await appendNotification(order.userId, createNotification({
      userId: order.userId,
      title: localStatus === 'fulfilled' ? 'Crypto order fulfilled' : 'Crypto order closed',
      message:
        localStatus === 'fulfilled'
          ? `Your Transak ${order.side} order for ${order.pairId} has completed successfully.`
          : `Your Transak ${order.side} order for ${order.pairId} closed as ${localStatus}.`,
      type: localStatus === 'fulfilled' ? 'success' : 'error',
    }))
  }

  await insertAuditLog({
    userId: order.userId,
    action: `crypto_order.transak_${source}`,
    entityType: 'crypto_order',
    entityId: order.id,
    metadata: {
      transactionId: order.transactionId,
      providerOrderId: snapshot.providerOrderId,
      providerReference: snapshot.partnerOrderId ?? order.providerReference ?? null,
      providerStatus: snapshot.status,
      localStatus,
      source,
    },
  })

  return {
    applied: true as const,
    order: updatedOrder,
    transaction: updatedTransaction,
  }
}

export async function syncTransakOrderByPartnerReference(partnerOrderId: string) {
  const order = await getCryptoOrderByProviderReference(partnerOrderId)
  if (!order) {
    throw new Error('Crypto order not found.')
  }

  const snapshot = await getTransakOrderByPartnerOrderId(partnerOrderId)
  if (!snapshot) {
    throw new Error('Transak order not found.')
  }

  const eventId = `transak-sync:${snapshot.providerOrderId}:${snapshot.status}`
  const { inserted } = await recordProviderEvent({
    externalEventId: eventId,
    provider: 'transak',
    reference: partnerOrderId,
    status: snapshot.status,
    payload: snapshot.raw,
  })

  const result = await applyTransakSnapshot(order, snapshot, 'manual_sync')
  if (inserted) {
    await markProviderEventProcessed(eventId)
  }

  return {
    snapshot,
    ...result,
  }
}

export async function handleTransakWebhookPayload(payload: Record<string, unknown>) {
  const normalized = normalizeWebhookPayload(payload)
  const partnerReference = normalized.partnerOrderId || normalized.providerOrderId
  if (!partnerReference || !normalized.snapshot) {
    return { body: { error: 'Invalid Transak webhook payload.', success: false }, status: 400 as const }
  }

  const event = await recordProviderEvent({
    externalEventId: normalized.eventId,
    provider: 'transak',
    reference: partnerReference,
    status: normalized.status || normalized.snapshot.status,
    payload,
  })

  if (!event.inserted) {
    return { body: { data: { duplicate: true }, success: true }, status: 200 as const }
  }

  const order = normalized.providerOrderId
    ? await getCryptoOrderByProviderOrderId(normalized.providerOrderId)
    : await getCryptoOrderByProviderReference(partnerReference)

  const result = await applyTransakSnapshot(order, normalized.snapshot, 'webhook')
  await markProviderEventProcessed(normalized.eventId)

  return {
    body: {
      data: {
        reference: partnerReference,
        ...result,
      },
      success: true,
    },
    status: 200 as const,
  }
}
