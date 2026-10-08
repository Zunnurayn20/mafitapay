import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { buildSessionPayload, createSession, requireUser, unauthorized } from '@/lib/server/auth'
import {
  consumeAuthRateLimitAttempt,
  getDeviceLoginTokenById,
  getUserById,
  insertAuditLog,
  listDeviceLoginTokensForUser,
  revokeDeviceLoginTokenById,
  revokeDeviceLoginTokensForUser,
  rotateDeviceLoginToken,
} from '@/lib/server/data'

const DEVICE_TOKEN_TTL_DAYS = 90

function requestMetadata(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  return {
    ipAddress: forwarded.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || '',
    userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? '',
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function matchesHash(expectedHex: string | null | undefined, actualHex: string) {
  if (!expectedHex || !/^[a-f0-9]{64}$/i.test(expectedHex)) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = Buffer.from(actualHex, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function invalidDeviceLogin() {
  return NextResponse.json({ error: 'Fingerprint sign-in is no longer valid. Sign in with your password or email code.', success: false }, { status: 401 })
}

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()
  const devices = await listDeviceLoginTokensForUser(user.id)
  return NextResponse.json({ data: devices.map(({ id, deviceLabel, platform, createdAt, lastUsedAt, expiresAt }) => ({ id, deviceLabel, platform, createdAt, lastUsedAt, expiresAt })), success: true })
}

export async function DELETE(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()
  let body: { id?: unknown; all?: unknown }
  try { body = await req.json() as typeof body } catch { return NextResponse.json({ error: 'A device ID or all=true is required.', success: false }, { status: 400 }) }
  if (body.all === true) {
    const count = await revokeDeviceLoginTokensForUser(user.id)
    await insertAuditLog({ userId: user.id, actorUserId: user.id, action: 'auth.device_login_revoked_all', entityType: 'user', entityId: user.id, metadata: { count } })
    return NextResponse.json({ data: { revokedCount: count }, success: true })
  }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!/^dlt_[a-f0-9]{24}$/.test(id)) return NextResponse.json({ error: 'A valid device ID is required.', success: false }, { status: 400 })
  const revoked = await revokeDeviceLoginTokenById(id, user.id)
  if (revoked) await insertAuditLog({ userId: user.id, actorUserId: user.id, action: 'auth.device_login_revoked', entityType: 'device_login_token', entityId: id })
  return NextResponse.json({ data: { revoked }, success: true })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { id?: unknown; token?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!/^dlt_[a-f0-9]{24}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return invalidDeviceLogin()

  const metadata = requestMetadata(req)
  const rateLimit = await consumeAuthRateLimitAttempt({ action: 'device_login', scopes: [`device:${id}`, ...(metadata.ipAddress ? [`ip:${metadata.ipAddress}`] : [])], limit: 5, windowMinutes: 15 })
  if (!rateLimit.allowed) return NextResponse.json({ error: 'Too many sign-in attempts. Try again shortly.', success: false }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } })

  const row = await getDeviceLoginTokenById(id)
  if (!row || row.revokedAt || new Date(row.expiresAt).getTime() <= Date.now()) return invalidDeviceLogin()
  const presentedHash = hashToken(token)
  if (!matchesHash(row.tokenHash, presentedHash)) {
    if (matchesHash(row.previousTokenHash, presentedHash)) {
      const revoked = await revokeDeviceLoginTokenById(id)
      if (revoked) await insertAuditLog({ userId: row.userId, action: 'auth.device_login_replay_detected', entityType: 'device_login_token', entityId: id, metadata: { platform: 'android' } })
    }
    return invalidDeviceLogin()
  }

  const user = await getUserById(row.userId)
  if (!user || user.accountStatus !== 'active') {
    await revokeDeviceLoginTokenById(id)
    return invalidDeviceLogin()
  }

  const now = new Date()
  const rotatedToken = randomBytes(32).toString('base64url')
  const rotated = await rotateDeviceLoginToken(id, row.tokenHash, hashToken(rotatedToken), now.toISOString(), new Date(now.getTime() + DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString())
  if (!rotated) {
    const latest = await getDeviceLoginTokenById(id)
    if (latest && matchesHash(latest.previousTokenHash, presentedHash)) {
      const revoked = await revokeDeviceLoginTokenById(id)
      if (revoked) await insertAuditLog({ userId: row.userId, action: 'auth.device_login_replay_detected', entityType: 'device_login_token', entityId: id, metadata: { platform: 'android' } })
    }
    return invalidDeviceLogin()
  }

  await createSession(user.id, metadata)
  await insertAuditLog({ userId: user.id, action: 'auth.device_login', entityType: 'device_login_token', entityId: id, metadata: { platform: 'android' } })
  return NextResponse.json({ data: await buildSessionPayload(user), rotated: { id, token: rotatedToken }, success: true })
}
