import { NextResponse } from 'next/server'
import { activateUserAccount, consumeAuthRateLimitAttempt, consumeEmailVerificationToken, getUserById } from '@/lib/server/data'

function getRequestIpAddress(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  return forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || ''
}

export async function POST(req: Request) {
  const body = await req.json()
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const ipAddress = getRequestIpAddress(req)

  if (!token) {
    return NextResponse.json({ error: 'Verification token is required.', success: false }, { status: 400 })
  }

  const rateLimit = await consumeAuthRateLimitAttempt({
    action: 'verify_email',
    scopes: [`verify:${token.slice(0, 16)}`, ...(ipAddress ? [`ip:${ipAddress}`] : [])],
    limit: 8,
    windowMinutes: 30,
  })
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many verification attempts. Try again shortly.', success: false },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    )
  }

  const verification = await consumeEmailVerificationToken(token)
  if (!verification) {
    return NextResponse.json({ error: 'This verification link is invalid or has expired.', success: false }, { status: 400 })
  }

  const user = await getUserById(verification.userId)
  if (!user) {
    return NextResponse.json({ error: 'Account not found for this verification link.', success: false }, { status: 404 })
  }

  if (user.accountStatus !== 'active') {
    await activateUserAccount(user.id)
  }

  return NextResponse.json({
    data: {
      message: 'Email verified successfully. You can now sign in.',
    },
    success: true,
  })
}
