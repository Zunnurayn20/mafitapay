import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { applyWalletMutation, createPayoutRequest, getWalletByUserId, upsertBeneficiary } from '@/lib/server/data'
import { resolveBankBeneficiary } from '@/lib/server/bank-resolution'
import { executeBankPayout } from '@/lib/server/payout-execution'
import { generateRef } from '@/lib/utils'

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { amount } = body
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
}
