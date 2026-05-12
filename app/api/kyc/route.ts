import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { createKycSubmission, getLatestKycSubmissionByUserId, getSensitiveIdentityConfigState, maskDocumentNumber } from '@/lib/server/data'
import type { KycSubmission } from '@/types'

const VALID_DOCUMENT_TYPES: KycSubmission['documentType'][] = [
  'nin',
  'bvn',
  'passport',
  'drivers_license',
  'voters_card',
]

function normalizeDocumentNumber(documentType: KycSubmission['documentType'], documentNumber: string) {
  const trimmed = documentNumber.trim()
  if (documentType === 'bvn' || documentType === 'nin') {
    return trimmed.replace(/\D/g, '')
  }
  return trimmed
}

function validateDocumentNumber(documentType: KycSubmission['documentType'], documentNumber: string) {
  if (documentType === 'bvn' || documentType === 'nin') {
    return /^\d{11}$/.test(documentNumber)
  }
  return documentNumber.length >= 5
}

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const submission = await getLatestKycSubmissionByUserId(user.id)
  return NextResponse.json({
    data: submission
      ? {
          ...submission,
          documentNumber: maskDocumentNumber(submission.documentType, submission.documentNumber),
        }
      : null,
    success: true,
  })
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const documentType = body.documentType as KycSubmission['documentType']
  const rawDocumentNumber = typeof body.documentNumber === 'string' ? body.documentNumber : ''
  const documentNumber = VALID_DOCUMENT_TYPES.includes(documentType)
    ? normalizeDocumentNumber(documentType, rawDocumentNumber)
    : ''
  const documentUrl = typeof body.documentUrl === 'string' ? body.documentUrl.trim() : ''
  const documentName = typeof body.documentName === 'string' ? body.documentName.trim() : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : ''
  const fileSize = typeof body.fileSize === 'number' && Number.isFinite(body.fileSize) ? body.fileSize : undefined
  const uploadRequired = documentType !== 'bvn' && documentType !== 'nin'

  if (!VALID_DOCUMENT_TYPES.includes(documentType) || !documentNumber || (uploadRequired && !documentUrl)) {
    return NextResponse.json({
      error: uploadRequired
        ? 'Valid document type, number, and upload reference are required.'
        : 'Valid document type and number are required.',
      success: false,
    }, { status: 400 })
  }

  if (!validateDocumentNumber(documentType, documentNumber)) {
    return NextResponse.json({
      error: documentType === 'bvn' || documentType === 'nin'
        ? `${documentType.toUpperCase()} must be exactly 11 digits.`
        : 'Document number looks invalid.',
      success: false,
    }, { status: 400 })
  }

  if ((documentType === 'bvn' || documentType === 'nin') && !getSensitiveIdentityConfigState().configured) {
    return NextResponse.json({
      error: 'Secure identity storage is not configured. BVN/NIN submission is temporarily unavailable.',
      success: false,
    }, { status: 503 })
  }

  const submission = await createKycSubmission({
    userId: user.id,
    documentType,
    documentNumber,
    documentUrl,
    documentName: documentName || undefined,
    mimeType: mimeType || undefined,
    fileSize,
  })

  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: 'KYC submitted',
    message: 'Your verification documents were submitted for review.',
    type: 'info',
  }))

  return NextResponse.json({
    data: {
      ...submission,
      documentNumber: maskDocumentNumber(submission.documentType, submission.documentNumber),
    },
    success: true,
  }, { status: 201 })
}
