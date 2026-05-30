import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { FundingAccountEligibility } from '@/types'
import { isAdminEmail } from '@/lib/admin-access'
import {
  NotificationRecord,
  createNotification,
  deleteSessionByToken,
  getNotificationsForUser,
  getLatestKycSubmissionByUserId,
  getSessionByToken,
  getSessionsForUser,
  getSecuritySettingsByUserId,
  getTransactionsForUser,
  getUserByEmail,
  getUserById,
  getWalletByUserId as _getWalletByUserId,
  insertNotification,
  insertSession,
  maskDocumentNumber,
  sanitizeUser,
  SessionRecord,
  StoredUser,
  verifyPassword,
} from './data'

export const SESSION_COOKIE = 'mfp_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export interface SessionPayload {
  user: ReturnType<typeof sanitizeUser>
  wallet: Awaited<ReturnType<typeof getWalletByUserId>>
  transactions: Awaited<ReturnType<typeof getTransactionsByUserId>>
  notifications: Awaited<ReturnType<typeof getNotificationsByUserId>>
  sessions: Awaited<ReturnType<typeof getSessionsByUserId>>
  securitySettings: Awaited<ReturnType<typeof getSecuritySettingsByUserId>>
  kycSubmission: Awaited<ReturnType<typeof getLatestKycSubmissionByUserId>>
  fundingAccountEligibility: FundingAccountEligibility
  currentSessionToken: string | null
}

async function getCookieStore() {
  return cookies()
}

export async function getSessionToken() {
  const cookieStore = await getCookieStore()
  return cookieStore.get(SESSION_COOKIE)?.value ?? null
}

export async function getWalletByUserId(userId: string) {
  return _getWalletByUserId(userId)
}

export async function getTransactionsByUserId(userId: string) {
  return getTransactionsForUser(userId)
}

export async function getNotificationsByUserId(userId: string) {
  return getNotificationsForUser(userId)
}

export async function getSessionsByUserId(userId: string) {
  return getSessionsForUser(userId)
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  return getUserByEmail(email)
}

export async function createSession(userId: string, metadata?: { userAgent?: string; ipAddress?: string }): Promise<SessionRecord> {
  const session: SessionRecord = {
    token: randomBytes(24).toString('hex'),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    userAgent: metadata?.userAgent,
    ipAddress: metadata?.ipAddress,
  }
  await insertSession(session)

  const cookieStore = await getCookieStore()
  cookieStore.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })

  return session
}

export async function destroySession() {
  const token = await getSessionToken()
  const cookieStore = await getCookieStore()
  cookieStore.delete(SESSION_COOKIE)

  if (!token) return

  await deleteSessionByToken(token)
}

export async function getCurrentUser() {
  const token = await getSessionToken()
  if (!token) return null

  const session = await getSessionByToken(token)
  if (!session) return null

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteSessionByToken(token)
    return null
  }

  const user = await getUserById(session.userId)
  if (!user || user.accountStatus !== 'active') {
    await deleteSessionByToken(token)
    return null
  }

  return user
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) {
    return null
  }

  return user
}

export async function requireAdminUser() {
  const user = await requireUser()
  if (!user) return null

  return isAdminEmail(user.email) ? user : null
}

export async function buildSessionPayload(user: StoredUser): Promise<SessionPayload> {
  const currentSessionToken = await getSessionToken()
  const [wallet, transactions, notifications, sessions, securitySettings, kycSubmission] = await Promise.all([
    getWalletByUserId(user.id),
    getTransactionsByUserId(user.id),
    getNotificationsByUserId(user.id),
    getSessionsByUserId(user.id),
    getSecuritySettingsByUserId(user.id),
    getLatestKycSubmissionByUserId(user.id),
  ])
  const safeKycSubmission = kycSubmission
    ? {
        ...kycSubmission,
        documentNumber: maskDocumentNumber(kycSubmission.documentType, kycSubmission.documentNumber),
      }
    : null
  const hasPermanentAccount = Boolean(wallet?.virtualAccounts.some(item => item.provider === 'flutterwave' && item.isPermanent))
  let fundingAccountEligibility: FundingAccountEligibility

  if (hasPermanentAccount) {
    fundingAccountEligibility = {
      eligible: false,
      reason: 'account_already_assigned',
      hasPermanentAccount: true,
      message: 'A permanent Flutterwave funding account is already assigned to this wallet.',
    }
  } else if (!kycSubmission) {
    fundingAccountEligibility = {
      eligible: false,
      reason: 'approved_identity_required',
      hasPermanentAccount: false,
      message: 'Submit BVN or NIN KYC and get it approved before creating a secondary Flutterwave funding account.',
    }
  } else if (kycSubmission.documentType !== 'bvn' && kycSubmission.documentType !== 'nin') {
    fundingAccountEligibility = {
      eligible: false,
      reason: 'unsupported_identity_type',
      hasPermanentAccount: false,
      message: 'Flutterwave funding accounts require an approved BVN or NIN KYC record.',
    }
  } else if (kycSubmission.status === 'approved') {
    fundingAccountEligibility = {
      eligible: true,
      reason: 'ready',
      identityType: kycSubmission.documentType,
      hasPermanentAccount: false,
      message: `Approved ${kycSubmission.documentType.toUpperCase()} is available for secondary Flutterwave funding account creation.`,
    }
  } else if (kycSubmission.status === 'pending') {
    fundingAccountEligibility = {
      eligible: false,
      reason: 'identity_under_review',
      identityType: kycSubmission.documentType,
      hasPermanentAccount: false,
      message: `${kycSubmission.documentType.toUpperCase()} is still under review. Flutterwave funding account creation is blocked until approval.`,
    }
  } else {
    fundingAccountEligibility = {
      eligible: false,
      reason: 'identity_rejected',
      identityType: kycSubmission.documentType === 'bvn' || kycSubmission.documentType === 'nin' ? kycSubmission.documentType : undefined,
      hasPermanentAccount: false,
      message: `${kycSubmission.documentType.toUpperCase()} review was rejected. Submit a valid BVN or NIN to unlock a Flutterwave funding account.`,
    }
  }

  return {
    user: sanitizeUser(user),
    wallet,
    transactions,
    notifications,
    sessions,
    securitySettings,
    kycSubmission: safeKycSubmission,
    fundingAccountEligibility,
    currentSessionToken,
  }
}

export async function loginUser(email: string, password: string, metadata?: { userAgent?: string; ipAddress?: string }) {
  const user = await findUserByEmail(email)
  if (!user || !verifyPassword(user, password)) {
    throw new Error('Invalid email or password.')
  }

  if (user.accountStatus === 'pending_verification') {
    throw new Error('Verify your email address before signing in.')
  }

  if (user.accountStatus === 'deactivated') {
    throw new Error('This account has been deactivated. Contact support or an administrator to reactivate it.')
  }

  await createSession(user.id, metadata)
  return buildSessionPayload(user)
}

export async function appendNotification(userId: string, notification: NotificationRecord) {
  await insertNotification(notification)
}

export { createNotification }

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized', success: false }, { status: 401 })
}
