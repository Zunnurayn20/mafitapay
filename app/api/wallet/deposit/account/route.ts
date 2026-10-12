import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { createFlutterwaveStaticVirtualAccount, isFlutterwaveCollectionsEnabled } from '@/lib/server/flutterwave-collections'
import { createPalmPayVirtualAccount, isPalmPayVirtualAccountsEnabled } from '@/lib/server/palmpay'
import {
  getLatestKycSubmissionByUserId,
  getLatestSensitiveKycIdentityByUserId,
  claimStaticVirtualAccountProvisioning,
  finishStaticVirtualAccountProvisioning,
  getWalletByUserId,
  insertAuditLog,
} from '@/lib/server/data'
import type { Wallet } from '@/types'

export const runtime = 'nodejs'

const PALMPAY_LOGGING_ENABLED = false // disabled to focus on crypto deposit logs

function logDepositAccount(event: string, payload: Record<string, unknown>) {
  if (!PALMPAY_LOGGING_ENABLED) return
  console.log(`[deposit-account] ${event}`, JSON.stringify(payload))
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
    || sensitiveIdentity.submissionId !== submittedIdentity.id
    || sensitiveIdentity.documentType !== submittedIdentity.documentType
    || submittedIdentity.status === 'rejected'
    || (sensitiveIdentity.documentType !== 'bvn' && sensitiveIdentity.documentType !== 'nin')
  ) {
    return null
  }

  return {
    documentType: sensitiveIdentity.documentType,
    documentNumber: sensitiveIdentity.documentNumber,
    identityType: sensitiveIdentity.documentType === 'nin' ? 'personal_nin' as const : 'personal' as const,
    licenseNumber: sensitiveIdentity.documentNumber,
  }
}

