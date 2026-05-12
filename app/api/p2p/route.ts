import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { applyWalletMutation, createPayoutRequest, getP2PMerchantById, getP2PMerchants, getWalletByUserId } from '@/lib/server/data'
import { generateRef } from '@/lib/utils'

export async function GET() {
  return NextResponse.json({ data: await getP2PMerchants(), success: true })
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const merchant = await getP2PMerchantById(String(body.merchantId))
  const amount = Number(body.amount)
  const action = body.action === 'withdraw' ? 'withdraw' : 'deposit'

  if (!merchant) {
    return NextResponse.json({ error: 'Merchant not found', success: false }, { status: 404 })
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount', success: false }, { status: 400 })
  }

  if (amount < merchant.minAmount || amount > merchant.maxAmount) {
    return NextResponse.json({ error: 'Amount is outside merchant limits', success: false }, { status: 400 })
  }

  const wallet = await getWalletByUserId(user.id)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found', success: false }, { status: 404 })
  }

  let transaction

  if (action === 'withdraw') {
    if (wallet.balance < amount) {
      return NextResponse.json({ error: 'Insufficient balance', success: false }, { status: 400 })
    }

    transaction = {
      id: generateRef(),
      type: 'p2p_withdrawal' as const,
      status: 'pending' as const,
      amount: -amount,
      fee: 0,
      description: `P2P Withdrawal — ${merchant.name}`,
      reference: generateRef(),
      createdAt: new Date().toISOString(),
      icon: '⬆',
      metadata: {
        merchantId: merchant.id,
        merchantName: merchant.name,
        settlementFlow: 'release_locked',
        settlementKind: 'merchant_payout',
      },
    }
  } else {
    transaction = {
      id: generateRef(),
      type: 'p2p_deposit' as const,
      status: 'success' as const,
      amount,
      fee: 0,
      description: `P2P Deposit — ${merchant.name}`,
      reference: generateRef(),
      createdAt: new Date().toISOString(),
      icon: '⬇',
      metadata: {
        merchantId: merchant.id,
        merchantName: merchant.name,
      },
    }
  }

  const result = await applyWalletMutation({
    userId: user.id,
    balanceDelta: action === 'withdraw' ? -amount : amount,
    lockedBalanceDelta: action === 'withdraw' ? amount : 0,
    minimumAvailableBalance: action === 'withdraw' ? amount : undefined,
    transaction,
  })
  if (action === 'withdraw') {
    await createPayoutRequest({
      userId: user.id,
      transactionId: result.transaction.id,
      reference: result.transaction.reference,
      amount,
      provider: 'merchant_payout',
      merchantId: merchant.id,
      beneficiary: merchant.name,
      status: 'pending',
    })
  }
  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: action === 'withdraw' ? 'P2P withdrawal pending' : 'P2P deposit completed',
    message:
      action === 'withdraw'
        ? `₦${amount.toLocaleString('en-NG')} withdrawal to ${merchant.name} is awaiting settlement`
        : `₦${amount.toLocaleString('en-NG')} deposit from ${merchant.name} was credited to your wallet`,
    type: action === 'withdraw' ? 'info' : 'success',
  }))

  return NextResponse.json({
    data: { merchant, transaction: result.transaction, wallet: result.wallet },
    success: true,
  })
}
