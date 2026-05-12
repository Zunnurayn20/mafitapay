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

  if (settlementRecord.status !== 'pending') {
    const transaction = await getAnyTransactionById(settlementRecord.transactionId)
    if (settlementRecord.status === input.targetStatus && transaction) {
      return { mode: 'already_settled' as const, existing: transaction }
    }
    throw new Error(`Settlement record ${input.reference} is already ${settlementRecord.status}.`)
  }

  const transaction = await getAnyTransactionById(settlementRecord.transactionId)
  if (!transaction) {
    throw new Error('Linked transaction not found.')
  }

  if (transaction.transaction.status !== 'pending') {
    if (transaction.transaction.status === input.targetStatus) {
      return { mode: 'already_settled' as const, existing: transaction }
    }
    throw new Error(`Transaction ${transaction.transaction.reference} is already ${transaction.transaction.status}.`)
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
    return { duplicate: true, event: recorded.event }
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
    await updateDepositIntentStatus(input.reference, input.status, input.providerReference, input.providerStatus, input.failureReason)
    result = await resolvePendingTransaction(depositIntent.userId, depositIntent.transactionId, input.status)
    result = result ? { userId: depositIntent.userId, ...result } : null
    await insertAuditLog({
      userId: depositIntent.userId,
      action: `deposit_intent.${input.status}_webhook`,
      entityType: 'deposit_intent',
      entityId: depositIntent.id,
      metadata: { reference: input.reference, externalEventId: input.externalEventId, provider: input.provider },
    })
  } else if (payoutRequest) {
    await updatePayoutRequestStatus(input.reference, input.status, input.providerReference, input.providerStatus, input.failureReason)
    result = await resolvePendingTransaction(payoutRequest.userId, payoutRequest.transactionId, input.status)
    result = result ? { userId: payoutRequest.userId, ...result } : null
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

  if (!result) {
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
