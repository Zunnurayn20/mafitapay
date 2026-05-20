import { mapFlutterwaveChargeStatus, verifyFlutterwaveTransaction, verifyFlutterwaveTransactionByReference } from '@/lib/server/flutterwave-collections'
import { mapFlutterwaveBillPaymentStatus } from '@/lib/server/flutterwave-bills'
import { mapFlutterwaveTransferStatus, verifyFlutterwaveWebhook } from '@/lib/server/flutterwave-transfers'
import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  createSettledDepositFromProvider,
  getTransactionByReference,
  getUserByEmail,
  getUserByVirtualAccountNumber,
  insertAuditLog,
  markProviderEventProcessed,
  recordProviderEvent,
  resolvePendingTransactionByReference,
} from '@/lib/server/data'
import { processSettlementEvent } from '@/lib/server/settlements'

const FLUTTERWAVE_WEBHOOK_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_FLUTTERWAVE === '1'

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function logFlutterwaveWebhook(event: string, payload: Record<string, unknown>) {
  if (!FLUTTERWAVE_WEBHOOK_LOGGING_ENABLED) return
  console.log(`[flutterwave-webhook] ${event}`, JSON.stringify(payload))
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function resolveVerifiedFlutterwaveDeposit(params: {
  transactionId?: string
  reference: string
}) {
  const attempts = 4
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const byId = params.transactionId
      ? await verifyFlutterwaveTransaction(params.transactionId).catch(() => null)
      : null
    const byReference = byId?.amountSettled == null
      ? await verifyFlutterwaveTransactionByReference(params.reference).catch(() => null)
      : null
    const verified = byId ?? byReference

    logFlutterwaveWebhook('static-va.verify', {
      reference: params.reference,
      transactionId: params.transactionId ?? null,
      attempt,
      byIdFound: Boolean(byId),
      byReferenceFound: Boolean(byReference),
      amount: verified?.amount ?? null,
      chargedAmount: verified?.chargedAmount ?? null,
      amountSettled: verified?.amountSettled ?? null,
      appFee: verified?.appFee ?? null,
      merchantFee: verified?.merchantFee ?? null,
      status: verified?.status ?? null,
    })

    if (verified?.amountSettled != null && verified.amountSettled > 0) {
      return verified
    }

    if (attempt < attempts) {
      await sleep(1500)
    }
  }

  return null
}

