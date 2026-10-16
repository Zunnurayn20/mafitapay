import { appendNotification, createNotification } from '@/lib/server/auth'
import { getTransactionByReference, insertAuditLog, markProviderEventProcessed, recordProviderEvent, resolvePendingTransactionByReference, updatePendingTransactionMetadata } from '@/lib/server/data'
import { mapFlutterwaveBillPaymentStatus, retrieveFlutterwaveBillPayment } from '@/lib/server/flutterwave-bills'

const inFlightBillSyncs = new Map<string, Promise<Awaited<ReturnType<typeof syncFlutterwaveBillOnce>>>>()

export function syncFlutterwaveBill(reference: string, actorUserId?: string) {
  const existing = inFlightBillSyncs.get(reference)
  if (existing) return existing

  const run = syncFlutterwaveBillOnce(reference, actorUserId).finally(() => {
    if (inFlightBillSyncs.get(reference) === run) inFlightBillSyncs.delete(reference)
  })
  inFlightBillSyncs.set(reference, run)
  return run
}

async function syncFlutterwaveBillOnce(reference: string, actorUserId?: string) {
  const match = await getTransactionByReference(reference)
  if (!match) {
    throw new Error('Bill transaction not found.')
  }

  const metadata = match.transaction.metadata ?? {}
  if (metadata.settlementKind !== 'provider_bill' || metadata.providerName !== 'flutterwave') {
    throw new Error('This bill is not awaiting Flutterwave settlement.')
  }
  if (match.transaction.status !== 'pending') {
    return {
      reference,
      synced: false,
      status: match.transaction.status,
      providerStatus: typeof metadata.providerStatus === 'string' ? metadata.providerStatus : null,
      providerReference: typeof metadata.providerReference === 'string' ? metadata.providerReference : reference,
    }
  }

  const providerReference = typeof metadata.providerReference === 'string' ? metadata.providerReference : ''
  if (!providerReference) {
    throw new Error('Bill transaction has no provider reference to sync.')
  }

  const bill = await retrieveFlutterwaveBillPayment(providerReference)
  const normalized = mapFlutterwaveBillPaymentStatus(bill.rawStatus)

  if (!normalized) {
    await updatePendingTransactionMetadata(match.userId, match.transaction.id, {
      ...metadata,
      providerStatus: bill.rawStatus ?? 'PENDING',
      providerLastSyncAt: new Date().toISOString(),
    })
    await insertAuditLog({
      userId: match.userId,
      actorUserId,
      action: 'bill_payment.sync_checked',
      entityType: 'transaction',
      entityId: match.transaction.id,
      metadata: {
        reference,
        providerReference,
        providerStatus: bill.rawStatus ?? null,
        reason: bill.reason ?? null,
      },
    })

    return {
      reference,
      synced: false,
      status: match.transaction.status,
      providerStatus: bill.rawStatus ?? null,
      providerReference,
    }
  }

  const eventId = `bill-sync:${providerReference}:${normalized}`
  const recorded = await recordProviderEvent({
    externalEventId: eventId,
    provider: 'flutterwave_bills',
    reference,
    status: normalized,
    failureReason: normalized === 'failed' ? bill.reason : undefined,
    payload: bill.payload,
  })

  const resolved = await resolvePendingTransactionByReference(reference, normalized)
  if (!resolved) {
    return {
      reference,
      synced: false,
      status: match.transaction.status,
      providerStatus: bill.rawStatus ?? null,
      providerReference,
      duplicate: !recorded.inserted,
    }
  }

  await markProviderEventProcessed(eventId)
  await insertAuditLog({
    userId: resolved.userId,
    actorUserId,
    action: `bill_payment.sync_${normalized}`,
    entityType: 'transaction',
    entityId: resolved.transaction.id,
    metadata: {
      reference,
      providerReference,
      providerStatus: bill.rawStatus ?? null,
    },
  })
  await appendNotification(resolved.userId, createNotification({
    userId: resolved.userId,
    title: normalized === 'success' ? 'Bill payment confirmed' : 'Bill payment failed',
    message: normalized === 'success'
      ? `${resolved.transaction.description} has been confirmed by Flutterwave.`
      : `${resolved.transaction.description} failed and reserved funds were released.`,
    type: normalized === 'success' ? 'success' : 'error',
  }))

  return {
    reference,
    synced: true,
    status: normalized,
    providerStatus: bill.rawStatus ?? null,
    providerReference,
    transaction: resolved.transaction,
  }
}
