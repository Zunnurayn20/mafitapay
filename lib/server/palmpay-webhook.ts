import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  createSettledDepositFromProvider,
  getTransactionByReference,
  getUserByVirtualAccountNumber,
  getUserByVirtualAccountReference,
  insertAuditLog,
  markProviderEventProcessed,
  recordProviderEvent,
} from '@/lib/server/data'
import { mapPalmPayVirtualAccountOrderStatus, verifyPalmPayWebhook } from './palmpay'

const PALMPAY_WEBHOOK_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_PALMPAY === '1'

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

function logPalmPayWebhook(event: string, payload: Record<string, unknown>) {
  if (!PALMPAY_WEBHOOK_LOGGING_ENABLED) return
  console.log(`[palmpay-webhook] ${event}`, JSON.stringify(payload))
}

export async function handlePalmPayWebhook(rawBody: string) {
  const signatureValid = verifyPalmPayWebhook(rawBody)
  if (!signatureValid) {
    logPalmPayWebhook('signature.invalid', { bodyLength: rawBody.length })
    return { body: 'Unauthorized webhook request.', contentType: 'text/plain', status: 401 as const }
  }

  const parsed = JSON.parse(rawBody) as unknown
  const body = isRecord(parsed) ? parsed : {}
  const orderNo = readString(body.orderNo)
  const orderStatus = mapPalmPayVirtualAccountOrderStatus(body.orderStatus)
  const accountReference = readString(body.accountReference)
  const virtualAccountNo = readString(body.virtualAccountNo)
  const orderAmountMinor = readNumber(body.orderAmount)

  logPalmPayWebhook('parsed', {
    orderNo,
    orderStatusRaw: body.orderStatus ?? null,
    mappedStatus: orderStatus,
    accountReference: accountReference || null,
    virtualAccountNo: virtualAccountNo || null,
    orderAmountMinor,
  })

  if (!orderNo || !orderStatus) {
    return { body: 'Invalid PalmPay webhook payload.', contentType: 'text/plain', status: 400 as const }
  }

  const recorded = await recordProviderEvent({
    externalEventId: orderNo,
    provider: 'palmpay',
    reference: orderNo,
    status: orderStatus,
    failureReason: orderStatus === 'failed' ? 'PalmPay virtual account funding failed.' : undefined,
    payload: body,
  })
  if (!recorded.inserted) {
    logPalmPayWebhook('duplicate-event', { orderNo })
    return { body: 'success', contentType: 'text/plain', status: 200 as const }
  }

  if (orderStatus !== 'success') {
    logPalmPayWebhook('ignored-status', { orderNo, orderStatus })
    return { body: 'success', contentType: 'text/plain', status: 200 as const }
  }

  const user = (accountReference ? await getUserByVirtualAccountReference(accountReference) : null)
    ?? (virtualAccountNo ? await getUserByVirtualAccountNumber(virtualAccountNo) : null)

  if (!user) {
    logPalmPayWebhook('user-miss', {
      orderNo,
      accountReference: accountReference || null,
      virtualAccountNo: virtualAccountNo || null,
    })
    return { body: 'User match failed.', contentType: 'text/plain', status: 404 as const }
  }

  const duplicateTransaction = await getTransactionByReference(orderNo)
  if (duplicateTransaction?.transaction) {
    logPalmPayWebhook('duplicate-transaction', {
      orderNo,
      transactionId: duplicateTransaction.transaction.id,
    })
    await markProviderEventProcessed(orderNo)
    return { body: 'success', contentType: 'text/plain', status: 200 as const }
  }

  const grossAmount = orderAmountMinor != null ? orderAmountMinor / 100 : null
  if (grossAmount == null || !Number.isFinite(grossAmount) || grossAmount <= 0) {
    logPalmPayWebhook('amount-invalid', { orderNo, orderAmountMinor })
    return { body: 'Invalid PalmPay deposit amount.', contentType: 'text/plain', status: 400 as const }
  }

  const deposit = await createSettledDepositFromProvider({
    userId: user.id,
    reference: orderNo,
    provider: 'palmpay_virtual_account',
    providerReference: orderNo,
    providerStatus: readString(body.orderStatus) || undefined,
    grossAmount,
    fee: 0,
    fundingMethod: 'virtual_account_static',
    accountNumber: virtualAccountNo || undefined,
    bankName: 'PalmPay',
    accountName: readString(body.virtualAccountName) || `${user.name.trim()} MAFITAPAY`,
    metadata: {
      accountReference: accountReference || undefined,
      payerAccountNo: readString(body.payerAccountNo) || undefined,
      payerAccountName: readString(body.payerAccountName) || undefined,
      payerBankName: readString(body.payerBankName) || undefined,
      sessionId: readString(body.sessionId) || undefined,
      walletAsset: 'NGN',
    },
  })

  await insertAuditLog({
    userId: user.id,
    action: 'deposit_intent.success_webhook',
    entityType: 'deposit_intent',
    entityId: deposit.depositIntent.id,
    metadata: { provider: 'palmpay', reference: orderNo },
  })
  await markProviderEventProcessed(orderNo)

  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: 'Deposit confirmed',
    message: `${deposit.transaction.description} has been confirmed by PalmPay.`,
    type: 'success',
  }))

  logPalmPayWebhook('credited', {
    orderNo,
    userId: user.id,
    grossAmount,
    transactionId: deposit.transaction.id,
  })

  return { body: 'success', contentType: 'text/plain', status: 200 as const }
}
