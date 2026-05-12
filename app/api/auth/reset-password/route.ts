import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  consumeAuthRateLimitAttempt,
  consumePasswordResetToken,
  getUserById,
  revokeOtherUserSessions,
  updateUserPassword,
} from '@/lib/server/data'

function isStrongEnoughPassword(password: string) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
}

function getRequestIpAddress(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  return forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || ''
}

export async function POST(req: Request) {
  const body = await req.json()
  const token = typeof body.token === 'string' ? body.token : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const ipAddress = getRequestIpAddress(req)

  if (!token || !password) {
    return NextResponse.json({ error: 'Reset token and new password are required.', success: false }, { status: 400 })
  }

  if (!isStrongEnoughPassword(password)) {
    return NextResponse.json({ error: 'Password must be at least 8 characters and include both letters and numbers.', success: false }, { status: 400 })
  }

  const tokenScope = `token:${createHash('sha256').update(token.trim()).digest('hex')}`
  const rateLimit = await consumeAuthRateLimitAttempt({
    action: 'reset_password',
    scopes: [tokenScope, ...(ipAddress ? [`ip:${ipAddress}`] : [])],
    limit: 5,
    windowMinutes: 15,
  })
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many password reset attempts. Try again shortly.',
        success: false,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      }
    )
  }

  const reset = await consumePasswordResetToken(token)
  if (!reset) {
    return NextResponse.json({ error: 'This password reset link is invalid or has expired.', success: false }, { status: 400 })
  }

  const user = await getUserById(reset.userId)
  if (!user) {
    return NextResponse.json({ error: 'Account not found for this reset link.', success: false }, { status: 404 })
  }

  await updateUserPassword(user.id, password)
  await revokeOtherUserSessions(user.id)

  return NextResponse.json({
    data: {
      message: 'Password reset successful. Sign in with your new password.',
    },
    success: true,
  })
}
