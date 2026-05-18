import { Buffer } from 'node:buffer'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server'
import type { User } from '@/types'
import {
  createBiometricApproval,
  getBiometricCredentialByCredentialId,
  getBiometricCredentialsByUserId,
  removeBiometricCredential,
  saveBiometricCredential,
  saveWebAuthnChallenge,
  consumeWebAuthnChallenge,
  touchBiometricCredential,
  upsertSecuritySettings,
} from './data'

const REGISTER_PURPOSE = 'registration'
const APPROVAL_PURPOSE = 'transaction_approval'

function getWebAuthnConfig(origin: string) {
  const url = new URL(process.env.MAFITAPAY_APP_URL || origin)
  return {
    origin: url.origin,
    rpID: process.env.MAFITAPAY_WEBAUTHN_RP_ID || url.hostname,
    rpName: process.env.MAFITAPAY_WEBAUTHN_RP_NAME || 'MafitaPay',
  }
}

function createCredentialLabel(userAgent?: string) {
  const source = (userAgent || 'This device').replace(/\s+/g, ' ').trim()
  return source.slice(0, 80) || 'This device'
}

export async function beginBiometricRegistration(user: User, origin: string) {
  const { rpID, rpName } = getWebAuthnConfig(origin)
  const existingCredentials = await getBiometricCredentialsByUserId(user.id)
  const options = await generateRegistrationOptions({
    rpID,
    rpName,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    timeout: 60_000,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: existingCredentials.map(credential => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
  })

  await saveWebAuthnChallenge({
    userId: user.id,
    purpose: REGISTER_PURPOSE,
    challenge: options.challenge,
    rpId: rpID,
    origin: getWebAuthnConfig(origin).origin,
  })

  return options
}

export async function finishBiometricRegistration(input: {
  user: User
  origin: string
  response: RegistrationResponseJSON
  userAgent?: string
}) {
  const challenge = await consumeWebAuthnChallenge(input.user.id, REGISTER_PURPOSE)
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rp_id,
    requireUserVerification: true,
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Biometric registration could not be verified.')
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

  await saveBiometricCredential({
    userId: input.user.id,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    label: createCredentialLabel(input.userAgent),
  })

  await upsertSecuritySettings(input.user.id, { biometricEnabled: true })
}

export async function beginBiometricApproval(user: User, origin: string) {
  const { rpID } = getWebAuthnConfig(origin)
  const credentials = await getBiometricCredentialsByUserId(user.id)
  if (!credentials.length) {
    throw new Error('Set up biometric approval first.')
  }

  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: 'required',
    allowCredentials: credentials.map(credential => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
  })

  await saveWebAuthnChallenge({
    userId: user.id,
    purpose: APPROVAL_PURPOSE,
    challenge: options.challenge,
    rpId: rpID,
    origin: getWebAuthnConfig(origin).origin,
  })

  return options
}

export async function finishBiometricApproval(input: {
  user: User
  response: AuthenticationResponseJSON
}) {
  const challenge = await consumeWebAuthnChallenge(input.user.id, APPROVAL_PURPOSE)
  const credential = await getBiometricCredentialByCredentialId(input.response.id)
  if (!credential || credential.userId !== input.user.id) {
    throw new Error('Biometric credential not found for this account.')
  }

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rp_id,
    requireUserVerification: true,
    credential: {
      id: credential.credentialId,
      publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
      counter: credential.counter,
      transports: credential.transports as AuthenticatorTransportFuture[],
    },
  })

  if (!verification.verified) {
    throw new Error('Biometric verification failed.')
  }

  await touchBiometricCredential(credential.credentialId, verification.authenticationInfo.newCounter)
  return createBiometricApproval(input.user.id)
}

export async function disableBiometricCredential(userId: string, credentialId: string) {
  await removeBiometricCredential(userId, credentialId)
  const remaining = await getBiometricCredentialsByUserId(userId)
  if (!remaining.length) {
    await upsertSecuritySettings(userId, { biometricEnabled: false })
  }
}
