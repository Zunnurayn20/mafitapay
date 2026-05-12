import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getUserByEmail, getUserByHandle, recordBeneficiaryVerification, upsertBeneficiary } from '@/lib/server/data'
import { resolveBankBeneficiary } from '@/lib/server/bank-resolution'
import { generateRef } from '@/lib/utils'

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const kind = body.kind === 'internal' ? 'internal' : 'bank'

  if (kind === 'internal') {
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : ''
    if (!recipient) {
      return NextResponse.json({ error: 'recipient is required.', success: false }, { status: 400 })
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

    const beneficiary = await upsertBeneficiary({
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
    const verificationRecord = await recordBeneficiaryVerification({
      beneficiaryId: beneficiary.id,
      userId: user.id,
      kind: 'internal',
      provider: 'internal_directory',
      status: 'verified',
      reference: beneficiary.verificationReference,
      handle: target.handle,
    })

    return NextResponse.json({
      data: {
        beneficiary,
        verification: verificationRecord,
        recipient: {
          id: target.id,
          name: target.name,
          handle: target.handle,
          email: target.email,
        },
      },
      success: true,
    })
  }

  try {
    const result = await resolveBankBeneficiary(body)
    const checkedAt = new Date().toISOString()
    const beneficiary = await upsertBeneficiary({
      userId: user.id,
      kind: 'bank',
      label: `${result.accountName} · ${result.bankName}`,
      bankCode: result.bankCode,
      bankName: result.bankName,
      accountNumber: result.accountNumber,
      accountName: result.accountName,
      verifiedAt: result.status === 'verified' ? checkedAt : undefined,
      verificationProvider: result.provider,
      verificationStatus: result.status,
      verificationReference: result.reference,
      verificationCheckedAt: checkedAt,
      verificationReason: result.reason,
    })
    const verificationRecord = await recordBeneficiaryVerification({
      beneficiaryId: beneficiary.id,
      userId: user.id,
      kind: 'bank',
      provider: result.provider,
      status: result.status,
      reference: result.reference,
      bankCode: result.bankCode,
      bankName: result.bankName,
      accountNumber: result.accountNumber,
      accountName: result.accountName,
      errorCode: result.errorCode,
      payload: result.payload,
      reason: result.reason,
    })

    if (result.status !== 'verified') {
      return NextResponse.json({
        data: {
          beneficiary,
          verificationRecord,
          verification: {
            bankCode: result.bankCode,
            bankName: result.bankName,
            accountNumber: result.accountNumber,
            accountName: result.accountName,
            provider: result.provider,
            reason: result.reason,
            errorCode: result.errorCode,
            status: result.status,
            verified: false,
          },
        },
        error: result.reason || 'Beneficiary verification failed.',
        success: false,
      }, { status: 400 })
    }

    return NextResponse.json({
      data: {
        beneficiary,
        verificationRecord,
        verification: {
          bankCode: result.bankCode,
          bankName: result.bankName,
          accountNumber: result.accountNumber,
          accountName: result.accountName,
          provider: result.provider,
          reason: result.reason,
          errorCode: result.errorCode,
          status: result.status,
          verified: true,
        },
      },
      success: true,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid beneficiary details.', success: false }, { status: 400 })
  }
}
