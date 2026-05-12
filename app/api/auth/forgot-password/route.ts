import { NextResponse } from 'next/server'
import { consumeAuthRateLimitAttempt, createPasswordResetToken, getUserByEmail } from '@/lib/server/data'
import { deliverPasswordReset } from '@/lib/server/auth-delivery'

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isValidEmail(email: string) {
  return /^\S+@\S+\.\S+$/.test(email)
}

function buildResetLink(token: string) {
  const baseUrl = (process.env.MAFITAPAY_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`
}

function getRequestIpAddress(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  return forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || ''
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const email = normalizeEmail(body.email)
    const ipAddress = getRequestIpAddress(req)

    if (!email) {
      return NextResponse.json({ error: 'Email is required.', success: false }, { status: 400 })
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.', success: false }, { status: 400 })
    }

    const rateLimit = await consumeAuthRateLimitAttempt({
      action: 'forgot_password',
      scopes: [`email:${email}`, ...(ipAddress ? [`ip:${ipAddress}`] : [])],
      limit: 3,
      windowMinutes: 15,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many reset requests. Try again shortly.',
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

    const genericMessage = 'If an account exists for that email, a password reset link has been prepared.'
    const user = await getUserByEmail(email)

    if (!user || user.accountStatus === 'deactivated') {
      return NextResponse.json({ data: { message: genericMessage }, success: true })
    }

    const reset = await createPasswordResetToken(user.id, {
      userAgent: req.headers.get('user-agent') ?? undefined,
      ipAddress: ipAddress || undefined,
    })
    const resetLink = buildResetLink(reset.token)
    const delivery = await deliverPasswordReset({
      email: user.email,
      phone: user.phone,
      resetLink,
      expiresAt: reset.expiresAt,
    })

    return NextResponse.json({
      data: {
        message: genericMessage,
        resetLink: process.env.NODE_ENV === 'production' || delivery.delivered ? undefined : resetLink,
        expiresAt: process.env.NODE_ENV === 'production' ? undefined : reset.expiresAt,
        delivery: process.env.NODE_ENV === 'production' ? undefined : delivery,
      },
      success: true,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to prepare password reset.',
        success: false,
      },
      { status: 500 }
    )
  }
}
