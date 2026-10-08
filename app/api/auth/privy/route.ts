import { randomBytes } from 'node:crypto'
import { verifyIdentityToken } from '@privy-io/node'
import { createRemoteJWKSet } from 'jose'
import { NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/auth/validation'
import { createSession } from '@/lib/server/auth'
import {
  activateUserAccount,
  createUser,
  getUserByEmail,
  getUserByPrivyId,
  linkPrivyIdentityToUser,
} from '@/lib/server/data'

export const runtime = 'nodejs'

const privyJwksByAppId = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getPrivyJwks(appId: string) {
  let jwks = privyJwksByAppId.get(appId)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://api.privy.io/v1/apps/${encodeURIComponent(appId)}/jwks.json`))
    privyJwksByAppId.set(appId, jwks)
  }
  return jwks
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}



export async function POST(req: Request) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()
  if (!appId) {
    return NextResponse.json({ error: 'Privy sign-in is not configured yet.', success: false }, { status: 503 })
  }

  try {
    const body = await req.json()
    const intent = body.intent === 'register' ? 'register' : body.intent === 'login' ? 'login' : null
    const identityToken = typeof body.identityToken === 'string' ? body.identityToken.trim() : ''
    const requestedEmail = normalizeEmail(body.email)
    if (!intent || !identityToken || identityToken.length > 16_000) {
      return NextResponse.json({ error: 'A valid Privy sign-in is required.', success: false }, { status: 400 })
    }

    const verifiedPrivyUser = await verifyIdentityToken({
      identity_token: identityToken,
      app_id: appId,
      verification_key: getPrivyJwks(appId),
    })
    const verifiedEmails = verifiedPrivyUser.linked_accounts
      .filter((account): account is Extract<typeof verifiedPrivyUser.linked_accounts[number], { type: 'email' }> => (
        account.type === 'email' && account.verified_at > 0
      ))
      .map(account => account.address.trim().toLowerCase())
    const email = requestedEmail
      ? verifiedEmails.find(candidate => candidate === requestedEmail)
      : verifiedEmails.length === 1 ? verifiedEmails[0] : undefined
    if (!email) {
      return NextResponse.json({ error: 'Use a verified email address in the Privy sign-in window.', success: false }, { status: 403 })
    }

    let user = await getUserByPrivyId(verifiedPrivyUser.id)
    if (!user) {
      user = await getUserByEmail(email)
      if (!user && intent === 'register') {
        const name = typeof body.profile?.name === 'string' ? body.profile.name.trim() : ''
        const phone = typeof body.profile?.phone === 'string' ? normalizePhone(body.profile.phone) : ''
        const referralCode = typeof body.profile?.referralCode === 'string'
          ? body.profile.referralCode.trim().toUpperCase()
          : ''
        if (name.length < 2 || name.length > 120) {
          return NextResponse.json({ error: 'Enter your full name to create your account.', success: false }, { status: 400 })
        }
        if (!/^\+?[1-9]\d{9,14}$/.test(phone)) {
          return NextResponse.json({ error: 'Enter a valid phone number to create your account.', success: false }, { status: 400 })
        }

        user = await createUser({
          name,
          email,
          phone,
          // Privy owns the login credential. Keep the legacy password column filled with an
          // unshared random value while both auth paths are available in this preview.
          password: randomBytes(32).toString('base64url'),
          referralCode: referralCode || undefined,
        })
        user = await activateUserAccount(user.id)
      }

      if (!user) {
        return NextResponse.json({
          error: 'No MafitaPay account exists for this email yet. Create one with email code first.',
          success: false,
        }, { status: 404 })
      }

      if (user.accountStatus === 'deactivated') {
        return NextResponse.json({ error: 'This MafitaPay account has been deactivated.', success: false }, { status: 403 })
      }

      await linkPrivyIdentityToUser(user.id, verifiedPrivyUser.id)
    }

    if (user.accountStatus === 'deactivated') {
      return NextResponse.json({ error: 'This MafitaPay account has been deactivated.', success: false }, { status: 403 })
    }
    if (user.accountStatus === 'pending_verification') {
      user = await activateUserAccount(user.id)
    }
    if (!user) {
      return NextResponse.json({ error: 'Unable to load your MafitaPay account.', success: false }, { status: 500 })
    }

    await createSession(user.id, {
      userAgent: req.headers.get('user-agent') ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    })
    // The session cookie is the authentication commit point. Dashboard data is fetched
    // separately after navigation so a slow/contended database read cannot strand a user
    // on the sign-in screen after their session has already been created.
    return NextResponse.json({ data: { user }, success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes('already linked to another MafitaPay account')) {
      return NextResponse.json({ error: error.message, success: false }, { status: 409 })
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to complete Privy sign-in.',
      success: false,
    }, { status: 401 })
  }
}
