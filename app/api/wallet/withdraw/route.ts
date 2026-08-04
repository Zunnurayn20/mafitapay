import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { applyWalletMutation, createPayoutRequest, getWalletByUserId, upsertBeneficiary, verifySensitiveActionAuthorization } from '@/lib/server/data'
import { resolveBankBeneficiary } from '@/lib/server/bank-resolution'
import { executeBankPayout } from '@/lib/server/payout-execution'
import { ensureFlutterwavePayoutSyncScheduler } from '@/lib/server/payout-sync-batch'
import { generateRef, sanitizeErrorForLogs } from '@/lib/utils'

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()
  ensureFlutterwavePayoutSyncScheduler()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.', success: false }, { status: 400 })
  }

  const { amount } = body
  const transactionPin = typeof body.transactionPin === 'string' ? body.transactionPin.trim() : ''
  const biometricApprovalToken = typeof body.biometricApprovalToken === 'string' ? body.biometricApprovalToken.trim() : ''
  const confirmWithBiometric = body.confirmWithBiometric === true
  if (!amount) {
    return NextResponse.json({ error: 'amount, bankName, accountNumber, and accountName are required' }, { status: 400 })
  }

  let bankName = ''
  let bankCode = ''
  let accountNumber = ''
  let accountName = ''
  let verificationProvider = 'local_validation'
  let verificationReference = generateRef()
  let verificationReason = 'Validated against local bank beneficiary rules.'
  try {
    const resolved = await resolveBankBeneficiary(body)
    if (resolved.status !== 'verified') {
      return NextResponse.json({ error: resolved.reason || 'Beneficiary verification failed.', success: false }, { status: 400 })
    }
    bankCode = resolved.bankCode
    bankName = resolved.bankName
    accountNumber = resolved.accountNumber
    accountName = resolved.accountName
    verificationProvider = resolved.provider
    verificationReference = resolved.reference
    verificationReason = resolved.reason || verificationReason
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid beneficiary details.', success: false }, { status: 400 })
  }

  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return NextResponse.json({ error: 'Invalid amount', success: false }, { status: 400 })
  }

  try {
    await verifySensitiveActionAuthorization(user.id, { transactionPin, biometricApprovalToken, confirmWithBiometric })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Security approval failed.', success: false }, { status: 400 })
  }

  const wallet = await getWalletByUserId(user.id)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found', success: false }, { status: 404 })
  }

  if (wallet.balance < numericAmount) {
    return NextResponse.json({ error: 'Insufficient balance', success: false }, { status: 400 })
  }

  const ref = generateRef()
  const transaction = {
    id: ref,
    type: 'withdrawal' as const,
    status: 'pending' as const,
    amount: -numericAmount,
    fee: 0,
    description: `Bank Withdrawal — ${bankName}`,
    reference: ref,
    createdAt: new Date().toISOString(),
    icon: '⬆',
    metadata: {
      bankName,
      bankCode,
      accountNumber,
      accountName,
      settlementFlow: 'release_locked',
      settlementKind: 'bank_payout',
    },
  }

  // Everything past this point touches the wallet ledger, the payout provider and the
  // notification store. An uncaught throw here escapes as a non-JSON 500, which the client then
  // fails to parse — surfacing "Unexpected token ..." to the user instead of a real reason.
  // Always answer with the JSON envelope the client expects.
  try {
    const result = await applyWalletMutation({
      userId: user.id,
      balanceDelta: -numericAmount,
      lockedBalanceDelta: numericAmount,
      minimumAvailableBalance: numericAmount,
      transaction,
    })
    await createPayoutRequest({
      userId: user.id,
      transactionId: result.transaction.id,
      reference: result.transaction.reference,
      amount: numericAmount,
      provider: 'bank_payout',
      beneficiary: `${accountName} · ${bankName} · ${accountNumber}`,
      status: 'pending',
    })
    await upsertBeneficiary({
      userId: user.id,
      kind: 'bank',
      label: `${accountName} · ${bankName}`,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      verifiedAt: new Date().toISOString(),
      verificationProvider,
      verificationStatus: 'verified',
      verificationReference,
      verificationCheckedAt: new Date().toISOString(),
      verificationReason,
    })

    const payoutExecution = await executeBankPayout({
      userId: user.id,
      transaction: result.transaction,
      amount: numericAmount,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      narration: transaction.description,
    })

    if (payoutExecution.mode === 'failed') {
      return NextResponse.json({
        error: payoutExecution.payout.reason || 'Flutterwave payout initiation failed.',
        data: payoutExecution.released
          ? { transaction: payoutExecution.released.transaction, wallet: payoutExecution.released.wallet }
          : undefined,
        success: false,
      }, { status: 502 })
    }

    await appendNotification(user.id, createNotification({
      userId: user.id,
      title: 'Withdrawal pending',
      message: `${transaction.description} for ₦${numericAmount.toLocaleString('en-NG')} is awaiting completion`,
      type: 'info',
    }))

    return NextResponse.json({
      data: { transaction: result.transaction, wallet: result.wallet },
      success: true
    })
  } catch (error) {
    console.error(`[wallet/withdraw] failed for user=${user.id} ref=${ref}:`, sanitizeErrorForLogs(error))

    // A few ledger errors are user-actionable and safe to echo back — notably the balance race
    // that applyWalletMutation guards against after the pre-check above. Everything else stays
    // generic, because the underlying message can carry database or provider internals. The
    // reference lets support correlate the user's report with the logged cause.
    const message = error instanceof Error ? error.message : ''
    const SAFE_TO_SURFACE = ['Insufficient balance', 'Wallet not found', 'Wallet balance cannot go negative']
    if (SAFE_TO_SURFACE.includes(message)) {
      return NextResponse.json({ error: message, success: false }, { status: 400 })
    }

    return NextResponse.json({
      error: `Withdrawal could not be completed. Please try again or contact support with reference ${ref}.`,
      success: false,
    }, { status: 500 })
  }
}
