import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { applyWalletMutation, createPayoutRequest, getUserByEmail, getUserByHandle, getWalletByUserId, upsertBeneficiary } from '@/lib/server/data'
import { resolveBankBeneficiary } from '@/lib/server/bank-resolution'
import { executeBankPayout } from '@/lib/server/payout-execution'
import { generateRef } from '@/lib/utils'

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { amount, narration } = body
  if (!amount) {
    return NextResponse.json({ error: 'Transfer amount is required' }, { status: 400 })
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

  const transferMode = body.mode === 'internal' ? 'internal' : 'bank'

  const ref = generateRef()
  if (transferMode === 'internal') {
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : ''
    if (!recipient) {
      return NextResponse.json({ error: 'Internal recipient is required.', success: false }, { status: 400 })
    }

    const target = recipient.includes('@') && !recipient.startsWith('@')
      ? await getUserByEmail(recipient)
      : await getUserByHandle(recipient)

    if (!target) {
      return NextResponse.json({ error: 'Internal recipient not found.', success: false }, { status: 404 })
    }

    if (target.id === user.id) {
      return NextResponse.json({ error: 'You cannot transfer to your own account.', success: false }, { status: 400 })
    }

    const senderTransaction = {
      id: ref,
      type: 'transfer_out' as const,
      status: 'success' as const,
      amount: -numericAmount,
      fee: 0,
      description: `Internal Transfer — ${target.name}`,
      reference: ref,
      recipient: `${target.name} · ${target.handle}`,
      narration,
      createdAt: new Date().toISOString(),
      icon: '↗',
      metadata: {
        settlementFlow: 'none',
        settlementKind: 'internal_transfer',
        targetUserId: target.id,
      },
    }

    const receiverTransaction = {
      id: `${ref}_in`,
      type: 'transfer_in' as const,
      status: 'success' as const,
      amount: numericAmount,
      fee: 0,
      description: `Internal Transfer from ${user.name}`,
      reference: ref,
      recipient: `${user.name} · ${user.handle}`,
      narration,
      createdAt: senderTransaction.createdAt,
      icon: '⬇',
      metadata: {
        settlementFlow: 'none',
        settlementKind: 'internal_transfer',
        sourceUserId: user.id,
      },
    }

    const result = await applyWalletMutation({
      userId: user.id,
      balanceDelta: -numericAmount,
      minimumAvailableBalance: numericAmount,
      transaction: senderTransaction,
    })
    await applyWalletMutation({
      userId: target.id,
      balanceDelta: numericAmount,
      transaction: receiverTransaction,
    })
    await upsertBeneficiary({
      userId: user.id,
      kind: 'internal',
      label: target.name,
      internalUserId: target.id,
      handle: target.handle,
      verifiedAt: new Date().toISOString(),
      verificationProvider: 'internal_directory',
      verificationStatus: 'verified',
      verificationReference: generateRef(),
      verificationCheckedAt: new Date().toISOString(),
    })
    await appendNotification(user.id, createNotification({
      userId: user.id,
      title: 'Transfer complete',
      message: `${senderTransaction.description} for ₦${numericAmount.toLocaleString('en-NG')}`,
      type: 'success',
    }))
    await appendNotification(target.id, createNotification({
      userId: target.id,
      title: 'Funds received',
      message: `₦${numericAmount.toLocaleString('en-NG')} received from ${user.name}`,
      type: 'success',
    }))

    return NextResponse.json({
      data: { transaction: result.transaction, wallet: result.wallet },
      success: true,
    })
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

  const transaction = {
    id: ref,
    type: 'transfer_out' as const,
    status: 'pending' as const,
    amount: -numericAmount,
    fee: 0,
    description: `Bank Transfer — ${bankName}`,
    reference: ref,
    recipient: `${accountName} · ${bankName} · ${accountNumber}`,
    narration,
    createdAt: new Date().toISOString(),
    icon: '↗',
    metadata: {
      bankName,
      bankCode,
      accountNumber,
      accountName,
      settlementFlow: 'release_locked',
      settlementKind: 'bank_transfer_out',
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
    provider: 'bank_transfer_out',
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
    narration,
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
    title: 'Transfer pending',
    message: `${transaction.description} for ₦${numericAmount.toLocaleString('en-NG')} is awaiting payout settlement`,
    type: 'info',
  }))

  return NextResponse.json({
    data: { transaction: result.transaction, wallet: result.wallet },
    success: true
  })
}
