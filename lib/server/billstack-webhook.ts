import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  claimProviderEventProcessing,
  createSettledDepositFromProvider,
  getTransactionByReference,
  getUserByVirtualAccountReference,
  getWalletByUserId,
  insertAuditLog,
  markProviderEventProcessed,
  recordProviderEvent,
  releaseProviderEventProcessingClaim,
} from '@/lib/server/data'
import { getBillStackTransaction } from '@/lib/server/billstack'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function readAmount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const amount = Number(value.trim())
    return Number.isFinite(amount) ? amount : null
  }
  return null
}

export async function handleBillStackWebhook(rawBody: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { status: 400, body: { status: false, message: 'Invalid webhook payload.' } } as const
  }

  if (!isRecord(parsed) || readString(parsed.event).toUpperCase() !== 'PAYMENT_NOTIFICATION' || !isRecord(parsed.data)) {
    return { status: 400, body: { status: false, message: 'Unsupported webhook event.' } } as const
  }
  const eventData = parsed.data
  if (readString(eventData.type).toUpperCase() !== 'RESERVED_ACCOUNT_TRANSACTION') {
    return { status: 200, body: { status: true, message: 'Event acknowledged.' } } as const
  }

  const account = isRecord(eventData.account) ? eventData.account : {}
  // BillStack's webhook fields have distinct purposes:
  // `reference` is the BillStack transaction reference, `merchant_reference`
  // is the reserved-account reference we created, and `wiaxy_ref` is the
  // session ID accepted by getTransaction.
  const transactionReference = readString(eventData.reference)
  const providerAccountReference = readString(eventData.merchant_reference)
  const sessionId = readString(eventData.wiaxy_ref) || readString(eventData.transaction_ref)
  const webhookAmount = readAmount(eventData.amount)
  const accountNumber = readString(account.account_number)

  if (!sessionId || !transactionReference || !providerAccountReference) {
    return { status: 400, body: { status: false, message: 'Deposit reference is missing.' } } as const
  }

  let verified: Record<string, unknown>
  try {
    verified = await getBillStackTransaction(sessionId)
  } catch (error) {
    console.error('[billstack-webhook] transaction verification failed', error instanceof Error ? error.message : 'Unknown verification error')
    return { status: 503, body: { status: false, message: 'Unable to verify the BillStack payment. Please retry.' } } as const
  }

  const verifiedReference = readString(verified.reference)
  const verifiedSessionId = readString(verified.session_id) || readString(verified.transaction_ref)
  const verifiedAccountNumber = readString(verified.nuban)
  const amount = readAmount(verified.amount)
  const status = readString(verified.status).toUpperCase()
  if (
    verifiedReference !== transactionReference
    || verifiedSessionId !== sessionId
    || (accountNumber && verifiedAccountNumber && accountNumber !== verifiedAccountNumber)
  ) {
    console.error('[billstack-webhook] verified payment references do not match the webhook')
    return { status: 400, body: { status: false, message: 'BillStack payment details did not match.' } } as const
  }

  // BillStack's transaction lookup reports successful reserved-account
  // transfers as PAID. `is_settled` refers to downstream settlement and can
  // still be false after the customer's transfer has been received.
  if (status !== 'PAID' && !(status === 'SUCCESS' && verified.is_settled === true)) {
    return { status: 503, body: { status: false, message: 'BillStack has not confirmed this payment as paid yet. Please retry.' } } as const
  }
  if (amount == null || amount <= 0 || (webhookAmount != null && Math.abs(webhookAmount - amount) > 0.01)) {
    console.error('[billstack-webhook] verified payment amount is invalid or mismatched')
    return { status: 400, body: { status: false, message: 'BillStack payment amount did not match.' } } as const
  }

  const user = await getUserByVirtualAccountReference(providerAccountReference, 'billstack')
  if (!user) {
    console.error('[billstack-webhook] no user owns the reserved account reference')
    return { status: 404, body: { status: false, message: 'Deposit account could not be matched.' } } as const
  }
  const wallet = await getWalletByUserId(user.id)
  const ownedAccount = wallet?.virtualAccounts.find(item =>
    item.provider === 'billstack'
    && item.isPermanent
    && (item.reference === providerAccountReference || Boolean(verifiedAccountNumber && item.accountNumber === verifiedAccountNumber))
    && (!verifiedAccountNumber || item.accountNumber === verifiedAccountNumber)
  )
  if (!ownedAccount) {
    console.error('[billstack-webhook] provider reference or account number does not match the saved BillStack account')
    return { status: 400, body: { status: false, message: 'Deposit account details did not match.' } } as const
  }

  const uniqueReference = `billstack_${sessionId}`
  const existing = await getTransactionByReference(uniqueReference)
  if (existing?.transaction) {
    return { status: 200, body: { status: true, message: 'Payment already processed.' } } as const
  }

  const recorded = await recordProviderEvent({
    externalEventId: uniqueReference,
    provider: 'billstack',
    reference: providerAccountReference,
    status: 'success',
    payload: {
      event: 'PAYMENT_NOTIFICATION',
      sessionId,
      providerAccountReference,
      accountNumber: verifiedAccountNumber || accountNumber,
      amount,
    },
  })
  if (!recorded.inserted && recorded.event.processedAt) {
    return { status: 200, body: { status: true, message: 'Payment already processed.' } } as const
  }
  if (!recorded.inserted && (recorded.event.provider !== 'billstack' || recorded.event.reference !== providerAccountReference)) {
    return { status: 409, body: { status: false, message: 'Webhook reference was already used.' } } as const
  }
  if (!await claimProviderEventProcessing(uniqueReference)) {
    return { status: 503, body: { status: false, message: 'Payment is already being processed. Please retry.' } } as const
  }

  try {
    const deposit = await createSettledDepositFromProvider({
      userId: user.id,
      reference: uniqueReference,
      provider: 'billstack',
      providerReference: sessionId,
      providerStatus: status,
      grossAmount: amount,
      fee: 0,
      fundingMethod: 'virtual_account_billstack',
      accountNumber: ownedAccount.accountNumber,
      bankName: ownedAccount.bank,
      accountName: ownedAccount.accountName,
      metadata: {
        billstackAccountReference: providerAccountReference,
        billstackSessionId: sessionId,
        billstackCustomerFee: 0,
        billstackSettlementVerified: true,
      },
    })

    await insertAuditLog({
      userId: user.id,
      action: 'deposit_intent.success_webhook',
      entityType: 'deposit_intent',
      entityId: deposit.depositIntent.id,
      metadata: { reference: uniqueReference, provider: 'billstack' },
    })
    await markProviderEventProcessed(uniqueReference)
    await appendNotification(user.id, createNotification({
      userId: user.id,
      title: 'Deposit confirmed',
      message: `${deposit.transaction.description} has been confirmed by BillStack.`,
      type: 'success',
    }), { email: true, push: true })

    return { status: 200, body: { status: true, message: 'successful' } } as const
  } catch (error) {
    const duplicate = await getTransactionByReference(uniqueReference).catch(() => null)
    if (duplicate?.transaction) {
      await markProviderEventProcessed(uniqueReference)
      return { status: 200, body: { status: true, message: 'Payment already processed.' } } as const
    }
    await releaseProviderEventProcessingClaim(uniqueReference)
    console.error('[billstack-webhook] payment credit failed', error instanceof Error ? error.message : 'Unknown credit error')
    return { status: 503, body: { status: false, message: 'Payment could not be credited yet. Please retry.' } } as const
  }
}
