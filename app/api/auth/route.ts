import { NextResponse } from 'next/server'
import { buildSessionPayload, destroySession, getCurrentUser, loginUser } from '@/lib/server/auth'
import {
  clearAuthRateLimitAttempts,
  consumeAuthRateLimitAttempt,
  createEmailVerificationToken,
  createUser,
  ensureCryptoMarketAutoRefreshScheduler,
  kickCryptoMarketRefresh,
} from '@/lib/server/data'
import { deliverEmailVerification } from '@/lib/server/auth-delivery'
import { ensureFlutterwaveBillSyncScheduler, kickPendingFlutterwaveBillSync } from '@/lib/server/flutterwave-bill-sync-batch'

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizePhone(value: unknown) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(/[^\d+]/g, '')
  if (normalized.startsWith('+')) return normalized
  if (normalized.startsWith('0')) return `+234${normalized.slice(1)}`
  if (normalized.startsWith('234')) return `+${normalized}`
  return normalized
}

function isValidEmail(email: string) {
  return /^\S+@\S+\.\S+$/.test(email)
}

function isValidPhone(phone: string) {
  return /^\+?[1-9]\d{9,14}$/.test(phone)
}

function isStrongEnoughPassword(password: string) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
}

function getRequestIpAddress(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  return forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || ''
}

function buildEmailVerificationLink(token: string) {
  const baseUrl = (process.env.MAFITAPAY_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`
}

export async function GET() {
  ensureCryptoMarketAutoRefreshScheduler()
  void kickCryptoMarketRefresh()
  ensureFlutterwaveBillSyncScheduler()
  void kickPendingFlutterwaveBillSync()
  const user = await getCurrentUser()
  if (!user) {
    await destroySession()
    return NextResponse.json({ data: null, success: true })
  }

  return NextResponse.json({ data: await buildSessionPayload(user), success: true })
}

export async function POST(req: Request) {
  ensureCryptoMarketAutoRefreshScheduler()
  void kickCryptoMarketRefresh()
  ensureFlutterwaveBillSyncScheduler()
  void kickPendingFlutterwaveBillSync()
  const body = await req.json()
  const email = normalizeEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  const ipAddress = getRequestIpAddress(req)

  if (!email || !password) {
    return NextResponse.json({ error: 'Missing credentials', success: false }, { status: 400 })
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.', success: false }, { status: 400 })
  }

  const rateLimit = await consumeAuthRateLimitAttempt({
    action: 'login',
    scopes: [`email:${email}`, ...(ipAddress ? [`ip:${ipAddress}`] : [])],
    limit: 5,
    windowMinutes: 15,
  })
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many sign-in attempts. Try again shortly.',
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

  try {
    const data = await loginUser(email, password, {
      userAgent: req.headers.get('user-agent') ?? undefined,
      ipAddress: ipAddress || undefined,
    })
    await clearAuthRateLimitAttempts({
      action: 'login',
      scopes: [`email:${email}`, ...(ipAddress ? [`ip:${ipAddress}`] : [])],
    })
    return NextResponse.json({ data, success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to sign in.', success: false },
      { status: 401 }
    )
  }
}

export async function PUT(req: Request) {
  ensureCryptoMarketAutoRefreshScheduler()
  void kickCryptoMarketRefresh()
  ensureFlutterwaveBillSyncScheduler()
  void kickPendingFlutterwaveBillSync()
  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = normalizeEmail(body.email)
  const phone = normalizePhone(body.phone)
  const password = typeof body.password === 'string' ? body.password : ''
  const referralCode = typeof body.referralCode === 'string' ? body.referralCode.trim().toUpperCase() : ''

  if (!name || !email || !phone || !password) {
    return NextResponse.json({ error: 'Missing registration fields', success: false }, { status: 400 })
  }
  if (name.length < 2) {
    return NextResponse.json({ error: 'Full name must be at least 2 characters.', success: false }, { status: 400 })
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.', success: false }, { status: 400 })
  }
  if (!isValidPhone(phone)) {
    return NextResponse.json({ error: 'Enter a valid phone number.', success: false }, { status: 400 })
  }
  if (!isStrongEnoughPassword(password)) {
    return NextResponse.json({ error: 'Password must be at least 8 characters and include both letters and numbers.', success: false }, { status: 400 })
  }

  try {
    const user = await createUser({ name, email, phone, password, referralCode: referralCode || undefined })
    const emailVerification = await createEmailVerificationToken(user.id, {
      userAgent: req.headers.get('user-agent') ?? undefined,
      ipAddress: getRequestIpAddress(req) || undefined,
    })
    const verificationLink = buildEmailVerificationLink(emailVerification.token)
    const delivery = await deliverEmailVerification({
      email: user.email,
      verificationLink,
      expiresAt: emailVerification.expiresAt,
    })
    return NextResponse.json({
      data: {
        message: 'Account created. Verify your email address before signing in.',
        requiresEmailVerification: true,
        email: user.email,
        verificationLink: process.env.NODE_ENV === 'production' || delivery.delivered ? undefined : verificationLink,
        delivery: process.env.NODE_ENV === 'production' ? undefined : delivery,
      },
      success: true,
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create account.', success: false },
      { status: 400 }
    )
  }
}

export async function DELETE() {
  await destroySession()
  return NextResponse.json({ success: true })
}
