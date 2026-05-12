import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { applyWalletMutation, createDepositIntent, getWalletByUserId, updateWalletVirtualAccounts } from '@/lib/server/data'
import { createFlutterwaveVirtualAccount, isFlutterwaveCollectionsEnabled } from '@/lib/server/flutterwave-collections'
import { generateRef } from '@/lib/utils'

const MAX_DEPOSIT_FEE = 100

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const { amount } = await req.json()
  const numericAmount = Number(amount)

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return NextResponse.json({ error: 'Invalid amount', success: false }, { status: 400 })
  }

  const wallet = await getWalletByUserId(user.id)

  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found', success: false }, { status: 404 })
  }

  if (!isFlutterwaveCollectionsEnabled()) {
    return NextResponse.json({ error: 'Flutterwave deposit collections are not configured.', success: false }, { status: 503 })
  }

  const fee = Math.min(MAX_DEPOSIT_FEE, Math.round(numericAmount * 0.02))
  const creditedAmount = numericAmount - fee

  if (creditedAmount <= 0) {
    return NextResponse.json({ error: 'Deposit amount is too small', success: false }, { status: 400 })
  }

  const ref = generateRef()
  const [firstName, ...restNames] = user.name.trim().split(/\s+/).filter(Boolean)
  const providerAccount = await createFlutterwaveVirtualAccount({
    reference: ref,
    email: user.email,
    phoneNumber: user.phone,
    firstName: firstName || user.name.trim() || 'User',
    lastName: restNames.join(' ') || 'Mafitapay',
    amount: numericAmount,
    narration: `${user.name.trim()} MAFITAPAY`.slice(0, 35),
  })

  if (providerAccount.status === 'failed' || !providerAccount.accountNumber || !providerAccount.bankName) {
    return NextResponse.json({
      error: providerAccount.reason || 'Unable to generate a deposit account.',
      success: false,
    }, { status: 502 })
  }

  const transaction = {
    id: ref,
    type: 'deposit' as const,
    status: 'pending' as const,
    amount: creditedAmount,
    fee,
    description: 'Bank Transfer Deposit',
    reference: ref,
    createdAt: new Date().toISOString(),
    icon: '⬇',
    metadata: {
      grossAmount: numericAmount,
      fundingMethod: 'virtual_account',
      settlementFlow: 'credit_on_success',
      settlementKind: 'provider_deposit',
      walletAsset: 'NGN',
    },
  }

  const result = await applyWalletMutation({
    userId: user.id,
    transaction,
  })
  const depositIntent = await createDepositIntent({
    userId: user.id,
    transactionId: result.transaction.id,
    reference: result.transaction.reference,
    grossAmount: numericAmount,
    netAmount: creditedAmount,
    fee,
    fundingMethod: 'virtual_account',
    provider: 'flutterwave_virtual_account',
    providerReference: providerAccount.providerReference,
    providerStatus: providerAccount.rawStatus,
    accountNumber: providerAccount.accountNumber,
    bankName: providerAccount.bankName,
    accountName: providerAccount.accountName,
    expiresAt: providerAccount.expiresAt,
    note: providerAccount.note,
    status: 'pending',
  })
  const updatedWallet = await updateWalletVirtualAccounts(user.id, [{
    bank: providerAccount.bankName,
    accountNumber: providerAccount.accountNumber,
    accountName: providerAccount.accountName || `${user.name.trim()} MAFITAPAY`,
    provider: 'flutterwave',
  }])

  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: 'Deposit account ready',
    message: `Transfer ₦${numericAmount.toLocaleString('en-NG')} to ${providerAccount.accountNumber} at ${providerAccount.bankName}. Your NGN balance updates after provider confirmation.`,
    type: 'info',
  }))

  return NextResponse.json({
    data: {
      transaction: result.transaction,
      wallet: updatedWallet ?? result.wallet,
      depositIntent,
      fundingAccount: {
        bank: providerAccount.bankName,
        accountNumber: providerAccount.accountNumber,
        accountName: providerAccount.accountName || `${user.name.trim()} MAFITAPAY`,
        expiresAt: providerAccount.expiresAt,
        note: providerAccount.note,
        reference: result.transaction.reference,
        amount: numericAmount,
        fee,
        netAmount: creditedAmount,
      },
    },
    success: true,
  })
}
