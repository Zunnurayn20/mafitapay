import { NextResponse } from 'next/server'
import { createEmailVerificationToken, consumeAuthRateLimitAttempt, getLatestEmailVerificationCreatedAt, getUserByEmail, insertAuditLog } from '@/lib/server/data'
import { deliverEmailVerification, getMafitaPayAppUrl, shouldExposeDevAuthLinks } from '@/lib/server/auth-delivery'
import { EMAIL_RE } from '@/lib/auth/validation'

const genericMessage = "If an account is waiting for verification, we've sent a new link."
function requestIp(request: Request) {
  return (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || ''
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) return NextResponse.json({ success: false, error: 'Enter a valid email address.' }, { status: 400 })

  const ipAddress = requestIp(request)
  const scopes = [`email:${email}`, ...(ipAddress ? [`ip:${ipAddress}`] : [])]
  const rateLimit = await consumeAuthRateLimitAttempt({ action: 'verify_email_resend', scopes, limit: 3, windowMinutes: 30 })
  if (!rateLimit.allowed) return NextResponse.json({ success: false, error: 'Please wait before requesting another link.' }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } })

  const user = await getUserByEmail(email)
  let verificationLink: string | undefined
  let delivery: Awaited<ReturnType<typeof deliverEmailVerification>> | undefined
  const retryAfterSeconds = 45
  if (user?.accountStatus === 'pending_verification') {
    const latest = await getLatestEmailVerificationCreatedAt(user.id)
    const elapsed = latest ? Math.floor((Date.now() - new Date(latest).getTime()) / 1000) : 45
    if (latest && elapsed < 45) {
      const retry = 45 - Math.max(0, elapsed)
      return NextResponse.json({ success: false, error: 'Please wait before requesting another link.', retryAfterSeconds: retry }, { status: 429, headers: { 'Retry-After': String(retry) } })
    }
    const verification = await createEmailVerificationToken(user.id, { userAgent: request.headers.get('user-agent') ?? undefined, ipAddress: ipAddress || undefined })
    verificationLink = `${getMafitaPayAppUrl(new URL(request.url).origin)}/verify-email?token=${encodeURIComponent(verification.token)}`
    delivery = await deliverEmailVerification({ email, verificationLink, expiresAt: verification.expiresAt })
    await insertAuditLog({ userId: user.id, action: 'auth.email_verification_resent', entityType: 'user', entityId: user.id })
  }

  return NextResponse.json({ success: true, data: {
    message: genericMessage,
    retryAfterSeconds,
    ...(shouldExposeDevAuthLinks() && verificationLink && !delivery?.delivered ? { verificationLink, delivery } : {}),
  } })
}
