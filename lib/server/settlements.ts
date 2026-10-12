import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  getAnyTransactionById,
  getDepositIntentByReference,
  getPayoutRequestByReference,
  insertAuditLog,
  markProviderEventProcessed,
  recordProviderEvent,
  resolvePendingTransaction,
  resolvePendingTransactionByReference,
  updateDepositIntentStatus,
  updatePayoutRequestStatus,
} from '@/lib/server/data'

async function guardSettlementTransition(input: {
  reference: string
  targetStatus: 'success' | 'failed'
  depositIntent: Awaited<ReturnType<typeof getDepositIntentByReference>>
  payoutRequest: Awaited<ReturnType<typeof getPayoutRequestByReference>>
}) {
  const settlementRecord = input.depositIntent ?? input.payoutRequest
  if (!settlementRecord) return { mode: 'fallback' as const, existing: null }

  const transaction = await getAnyTransactionById(settlementRecord.transactionId)
  if (!transaction) {
    throw new Error('Linked transaction not found.')
  }

  // Recover an older partial settlement where the intent was marked terminal before the
  // transaction and ledger finished. Resolve the still-pending transaction on webhook retry.
  if (settlementRecord.status !== 'pending' && settlementRecord.status !== input.targetStatus) {
    throw new Error(`Settlement record ${input.reference} is already ${settlementRecord.status}.`)
  }

  if (transaction.transaction.status !== 'pending') {
    if (transaction.transaction.status === input.targetStatus) {
      return { mode: 'already_settled' as const, existing: transaction }
    }
    throw new Error(`Transaction ${transaction.transaction.reference} is already ${transaction.transaction.status}.`)
  }

  if (settlementRecord.status === input.targetStatus) {
    return { mode: 'resolve' as const, existing: transaction }
  }

  return { mode: 'resolve' as const, existing: transaction }
}

export async function processSettlementEvent(input: {
  provider: string
  externalEventId: string
  reference: string
  status: 'success' | 'failed'
  providerReference?: string
  providerStatus?: string
  failureReason?: string
  payload?: Record<string, unknown>
}) {
  const recorded = await recordProviderEvent({
    externalEventId: input.externalEventId,
    provider: input.provider,
    reference: input.reference,
    status: input.status,
    failureReason: input.failureReason,
    payload: input.payload,
  })

  if (!recorded.inserted) {
    if (recorded.event.processedAt) return { duplicate: true, event: recorded.event }
    if (
      recorded.event.provider !== input.provider
      || recorded.event.reference !== input.reference
      || recorded.event.status !== input.status
    ) {
      throw new Error('Provider event ID was already used for a different settlement payload.')
    }
  }

  const [depositIntent, payoutRequest] = await Promise.all([
    getDepositIntentByReference(input.reference),
    getPayoutRequestByReference(input.reference),
  ])
  const transition = await guardSettlementTransition({
    reference: input.reference,
    targetStatus: input.status,
    depositIntent,
    payoutRequest,
  })

  if (transition.mode === 'already_settled' && transition.existing) {
    if (depositIntent) {
      await updateDepositIntentStatus(input.reference, input.status, input.providerReference, input.providerStatus, input.failureReason)
    } else if (payoutRequest) {
      await updatePayoutRequestStatus(input.reference, input.status, input.providerReference, input.providerStatus, input.failureReason)
    }
    await markProviderEventProcessed(input.externalEventId)
    return {
      duplicate: false,
      event: recorded.event,
      result: transition.existing,
      alreadySettled: true,
    }
  }

  let result
  if (depositIntent) {
    result = await resolvePendingTransaction(depositIntent.userId, depositIntent.transactionId, input.status)
    result = result ? { userId: depositIntent.userId, ...result } : null
    if (result?.transaction.status === input.status) {
      await updateDepositIntentStatus(input.reference, input.status, input.providerReference, input.providerStatus, input.failureReason)
    }
    await insertAuditLog({
      userId: depositIntent.userId,
      action: `deposit_intent.${input.status}_webhook`,
      entityType: 'deposit_intent',
      entityId: depositIntent.id,
      metadata: { reference: input.reference, externalEventId: input.externalEventId, provider: input.provider },
    })
  } else if (payoutRequest) {
    result = await resolvePendingTransaction(payoutRequest.userId, payoutRequest.transactionId, input.status)
    result = result ? { userId: payoutRequest.userId, ...result } : null
    if (result?.transaction.status === input.status) {
      await updatePayoutRequestStatus(input.reference, input.status, input.providerReference, input.providerStatus, input.failureReason)
    }
    await insertAuditLog({
      userId: payoutRequest.userId,
      action: `payout_request.${input.status}_webhook`,
      entityType: 'payout_request',
      entityId: payoutRequest.id,
      metadata: { reference: input.reference, externalEventId: input.externalEventId, provider: input.provider },
    })
  } else {
    result = await resolvePendingTransactionByReference(input.reference, input.status)
  }

  if (!result || result.transaction.status !== input.status) {
    throw new Error('Pending transaction not found.')
  }

  await markProviderEventProcessed(input.externalEventId)

  await appendNotification(result.userId, createNotification({
    userId: result.userId,
    title: input.status === 'success' ? 'Settlement confirmed' : 'Settlement failed',
    message:
      input.status === 'success'
        ? `${result.transaction.description} has been confirmed by the settlement provider.`
        : `${result.transaction.description} failed during settlement and any reserved funds were released.`,
    type: input.status === 'success' ? 'success' : 'error',
  }))

  return { duplicate: false, event: recorded.event, result }
}
