import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { consumeAuthRateLimitAttempt, createDeviceLoginToken, insertAuditLog } from '@/lib/server/data'

const DEVICE_TOKEN_TTL_DAYS = 90

function requestMetadata(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  return {
    ipAddress: forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || '',
    userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? '',
  }
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()
  const metadata = requestMetadata(req)
  const scopes = [`user:${user.id}`, ...(metadata.ipAddress ? [`ip:${metadata.ipAddress}`] : [])]
  const rateLimit = await consumeAuthRateLimitAttempt({ action: 'device_login_enroll', scopes, limit: 5, windowMinutes: 60 })
  if (!rateLimit.allowed) return NextResponse.json({ error: 'Too many device enrollments. Try again later.', success: false }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } })

  let body: { deviceLabel?: unknown } = {}
  try { body = await req.json() as typeof body } catch { /* use the default label */ }
  const now = new Date()
  const rawToken = randomBytes(32).toString('base64url')
  const id = `dlt_${randomBytes(12).toString('hex')}`
  const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 48) : ''
  const created = await createDeviceLoginToken({
    id,
    userId: user.id,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    deviceLabel: deviceLabel || 'Android device',
    platform: 'android',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    userAgent: metadata.userAgent,
    ipAddress: metadata.ipAddress,
  })
  if (!created.created) {
    if (created.reason === 'device_limit') return NextResponse.json({ error: 'You have reached the limit of five enrolled devices. Remove one before adding this device.', success: false }, { status: 409 })
    return unauthorized()
  }

  await insertAuditLog({ userId: user.id, actorUserId: user.id, action: 'auth.device_login_enrolled', entityType: 'device_login_token', entityId: id, metadata: { deviceLabel: deviceLabel || 'Android device', platform: 'android' } })
  await appendNotification(user.id, createNotification({ userId: user.id, title: 'Fingerprint sign-in enabled', message: `Fingerprint sign-in was enabled on ${deviceLabel || 'an Android device'}. If you did not do this, change your password and sign out other devices.`, type: 'info' }), { email: true })
  return NextResponse.json({ data: { id, token: rawToken }, success: true }, { status: 201 })
}
