import { appendNotification, createNotification } from '@/lib/server/auth'
import { insertAuditLog, recordProviderEvent, resolvePendingTransaction, updatePayoutRequestStatus } from '@/lib/server/data'
import { initiateFlutterwaveBankTransfer, isFlutterwavePayoutEnabled } from '@/lib/server/flutterwave-transfers'
import { ensureFlutterwavePayoutSyncScheduler, kickPendingFlutterwavePayoutSync } from '@/lib/server/payout-sync-batch'
import { processSettlementEvent } from '@/lib/server/settlements'
import type { Transaction } from '@/types'

export async function executeBankPayout(input: {
  userId: string
  transaction: Transaction
  amount: number
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
  narration?: string
}) {
  if (!isFlutterwavePayoutEnabled()) {
    return { mode: 'deferred' as const }
  }

  const payout = await initiateFlutterwaveBankTransfer({
    amount: input.amount,
    reference: input.transaction.reference,
    narration: input.narration || input.transaction.description,
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
    accountName: input.accountName,
  })

  if (payout.status === 'failed') {
    await updatePayoutRequestStatus(input.transaction.reference, 'failed', payout.providerReference, payout.rawStatus, payout.reason)
    await recordProviderEvent({
      externalEventId: `init:${input.transaction.reference}`,
      provider: payout.provider,
      reference: input.transaction.reference,
      status: 'failed',
      failureReason: payout.reason,
      payload: payout.payload,
    })
    const released = await resolvePendingTransaction(input.userId, input.transaction.id, 'failed')
    await insertAuditLog({
      userId: input.userId,
      action: 'payout_request.initiation_failed',
      entityType: 'transaction',
      entityId: input.transaction.id,
      metadata: {
        reference: input.transaction.reference,
        provider: payout.provider,
        providerReference: payout.providerReference ?? null,
        reason: payout.reason ?? null,
      },
    })
    await appendNotification(input.userId, createNotification({
      userId: input.userId,
      title: 'Payout failed',
      message: `${input.transaction.description} could not be initiated with Flutterwave and reserved funds were released.`,
      type: 'error',
    }))
    return {
      mode: 'failed' as const,
      payout,
      released,
    }
  }

  if (payout.status === 'success') {
    const settled = await processSettlementEvent({
      provider: payout.provider,
      externalEventId: `init-success:${input.transaction.reference}`,
      reference: input.transaction.reference,
      status: 'success',
      providerReference: payout.providerReference,
      providerStatus: payout.rawStatus,
      payload: payout.payload,
    })
    await insertAuditLog({
      userId: input.userId,
      action: 'payout_request.initiation_success',
      entityType: 'transaction',
      entityId: input.transaction.id,
      metadata: {
        reference: input.transaction.reference,
        provider: payout.provider,
        providerReference: payout.providerReference ?? null,
        rawStatus: payout.rawStatus ?? null,
      },
    })
    ensureFlutterwavePayoutSyncScheduler()
    return {
      mode: 'success' as const,
      payout,
      settled: settled.result,
    }
  }

  await updatePayoutRequestStatus(input.transaction.reference, 'pending', payout.providerReference, payout.rawStatus)
  await recordProviderEvent({
    externalEventId: `init:${input.transaction.reference}`,
    provider: payout.provider,
    reference: input.transaction.reference,
    status: 'pending',
    payload: payout.payload,
  })
  await insertAuditLog({
    userId: input.userId,
    action: 'payout_request.initiated',
    entityType: 'transaction',
    entityId: input.transaction.id,
    metadata: {
      reference: input.transaction.reference,
      provider: payout.provider,
      providerReference: payout.providerReference ?? null,
      rawStatus: payout.rawStatus ?? null,
    },
  })

  // Initiation answers NEW. Settlement arrives later, by webhook or by retrieving the transfer.
  // Arm the retriever here so a bank transfer does not stay pending until an admin syncs it.
  ensureFlutterwavePayoutSyncScheduler()
  void kickPendingFlutterwavePayoutSync().catch(() => null)

  return {
    mode: 'initiated' as const,
    payout,
  }
}