export async function handleFlutterwaveWebhook(input: {
  rawBody: string
  signature?: string | null
  skipSignatureVerification?: boolean
  source?: 'public_webhook' | 'admin_test'
}) {
  const signatureValid = input.skipSignatureVerification || verifyFlutterwaveWebhook(input.rawBody, input.signature ?? null)
  if (!signatureValid) {
    logFlutterwaveWebhook('signature.invalid', {
      source: input.source ?? 'public_webhook',
      hasSignature: Boolean(input.signature),
      bodyLength: input.rawBody.length,
    })
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
    logFlutterwaveWebhook('ignored', {
      source: input.source ?? 'public_webhook',
      eventType,
    })
    return { body: { data: { ignored: true, eventType }, success: true }, status: 200 as const }
  }

  logFlutterwaveWebhook('parsed', {
    source: input.source ?? 'public_webhook',
    eventType,
    reference,
    externalEventId,
    providerReference: providerReference ?? null,
    rawStatus,
    mappedStatus: status,
  })

  if (!reference || !externalEventId || !status) {
    logFlutterwaveWebhook('payload.invalid', {
      source: input.source ?? 'public_webhook',
      eventType,
      reference,
      externalEventId,
      rawStatus,
      mappedStatus: status,
    })
    return { body: { error: 'Invalid Flutterwave webhook payload.', success: false }, status: 400 as const }
  }

  try {
    if (eventType === 'charge.completed') {
      const customer = isRecord(data.customer) ? data.customer : {}
      const customerEmail = readString(customer.email)
      const accountNumber = readString(data.account_number)

      if (reference.startsWith('static_va_')) {
        logFlutterwaveWebhook('static-va.received', {
          reference,
          externalEventId,
          customerEmail: customerEmail || null,
          accountNumber: accountNumber || null,
          rawStatus,
          mappedStatus: status,
        })
        const recorded = await recordProviderEvent({
          externalEventId,
          provider: 'flutterwave',
          reference: providerReference || reference,
          status,
          failureReason: status === 'failed' ? failureReason : undefined,
          payload: body,
        })
        if (!recorded.inserted) {
          logFlutterwaveWebhook('static-va.duplicate-event', {
            reference,
            externalEventId,
            providerReference: providerReference ?? null,
          })
          return { body: { data: { duplicate: true, event: recorded.event }, success: true }, status: 200 as const }
        }

        const user = (customerEmail ? await getUserByEmail(customerEmail) : null)
          ?? (accountNumber ? await getUserByVirtualAccountNumber(accountNumber) : null)
        if (!user) {
          logFlutterwaveWebhook('static-va.user-miss', {
            reference,
            externalEventId,
            customerEmail: customerEmail || null,
            accountNumber: accountNumber || null,
            providerReference: providerReference ?? null,
          })
          return {
            body: {
              error: 'Deposit customer could not be matched to a user.',
              success: false,
              debug: {
                customerEmail: customerEmail || null,
                accountNumber: accountNumber || null,
                reference,
              },
            },
            status: 404 as const,
          }
        }

        logFlutterwaveWebhook('static-va.user-match', {
          reference,
          externalEventId,
          userId: user.id,
          customerEmail: customerEmail || null,
          accountNumber: accountNumber || null,
        })

        const verifiedTransactionId = readString(data.id)
        const verified = await resolveVerifiedFlutterwaveDeposit({
          transactionId: verifiedTransactionId || undefined,
          reference,
        })
        const amount = verified?.amount ?? readNumber(data.amount)
        const chargedAmount = verified?.chargedAmount ?? readNumber(data.charged_amount)
        const amountSettled = verified?.amountSettled
        const merchantFee = verified?.merchantFee ?? readNumber(data.merchant_fee)
        const appFee = verified?.appFee ?? readNumber(data.app_fee)
        const grossAmount = chargedAmount && amount && chargedAmount >= amount
          ? chargedAmount
          : amount

        if (grossAmount == null || !Number.isFinite(grossAmount) || grossAmount <= 0) {
          logFlutterwaveWebhook('static-va.amount-invalid', {
            reference,
            externalEventId,
            verifiedTransactionId: verifiedTransactionId || null,
            amount: data.amount ?? null,
            chargedAmount: data.charged_amount ?? null,
          })
          return { body: { error: 'Invalid Flutterwave deposit amount.', success: false }, status: 400 as const }
        }

        const uniqueReference = providerReference || reference
        const duplicateProviderRef = await getTransactionByReference(uniqueReference)
        if (duplicateProviderRef?.transaction) {
          logFlutterwaveWebhook('static-va.duplicate-transaction', {
            reference,
            uniqueReference,
            transactionId: duplicateProviderRef.transaction.id,
          })
          return { body: { data: { duplicate: true, transaction: duplicateProviderRef.transaction }, success: true }, status: 200 as const }
        }

        if (status === 'failed') {
          logFlutterwaveWebhook('static-va.failed-status', {
            reference,
            externalEventId,
            rawStatus,
            failureReason: failureReason ?? null,
          })
          return { body: { data: { ignored: true, status }, success: true }, status: 200 as const }
        }

        const netAmount = amountSettled && amountSettled > 0
          ? amountSettled
          : amount
        const fee = grossAmount - (netAmount ?? 0)
        const deposit = await createSettledDepositFromProvider({
          userId: user.id,
          reference: uniqueReference,
          provider: 'flutterwave_virtual_account',
          providerReference,
          providerStatus: rawStatus || undefined,
          grossAmount,
          fee,
          fundingMethod: 'virtual_account_static',
          accountNumber,
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

        logFlutterwaveWebhook('static-va.credited', {
          reference,
          uniqueReference,
          userId: user.id,
          verifiedTransactionId: verifiedTransactionId || null,
          amount,
          chargedAmount,
          amountSettled,
          appFee,
          merchantFee,
          grossAmount,
          fee,
          netAmount: deposit.transaction.amount,
          transactionId: deposit.transaction.id,
        })

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
      logFlutterwaveWebhook('settlement.duplicate', {
        reference,
        externalEventId,
        eventType,
      })
      return { body: { data: { duplicate: true, event: processed.event }, success: true }, status: 200 as const }
    }

    logFlutterwaveWebhook('settlement.processed', {
      reference,
      externalEventId,
      eventType,
      result: processed.result ?? null,
    })

    return { body: { data: processed.result, success: true }, status: 200 as const }
  } catch (error) {
    logFlutterwaveWebhook('error', {
      source: input.source ?? 'public_webhook',
      eventType,
      reference,
      externalEventId,
      message: error instanceof Error ? error.message : 'Settlement processing failed.',
    })
    return {
      body: { error: error instanceof Error ? error.message : 'Settlement processing failed.', success: false },
      status: 404 as const,
    }
  }
}