function getFundingIdentityError(
  submittedIdentity: Awaited<ReturnType<typeof getLatestKycSubmissionByUserId>>,
  sensitiveIdentity: Awaited<ReturnType<typeof getLatestSensitiveKycIdentityByUserId>>,
) {
  if (
    submittedIdentity?.status === 'rejected'
    && (submittedIdentity.documentType === 'bvn' || submittedIdentity.documentType === 'nin')
  ) {
    return { error: 'Your BVN or NIN submission was rejected. Submit a valid number before creating a funding account.', status: 403 }
  }
  if (!submittedIdentity || (submittedIdentity.documentType !== 'bvn' && submittedIdentity.documentType !== 'nin')) {
    return { error: 'Submit BVN or NIN before creating a funding account.', status: 403 }
  }
  if (!sensitiveIdentity || sensitiveIdentity.submissionId !== submittedIdentity.id) {
    return { error: 'Funding identity is not available in secure storage. Configure secure identity storage and resubmit BVN/NIN if needed.', status: 503 }
  }
  return { error: 'Funding identity is not available in secure storage. Configure secure identity storage and resubmit BVN/NIN if needed.', status: 503 }
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const parsed = await req.json().catch(() => null)
  const body = isRecord(parsed) ? parsed : {}
  const provider = body.provider === 'flutterwave' ? 'flutterwave' : 'palmpay'
  // logDepositAccount('request', { ... }) // bank logger silenced for crypto deposit focus

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
  if (provider === 'palmpay') {
    if (!isPalmPayVirtualAccountsEnabled()) {
      // logDepositAccount('palmpay.not_configured', { ... })
      return NextResponse.json({ error: 'PalmPay funding accounts are not configured.', success: false }, { status: 503 })
    }

    const palmpayIdentity = getFundingIdentityPayload(submittedIdentity, sensitiveIdentity)
    if (!palmpayIdentity) {
      // logDepositAccount('palmpay.eligibility_blocked', { ... }) // silenced
      const eligibility = getFundingIdentityError(submittedIdentity, sensitiveIdentity)
      return NextResponse.json({ error: eligibility.error, success: false }, { status: eligibility.status })
    }

    const claim = await claimStaticVirtualAccountProvisioning(user.id, 'palmpay')
    if (claim.state === 'ready') {
      return NextResponse.json({ data: { wallet: await getWalletByUserId(user.id) ?? wallet, virtualAccount: claim.virtualAccount, existing: true, provider }, success: true })
    }
    if (claim.state !== 'claimed') {
      const uncertain = claim.state === 'uncertain'
      return NextResponse.json({
        error: uncertain
          ? 'PalmPay may have created this funding account, but MafitaPay did not receive a confirmed response. Contact support before retrying.'
          : 'A PalmPay funding account request is already being processed. Please check again shortly.',
        code: uncertain ? 'VIRTUAL_ACCOUNT_OUTCOME_UNCERTAIN' : 'VIRTUAL_ACCOUNT_PROVISIONING',
        success: false,
      }, { status: 409 })
    }
    const reference = claim.reference

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
      const indeterminate = Boolean(providerAccount.indeterminate || providerAccount.status === 'pending')
      await finishStaticVirtualAccountProvisioning({
        userId: user.id,
        provider: 'palmpay',
        reference,
        outcome: indeterminate ? 'uncertain' : 'failed',
        failureReason: providerAccount.reason || providerAccount.rawStatus,
      })
      // logDepositAccount('palmpay.failed', { ... }) // silenced
      return NextResponse.json({
        error: indeterminate
          ? 'PalmPay may have created this funding account, but MafitaPay did not receive a confirmed response. Contact support before retrying.'
          : providerAccount.reason || 'Unable to create a PalmPay funding account.',
        code: indeterminate ? 'VIRTUAL_ACCOUNT_OUTCOME_UNCERTAIN' : undefined,
        success: false,
      }, { status: indeterminate ? 202 : 502 })
    }

    const nextAccount: Wallet['virtualAccounts'][number] = {
      bank: providerAccount.bankName || 'PalmPay',
      accountNumber: providerAccount.accountNumber,
      accountName: providerAccount.accountName || `${user.name.trim()} MAFITAPAY`,
      provider: 'palmpay',
      isPermanent: true,
      reference: providerAccount.providerReference || providerAccount.reference,
    }

    const completed = await finishStaticVirtualAccountProvisioning({
      userId: user.id,
      provider: 'palmpay',
      reference,
      outcome: 'ready',
      virtualAccount: nextAccount,
    })
    if (!completed) throw new Error('Unable to save the PalmPay funding account.')

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

    // logDepositAccount('palmpay.created', { ... }) // silenced

    return NextResponse.json({
      data: {
        wallet: completed.wallet,
        virtualAccount: completed.virtualAccount,
        existing: false,
        provider,
      },
      success: true,
    })
  }

  if (!isFlutterwaveCollectionsEnabled()) {
    // logDepositAccount('flutterwave.not_configured', { ... }) // silenced
    return NextResponse.json({ error: 'Flutterwave funding accounts are not configured.', success: false }, { status: 503 })
  }

  const flutterwaveIdentity = getFundingIdentityPayload(submittedIdentity, sensitiveIdentity)
  if (!flutterwaveIdentity) {
    // logDepositAccount('flutterwave.eligibility_blocked', { ... }) // silenced
    const eligibility = getFundingIdentityError(submittedIdentity, sensitiveIdentity)
    return NextResponse.json({ error: eligibility.error, success: false }, { status: eligibility.status })
  }

  const claim = await claimStaticVirtualAccountProvisioning(user.id, 'flutterwave')
  if (claim.state === 'ready') {
    return NextResponse.json({ data: { wallet: await getWalletByUserId(user.id) ?? wallet, virtualAccount: claim.virtualAccount, existing: true, provider }, success: true })
  }
  if (claim.state !== 'claimed') {
    const uncertain = claim.state === 'uncertain'
    return NextResponse.json({
      error: uncertain
        ? 'Flutterwave may have created this funding account, but MafitaPay did not receive a confirmed response. Contact support before retrying.'
        : 'A Flutterwave funding account request is already being processed. Please check again shortly.',
      code: uncertain ? 'VIRTUAL_ACCOUNT_OUTCOME_UNCERTAIN' : 'VIRTUAL_ACCOUNT_PROVISIONING',
      success: false,
    }, { status: 409 })
  }
  const reference = claim.reference

  const providerAccount = await createFlutterwaveStaticVirtualAccount({
    reference,
    email: user.email,
    phoneNumber: user.phone,
    firstName: firstName || user.name.trim() || 'User',
    lastName: restNames.join(' ') || 'Mafitapay',
    narration: `${user.name.trim()} MAFITAPAY`.slice(0, 35),
    identityType: flutterwaveIdentity.documentType,
    identityNumber: flutterwaveIdentity.documentNumber,
  })

  if (providerAccount.status === 'failed' || !providerAccount.accountNumber || !providerAccount.bankName) {
    const indeterminate = Boolean(providerAccount.indeterminate || providerAccount.status === 'pending')
    await finishStaticVirtualAccountProvisioning({
      userId: user.id,
      provider: 'flutterwave',
      reference,
      outcome: indeterminate ? 'uncertain' : 'failed',
      failureReason: providerAccount.reason || providerAccount.rawStatus,
    })
    return NextResponse.json({
      error: indeterminate
        ? 'Flutterwave may have created this funding account, but MafitaPay did not receive a confirmed response. Contact support before retrying.'
        : providerAccount.reason || 'Unable to create a Flutterwave funding account.',
      code: indeterminate ? 'VIRTUAL_ACCOUNT_OUTCOME_UNCERTAIN' : undefined,
      success: false,
    }, { status: indeterminate ? 202 : 502 })
  }

  const nextAccount: Wallet['virtualAccounts'][number] = {
    bank: providerAccount.bankName,
    accountNumber: providerAccount.accountNumber,
    accountName: providerAccount.accountName || `${user.name.trim()} MAFITAPAY`,
    provider: 'flutterwave',
    isPermanent: true,
    reference: providerAccount.providerReference || providerAccount.reference,
  }

  const completed = await finishStaticVirtualAccountProvisioning({
    userId: user.id,
    provider: 'flutterwave',
    reference,
    outcome: 'ready',
    virtualAccount: nextAccount,
  })
  if (!completed) throw new Error('Unable to save the Flutterwave funding account.')

  await insertAuditLog({
    userId: user.id,
    actorUserId: user.id,
    action: 'wallet.static_virtual_account_created',
    entityType: 'wallet',
    entityId: user.id,
    metadata: {
      provider: 'flutterwave',
        identityType: flutterwaveIdentity.documentType,
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
      wallet: completed.wallet,
      virtualAccount: completed.virtualAccount,
      existing: false,
      provider,
    },
    success: true,
  })
}
