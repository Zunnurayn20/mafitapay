import { getPayoutRequestByReference, insertAuditLog, markPayoutRequestSync, recordProviderEvent } from '@/lib/server/data'
import { retrieveFlutterwaveTransfer, mapFlutterwaveTransferStatus } from '@/lib/server/flutterwave-transfers'
import { processSettlementEvent } from '@/lib/server/settlements'

export async function syncFlutterwavePayout(reference: string, actorUserId?: string) {
  const payoutRequest = await getPayoutRequestByReference(reference)
  if (!payoutRequest) {
    throw new Error('Payout request not found.')
  }

  if (!payoutRequest.providerReference) {
    throw new Error('Payout request has no provider reference to sync.')
  }

  const transfer = await retrieveFlutterwaveTransfer(payoutRequest.providerReference)
  const normalized = mapFlutterwaveTransferStatus(transfer.rawStatus)

  if (!normalized) {
    const updated = await markPayoutRequestSync(reference, transfer.rawStatus, transfer.reason)
    await insertAuditLog({
      userId: payoutRequest.userId,
      actorUserId,
      action: 'payout_request.sync_checked',
      entityType: 'payout_request',
      entityId: payoutRequest.id,
      metadata: {
        reference,
        providerReference: payoutRequest.providerReference,
        providerStatus: transfer.rawStatus ?? null,
        reason: transfer.reason ?? null,
      },
    })
    return {
      reference,
      payoutRequest: updated,
      status: payoutRequest.status,
      providerStatus: transfer.rawStatus ?? null,
      providerReference: payoutRequest.providerReference,
      synced: false,
    }
  }

  try {
    const processed = await processSettlementEvent({
      provider: 'flutterwave',
      externalEventId: `sync:${payoutRequest.providerReference}`,
      reference,
      status: normalized,
      providerReference: payoutRequest.providerReference,
      providerStatus: transfer.rawStatus,
      failureReason: normalized === 'failed' ? transfer.reason : undefined,
      payload: transfer.payload,
    })

    await markPayoutRequestSync(reference, transfer.rawStatus, normalized === 'failed' ? transfer.reason : undefined)
    await insertAuditLog({
      userId: payoutRequest.userId,
      actorUserId,
      action: `payout_request.sync_${normalized}`,
      entityType: 'payout_request',
      entityId: payoutRequest.id,
      metadata: {
        reference,
        providerReference: payoutRequest.providerReference,
        providerStatus: transfer.rawStatus ?? null,
      },
    })

    return {
      reference,
      payoutRequest: await getPayoutRequestByReference(reference),
      status: normalized,
      providerStatus: transfer.rawStatus ?? null,
      providerReference: payoutRequest.providerReference,
      synced: true,
      duplicate: processed.duplicate,
    }
  } catch (error) {
    await markPayoutRequestSync(reference, transfer.rawStatus, error instanceof Error ? error.message : 'Payout sync failed.')
    await recordProviderEvent({
      externalEventId: `sync-check:${payoutRequest.providerReference}:${Date.now()}`,
      provider: 'flutterwave',
      reference,
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'Payout sync failed.',
      payload: transfer.payload,
    })
    throw error
  }
}
