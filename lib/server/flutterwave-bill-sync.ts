import { appendNotification, createNotification } from '@/lib/server/auth'
import { getTransactionByReference, insertAuditLog, markProviderEventProcessed, recordProviderEvent, resolvePendingTransactionByReference } from '@/lib/server/data'
import { mapFlutterwaveBillPaymentStatus, retrieveFlutterwaveBillPayment } from '@/lib/server/flutterwave-bills'

export async function syncFlutterwaveBill(reference: string, actorUserId?: string) {
  const match = await getTransactionByReference(reference)
  if (!match) {
    throw new Error('Bill transaction not found.')
  }

  const metadata = match.transaction.metadata ?? {}
  const providerReference = typeof metadata.providerReference === 'string' ? metadata.providerReference : ''
  if (!providerReference) {
    throw new Error('Bill transaction has no provider reference to sync.')
  }

  const bill = await retrieveFlutterwaveBillPayment(providerReference)
  const normalized = mapFlutterwaveBillPaymentStatus(bill.rawStatus)

  if (!normalized) {
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
