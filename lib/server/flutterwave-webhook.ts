import { mapFlutterwaveChargeStatus } from '@/lib/server/flutterwave-collections'
import { mapFlutterwaveBillPaymentStatus } from '@/lib/server/flutterwave-bills'
import { mapFlutterwaveTransferStatus, verifyFlutterwaveWebhook } from '@/lib/server/flutterwave-transfers'
import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  createSettledDepositFromProvider,
  getTransactionByReference,
  getUserByEmail,
  insertAuditLog,
  markProviderEventProcessed,
  recordProviderEvent,
  resolvePendingTransactionByReference,
} from '@/lib/server/data'
import { processSettlementEvent } from '@/lib/server/settlements'

const MAX_DEPOSIT_FEE = 100

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function handleFlutterwaveWebhook(input: {
  rawBody: string
  signature?: string | null
  skipSignatureVerification?: boolean
  source?: 'public_webhook' | 'admin_test'
}) {
  if (!input.skipSignatureVerification && !verifyFlutterwaveWebhook(input.rawBody, input.signature ?? null)) {
    return { body: { error: 'Unauthorized webhook request.', success: false }, status: 401 as const }
  }

  const parsed = JSON.parse(input.rawBody) as unknown
  const body = isRecord(parsed) ? parsed : {}
  const eventType = readString(body.event)
  const data = isRecord(body.data) ? body.data : {}

  let reference = ''
  let externalEventId = ''
  let providerReference: string | undefined
  let failureReason: string | undefined
  let rawStatus = ''
  let status: 'success' | 'failed' | null = null

  if (eventType === 'transfer.disburse') {
    reference = readString(data.reference)
    externalEventId = readString(data.id) || readString(body.id) || `${eventType}:${reference}`
    providerReference = readString(data.id) || undefined
    failureReason = readString(data.complete_message) || readString(data.narration) || undefined
    rawStatus = readString(data.status)
    status = mapFlutterwaveTransferStatus(rawStatus)
  } else if (eventType === 'charge.completed' && readString(data.payment_type) === 'bank_transfer') {
    reference = readString(data.tx_ref)
    externalEventId = readString(data.id) || readString(data.flw_ref) || `${eventType}:${reference}`
    providerReference = readString(data.flw_ref) || readString(data.id) || undefined
    failureReason = readString(data.processor_response) || readString(data.narration) || undefined
    rawStatus = readString(data.status)
    status = mapFlutterwaveChargeStatus(rawStatus)
  } else if (
    (eventType.toLowerCase().includes('bill') || eventType.toLowerCase().includes('payment'))
    && (readString(data.reference) || readString(body.reference))
  ) {
    reference = readString(data.reference) || readString(body.reference)
    externalEventId = readString(data.id) || readString(body.id) || `${eventType}:${reference}`
    providerReference = readString(data.id) || reference || undefined
    failureReason = readString(data.message) || readString(body.message) || undefined
    rawStatus = readString(data.status) || readString(body.status)
    status = mapFlutterwaveBillPaymentStatus(rawStatus)
  } else {
    return { body: { data: { ignored: true, eventType }, success: true }, status: 200 as const }
  }

  if (!reference || !externalEventId || !status) {
    return { body: { error: 'Invalid Flutterwave webhook payload.', success: false }, status: 400 as const }
  }

  try {
    if (eventType === 'charge.completed') {
      const customer = isRecord(data.customer) ? data.customer : {}
      const customerEmail = readString(customer.email)

      if (reference.startsWith('static_va_') && customerEmail) {
        const recorded = await recordProviderEvent({
          externalEventId,
          provider: 'flutterwave',
          reference: providerReference || reference,
          status,
          failureReason: status === 'failed' ? failureReason : undefined,
          payload: body,
        })
        if (!recorded.inserted) {
          return { body: { data: { duplicate: true, event: recorded.event }, success: true }, status: 200 as const }
        }

        const user = await getUserByEmail(customerEmail)
        if (!user) {
          return { body: { error: 'Deposit customer could not be matched to a user.', success: false }, status: 404 as const }
        }

        const grossAmount = Number(data.amount)
        if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
          return { body: { error: 'Invalid Flutterwave deposit amount.', success: false }, status: 400 as const }
        }

        const uniqueReference = providerReference || reference
        const duplicateProviderRef = await getTransactionByReference(uniqueReference)
        if (duplicateProviderRef?.transaction) {
          return { body: { data: { duplicate: true, transaction: duplicateProviderRef.transaction }, success: true }, status: 200 as const }
        }

        if (status === 'failed') {
          return { body: { data: { ignored: true, status }, success: true }, status: 200 as const }
        }

        const fee = Math.min(MAX_DEPOSIT_FEE, Math.round(grossAmount * 0.02))
        const deposit = await createSettledDepositFromProvider({
          userId: user.id,
          reference: uniqueReference,
          provider: 'flutterwave_virtual_account',
          providerReference,
          providerStatus: rawStatus || undefined,
          grossAmount,
          fee,
          fundingMethod: 'virtual_account_static',
          accountNumber: readString(data.account_number),
          bankName: readString(data.bank_name),
          accountName: readString(data.narration) || `${user.name.trim()} MAFITAPAY`,
          metadata: {
            txRef: reference,
            paymentType: readString(data.payment_type),
            webhookSource: input.source ?? 'public_webhook',
            walletAsset: 'NGN',
          },
        })

        await insertAuditLog({
          userId: user.id,
          action: 'deposit_intent.success_webhook',
          entityType: 'deposit_intent',
          entityId: deposit.depositIntent.id,
          metadata: { reference: uniqueReference, externalEventId, provider: 'flutterwave', source: input.source ?? 'public_webhook' },
        })
        await markProviderEventProcessed(externalEventId)

        await appendNotification(user.id, createNotification({
          userId: user.id,
          title: 'Deposit confirmed',
          message: `${deposit.transaction.description} has been confirmed by Flutterwave.`,
          type: 'success',
        }))

        return { body: { data: deposit.transaction, success: true }, status: 200 as const }
      }

      const existingByReference = await getTransactionByReference(reference)
      if (existingByReference?.transaction) {
        const metadata = existingByReference.transaction.metadata ?? {}
        if (metadata.settlementKind === 'provider_bill' && existingByReference.transaction.status === 'pending') {
          const recorded = await recordProviderEvent({
            externalEventId,
            provider: 'flutterwave_bills',
            reference,
            status,
            failureReason: status === 'failed' ? failureReason : undefined,
            payload: body,
          })
          if (!recorded.inserted) {
            return { body: { data: { duplicate: true, event: recorded.event }, success: true }, status: 200 as const }
          }

          const resolved = await resolvePendingTransactionByReference(reference, status)
          if (resolved) {
            await markProviderEventProcessed(externalEventId)
            await appendNotification(resolved.userId, createNotification({
              userId: resolved.userId,
              title: status === 'success' ? 'Bill payment confirmed' : 'Bill payment failed',
              message: status === 'success'
                ? `${resolved.transaction.description} has been confirmed by Flutterwave.`
                : `${resolved.transaction.description} failed and reserved funds were released.`,
              type: status === 'success' ? 'success' : 'error',
            }))
            return { body: { data: resolved.transaction, success: true }, status: 200 as const }
          }
        }

        return { body: { data: { duplicate: true, transaction: existingByReference.transaction }, success: true }, status: 200 as const }
      }
    }

    const processed = await processSettlementEvent({
      provider: 'flutterwave',
      externalEventId,
      reference,
      status,
      providerReference,
      providerStatus: rawStatus || undefined,
      failureReason: status === 'failed' ? failureReason : undefined,
      payload: body,
    })

    if (processed.duplicate) {
      return { body: { data: { duplicate: true, event: processed.event }, success: true }, status: 200 as const }
    }

    return { body: { data: processed.result, success: true }, status: 200 as const }
  } catch (error) {
    return {
      body: { error: error instanceof Error ? error.message : 'Settlement processing failed.', success: false },
      status: 404 as const,
    }
  }
}
