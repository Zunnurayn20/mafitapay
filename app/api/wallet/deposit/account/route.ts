import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { createFlutterwaveStaticVirtualAccount, isFlutterwaveCollectionsEnabled } from '@/lib/server/flutterwave-collections'
import { createPalmPayVirtualAccount, isPalmPayVirtualAccountsEnabled } from '@/lib/server/palmpay'
import {
  getLatestKycSubmissionByUserId,
  getLatestSensitiveKycIdentityByUserId,
  getWalletByUserId,
  insertAuditLog,
  updateWalletVirtualAccounts,
} from '@/lib/server/data'
import { generateRef } from '@/lib/utils'
import type { Wallet } from '@/types'

export const runtime = 'nodejs'

const PALMPAY_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_PALMPAY === '1'

function logDepositAccount(event: string, payload: Record<string, unknown>) {
  if (!PALMPAY_LOGGING_ENABLED) return
  console.log(`[deposit-account] ${event}`, JSON.stringify(payload))
}

function orderPermanentAccounts(accounts: Wallet['virtualAccounts']) {
  return [...accounts].sort((left, right) => {
    const leftRank = left.provider === 'palmpay' && left.isPermanent
      ? 0
      : left.provider === 'flutterwave' && left.isPermanent
        ? 1
        : 2
    const rightRank = right.provider === 'palmpay' && right.isPermanent
      ? 0
      : right.provider === 'flutterwave' && right.isPermanent
        ? 1
        : 2
    return leftRank - rightRank
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getFundingIdentityPayload(
  submittedIdentity: Awaited<ReturnType<typeof getLatestKycSubmissionByUserId>>,
  sensitiveIdentity: Awaited<ReturnType<typeof getLatestSensitiveKycIdentityByUserId>>,
) {
  if (
    !submittedIdentity
    || !sensitiveIdentity
    || sensitiveIdentity.documentType !== submittedIdentity.documentType
    || (sensitiveIdentity.documentType !== 'bvn' && sensitiveIdentity.documentType !== 'nin')
  ) {
    return null
  }

  return {
    identityType: sensitiveIdentity.documentType === 'nin' ? 'personal_nin' as const : 'personal' as const,
    licenseNumber: sensitiveIdentity.documentNumber,
  }
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const parsed = await req.json().catch(() => null)
  const body = isRecord(parsed) ? parsed : {}
  const provider = body.provider === 'flutterwave' ? 'flutterwave' : 'palmpay'
  logDepositAccount('request', {
    userId: user.id,
    provider,
  })

  const wallet = await getWalletByUserId(user.id)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found.', success: false }, { status: 404 })
  }

  const existing = wallet.virtualAccounts.find(item => item.provider === provider && item.isPermanent)
  if (existing) {
    return NextResponse.json({ data: { virtualAccount: existing, existing: true, provider }, success: true })
  }

  const submittedIdentity = await getLatestKycSubmissionByUserId(user.id)
  const sensitiveIdentity = submittedIdentity
    ? await getLatestSensitiveKycIdentityByUserId(user.id)
    : null

  const [firstName, ...restNames] = user.name.trim().split(/\s+/).filter(Boolean)
  const reference = `static_va_${generateRef()}`

  if (provider === 'palmpay') {
    if (!isPalmPayVirtualAccountsEnabled()) {
      logDepositAccount('palmpay.not_configured', { userId: user.id })
      return NextResponse.json({ error: 'PalmPay funding accounts are not configured.', success: false }, { status: 503 })
    }

    const palmpayIdentity = getFundingIdentityPayload(submittedIdentity, sensitiveIdentity)
    if (!palmpayIdentity) {
      logDepositAccount('palmpay.eligibility_blocked', {
        userId: user.id,
        hasSubmittedIdentity: Boolean(submittedIdentity),
        identityStatus: submittedIdentity?.status ?? null,
        identityType: submittedIdentity?.documentType ?? null,
      })
      return NextResponse.json({
        error: 'Submit BVN or NIN before creating a PalmPay funding account.',
        success: false,
      }, { status: 403 })
    }

    const providerAccount = await createPalmPayVirtualAccount({
      reference,
      email: user.email,
      customerName: user.name.trim() || 'MafitaPay User',
      virtualAccountName: `${user.name.trim()} MAFITAPAY`.slice(0, 200),
      accountReference: reference,
      identityType: palmpayIdentity?.identityType,
      licenseNumber: palmpayIdentity?.licenseNumber,
    })

    if (providerAccount.status === 'failed' || !providerAccount.accountNumber) {
      logDepositAccount('palmpay.failed', {
        userId: user.id,
        reference,
        reason: providerAccount.reason ?? null,
        rawStatus: providerAccount.rawStatus ?? null,
        payload: providerAccount.payload ?? null,
      })
      return NextResponse.json({
        error: providerAccount.reason || 'Unable to create a PalmPay funding account.',
        success: false,
      }, { status: 502 })
    }

    const nextAccount: Wallet['virtualAccounts'][number] = {
      bank: providerAccount.bankName || 'PalmPay',
      accountNumber: providerAccount.accountNumber,
      accountName: providerAccount.accountName || `${user.name.trim()} MAFITAPAY`,
      provider: 'palmpay',
      isPermanent: true,
      reference: providerAccount.providerReference || providerAccount.reference,
    }

    const nextAccounts = orderPermanentAccounts([
      nextAccount,
      ...wallet.virtualAccounts.filter(item => !(item.provider === 'palmpay' && item.isPermanent)),
    ])

    const updatedWallet = await updateWalletVirtualAccounts(user.id, nextAccounts)

    await insertAuditLog({
      userId: user.id,
      actorUserId: user.id,
      action: 'wallet.static_virtual_account_created',
      entityType: 'wallet',
      entityId: user.id,
      metadata: {
        provider: 'palmpay',
        accountNumber: nextAccount.accountNumber,
        bankName: nextAccount.bank,
      },
    })

    await appendNotification(user.id, createNotification({
      userId: user.id,
        title: 'PalmPay funding account ready',
      message: `${nextAccount.accountNumber} at ${nextAccount.bank} is now available in your wallet funding accounts.`,
      type: 'success',
    }))

    logDepositAccount('palmpay.created', {
      userId: user.id,
      accountNumber: nextAccount.accountNumber,
      reference: nextAccount.reference ?? null,
    })

    return NextResponse.json({
      data: {
        wallet: updatedWallet ?? wallet,
        virtualAccount: nextAccount,
        existing: false,
        provider,
      },
      success: true,
    })
  }

  if (!isFlutterwaveCollectionsEnabled()) {
    logDepositAccount('flutterwave.not_configured', { userId: user.id })
    return NextResponse.json({ error: 'Flutterwave funding accounts are not configured.', success: false }, { status: 503 })
  }

  if (!submittedIdentity || (submittedIdentity.documentType !== 'bvn' && submittedIdentity.documentType !== 'nin')) {
    logDepositAccount('flutterwave.eligibility_blocked', {
      userId: user.id,
      hasSubmittedIdentity: Boolean(submittedIdentity),
      identityStatus: submittedIdentity?.status ?? null,
      identityType: submittedIdentity?.documentType ?? null,
    })
    return NextResponse.json({
      error: 'Submit BVN or NIN before creating a Flutterwave funding account.',
      success: false,
    }, { status: 403 })
  }

  if (!sensitiveIdentity || sensitiveIdentity.documentType !== submittedIdentity.documentType) {
    return NextResponse.json({
      error: 'Funding identity is not available in secure storage. Configure secure identity storage and resubmit BVN/NIN if needed.',
      success: false,
    }, { status: 503 })
  }

  const providerAccount = await createFlutterwaveStaticVirtualAccount({
    reference,
    email: user.email,
    phoneNumber: user.phone,
    firstName: firstName || user.name.trim() || 'User',
    lastName: restNames.join(' ') || 'Mafitapay',
    narration: `${user.name.trim()} MAFITAPAY`.slice(0, 35),
    identityType: sensitiveIdentity.documentType,
    identityNumber: sensitiveIdentity.documentNumber,
  })

  if (providerAccount.status === 'failed' || !providerAccount.accountNumber || !providerAccount.bankName) {
    return NextResponse.json({
      error: providerAccount.reason || 'Unable to create a Flutterwave funding account.',
      success: false,
    }, { status: 502 })
  }

  const nextAccount: Wallet['virtualAccounts'][number] = {
    bank: providerAccount.bankName,
    accountNumber: providerAccount.accountNumber,
    accountName: providerAccount.accountName || `${user.name.trim()} MAFITAPAY`,
    provider: 'flutterwave',
    isPermanent: true,
    reference: providerAccount.providerReference || providerAccount.reference,
  }

  const nextAccounts = orderPermanentAccounts([
    nextAccount,
    ...wallet.virtualAccounts.filter(item => !(item.provider === 'flutterwave' && item.isPermanent)),
  ])

  const updatedWallet = await updateWalletVirtualAccounts(user.id, nextAccounts)

  await insertAuditLog({
    userId: user.id,
    actorUserId: user.id,
    action: 'wallet.static_virtual_account_created',
    entityType: 'wallet',
    entityId: user.id,
    metadata: {
      provider: 'flutterwave',
      identityType: sensitiveIdentity.documentType,
      accountNumber: nextAccount.accountNumber,
      bankName: nextAccount.bank,
    },
  })

  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: 'Flutterwave funding account ready',
    message: `${nextAccount.accountNumber} at ${nextAccount.bank} is now your secondary wallet funding account.`,
    type: 'success',
  }))

  return NextResponse.json({
    data: {
      wallet: updatedWallet ?? wallet,
      virtualAccount: nextAccount,
      existing: false,
      provider,
    },
    success: true,
  })
}
