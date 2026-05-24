import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireAdminUser, unauthorized } from '@/lib/server/auth'
import { listKycSubmissions, reviewKycSubmission } from '@/lib/server/data'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: await listKycSubmissions(), success: true })
}

export async function PATCH(req: Request) {
  const reviewer = await requireAdminUser()
  if (!reviewer) return unauthorized()

  const body = await req.json()
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId : ''
  const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : null
  const notes = typeof body.notes === 'string' ? body.notes : undefined

  if (!submissionId || !status) {
    return NextResponse.json({ error: 'submissionId and valid status are required.', success: false }, { status: 400 })
  }

  const submission = await reviewKycSubmission({
    submissionId,
    reviewerUserId: reviewer.id,
    status,
    notes,
  })

  if (!submission) {
    return NextResponse.json({ error: 'KYC submission not found.', success: false }, { status: 404 })
  }

  await appendNotification(submission.userId, createNotification({
    userId: submission.userId,
    title: status === 'approved' ? 'KYC approved' : 'KYC rejected',
    message:
      status === 'approved'
        ? submission.documentType === 'bvn' || submission.documentType === 'nin'
          ? `Your ${submission.documentType.toUpperCase()} verification has been approved. You can now create a secondary Flutterwave funding account.`
          : 'Your verification has been approved and your account tier was upgraded. Flutterwave funding accounts still require an approved BVN or NIN.'
        : `Your verification was rejected.${notes ? ` Reason: ${notes}` : ''}`,
    type: status === 'approved' ? 'success' : 'error',
  }))

  return NextResponse.json({ data: submission, success: true })
}
