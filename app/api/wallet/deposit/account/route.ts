import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { createCngnVirtualAccount, isCngnMerchantEnabled } from '@/lib/server/cngn'
import { createFlutterwaveStaticVirtualAccount, isFlutterwaveCollectionsEnabled } from '@/lib/server/flutterwave-collections'
import { getLatestKycSubmissionByUserId, getLatestSensitiveKycIdentityByUserId, getWalletByUserId, insertAuditLog, updateWalletVirtualAccounts } from '@/lib/server/data'
import { generateRef } from '@/lib/utils'

export const runtime = 'nodejs'

export async function POST() {
  const user = await requireUser()
  if (!user) return unauthorized()

  if (!isFlutterwaveCollectionsEnabled() && !isCngnMerchantEnabled()) {
    return NextResponse.json({ error: 'No funding-account provider is configured.', success: false }, { status: 503 })
  }

  const wallet = await getWalletByUserId(user.id)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found.', success: false }, { status: 404 })
  }

  const existing = wallet.virtualAccounts.find(item => (item.provider === 'flutterwave' || item.provider === 'cngn') && item.isPermanent)
  if (existing) {
    return NextResponse.json({ data: { virtualAccount: existing, existing: true }, success: true })
  }

  const approvedIdentity = await getLatestKycSubmissionByUserId(user.id)
  if (!approvedIdentity || approvedIdentity.status !== 'approved' || (approvedIdentity.documentType !== 'bvn' && approvedIdentity.documentType !== 'nin')) {
    return NextResponse.json({
      error: 'An approved BVN or NIN KYC record is required before creating a permanent funding account.',
      success: false,
    }, { status: 403 })
  }

  const sensitiveIdentity = await getLatestSensitiveKycIdentityByUserId(user.id)
  if (!sensitiveIdentity || sensitiveIdentity.documentType !== approvedIdentity.documentType) {
    return NextResponse.json({
      error: 'Approved funding identity is not available in secure storage. Configure secure identity storage and resubmit BVN/NIN if needed.',
      success: false,
    }, { status: 503 })
  }

  const [firstName, ...restNames] = user.name.trim().split(/\s+/).filter(Boolean)
  const reference = `static_va_${generateRef()}`
  let nextPrimaryAccount: {
    bank: string
    accountNumber: string
    accountName: string
    provider: 'flutterwave' | 'cngn'
    isPermanent: boolean
    reference?: string
  }
  let fundingProvider: 'flutterwave' | 'cngn'

  if (isCngnMerchantEnabled()) {
    try {
      const cngnAccount = await createCngnVirtualAccount()
      nextPrimaryAccount = cngnAccount
      fundingProvider = 'cngn'
    } catch (error) {
      if (!isFlutterwaveCollectionsEnabled()) {
        return NextResponse.json({
          error: error instanceof Error ? error.message : 'Unable to create a funding account.',
          success: false,
        }, { status: 502 })
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
          error: providerAccount.reason || (error instanceof Error ? error.message : 'Unable to create a permanent funding account.'),
          success: false,
        }, { status: 502 })
      }

      nextPrimaryAccount = {
        bank: providerAccount.bankName,
        accountNumber: providerAccount.accountNumber,
        accountName: providerAccount.accountName || `${user.name.trim()} MAFITAPAY`,
        provider: 'flutterwave',
        isPermanent: true,
        reference: providerAccount.providerReference || providerAccount.reference,
      }
      fundingProvider = 'flutterwave'
    }
  } else {
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
        error: providerAccount.reason || 'Unable to create a permanent funding account.',
        success: false,
      }, { status: 502 })
    }

    nextPrimaryAccount = {
      bank: providerAccount.bankName,
      accountNumber: providerAccount.accountNumber,
      accountName: providerAccount.accountName || `${user.name.trim()} MAFITAPAY`,
      provider: 'flutterwave',
      isPermanent: true,
      reference: providerAccount.providerReference || providerAccount.reference,
    }
    fundingProvider = 'flutterwave'
  }

  const nextAccounts = [
    nextPrimaryAccount,
    ...wallet.virtualAccounts.filter(item => !((item.provider === 'flutterwave' || item.provider === 'cngn') && item.isPermanent)),
  ]

  const updatedWallet = await updateWalletVirtualAccounts(user.id, nextAccounts)

  await insertAuditLog({
      userId: user.id,
      actorUserId: user.id,
      action: 'wallet.static_virtual_account_created',
      entityType: 'wallet',
      entityId: user.id,
      metadata: {
      provider: fundingProvider,
      identityType: sensitiveIdentity.documentType,
      accountNumber: nextPrimaryAccount.accountNumber,
      bankName: nextPrimaryAccount.bank,
      },
  })

  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: 'Permanent funding account ready',
    message: `${nextPrimaryAccount.accountNumber} at ${nextPrimaryAccount.bank} is now your permanent wallet funding account.`,
    type: 'success',
  }))

  return NextResponse.json({
    data: {
      wallet: updatedWallet ?? wallet,
      virtualAccount: nextAccounts[0],
      existing: false,
    },
    success: true,
  })
}
