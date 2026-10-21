import { Buffer } from 'node:buffer'
import { createPublicKey, verify as verifySignature } from 'node:crypto'
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
  createNativeBiometricChallenge,
  consumeNativeBiometricChallenge,
  getBiometricCredentialByCredentialId,
  getBiometricCredentialsByUserId,
  getSecuritySettingsByUserId,
  getNativeBiometricDevice,
  getNativeBiometricDevicesByUserId,
  removeBiometricCredential,
  revokeNativeBiometricDevice,
  saveBiometricCredential,
  saveNativeBiometricDevice,
  saveWebAuthnChallenge,
  consumeWebAuthnChallenge,
  touchBiometricCredential,
  touchNativeBiometricDevice,
  upsertSecuritySettings,
} from './data'
import { acceptedCeremonyOrigins, resolveWebAuthnTarget } from './webauthn-origin'
import { verifyAndroidKeyAttestation } from './android-key-attestation'

const REGISTER_PURPOSE = 'registration'
const APPROVAL_PURPOSE = 'transaction_approval'

function getWebAuthnConfig(origin: string) {
  return resolveWebAuthnTarget(origin)
}

function createCredentialLabel(userAgent?: string) {
  const source = (userAgent || 'This device').replace(/\s+/g, ' ').trim()
  return source.slice(0, 80) || 'This device'
}

export async function beginBiometricRegistration(user: User, origin: string) {
  const { rpID, rpName, origin: webOrigin } = getWebAuthnConfig(origin)
  const existingCredentials = await getBiometricCredentialsByUserId(user.id)
  const options = await generateRegistrationOptions({
    rpID,
    rpName,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    timeout: 60_000,
    attestationType: 'none',
    // Prefer ES256 first for Android WebView credential providers, while retaining
    // the wider algorithm set for authenticators that support EdDSA or RS256.
    supportedAlgorithmIDs: [-7, -257, -8],
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
    origin: webOrigin,
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
    expectedOrigin: acceptedCeremonyOrigins(challenge.origin),
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
  const { rpID, origin: webOrigin } = getWebAuthnConfig(origin)
  const credentials = await getBiometricCredentialsByUserId(user.id)
  const settings = await getSecuritySettingsByUserId(user.id)
  if (!credentials.length || !settings?.biometricEnabled) {
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
    origin: webOrigin,
  })

  return options
}

export async function finishBiometricApproval(input: {
  user: User
  response: AuthenticationResponseJSON
}) {
  const settings = await getSecuritySettingsByUserId(input.user.id)
  if (!settings?.biometricEnabled) throw new Error('Browser passkey approval is not enabled for this account.')
  const challenge = await consumeWebAuthnChallenge(input.user.id, APPROVAL_PURPOSE)
  const credential = await getBiometricCredentialByCredentialId(input.response.id)
  if (!credential || credential.userId !== input.user.id) {
    throw new Error('Biometric credential not found for this account.')
  }

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: acceptedCeremonyOrigins(challenge.origin),
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

function assertNativeKeyId(deviceId: string) {
  if (!/^mfp_[a-f0-9]{32}$/.test(deviceId)) throw new Error('Native biometric device identifier is invalid.')
}

function verifyNativeSignature(publicKey: string, challenge: string, signature: string) {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' })
    return verifySignature('sha256', Buffer.from(challenge, 'utf8'), key, Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}

export async function beginNativeBiometricRegistration(user: User) {
  return createNativeBiometricChallenge(user.id, 'registration')
}

export async function finishNativeBiometricRegistration(input: {
  user: User
  challengeId: string
  deviceId: string
  publicKey: string
  signature: string
  certificateChain: string[]
}) {
  assertNativeKeyId(input.deviceId)
  if (input.publicKey.length > 4096 || input.signature.length > 4096) throw new Error('Native biometric key payload is invalid.')
  const challenge = await consumeNativeBiometricChallenge(input.user.id, input.challengeId, 'registration')
  await verifyAndroidKeyAttestation({
    challenge: challenge.challenge,
    publicKey: input.publicKey,
    certificateChain: input.certificateChain,
  })
  if (!verifyNativeSignature(input.publicKey, challenge.challenge, input.signature)) {
    throw new Error('Native biometric key proof could not be verified.')
  }
  await saveNativeBiometricDevice({
    userId: input.user.id,
    deviceId: input.deviceId,
    publicKey: input.publicKey,
    label: 'Android device',
  })
  const settings = await upsertSecuritySettings(input.user.id, { nativeBiometricEnabled: true })
  return { settings }
}

export async function beginNativeBiometricApproval(user: User) {
  const settings = await getSecuritySettingsByUserId(user.id)
  const devices = await getNativeBiometricDevicesByUserId(user.id)
  if (!settings?.nativeBiometricEnabled || !devices.length) throw new Error('Set up native transaction biometrics first.')
  return createNativeBiometricChallenge(user.id, 'approval')
}

export async function finishNativeBiometricApproval(input: {
  user: User
  challengeId: string
  deviceId: string
  signature: string
}) {
  assertNativeKeyId(input.deviceId)
  if (input.signature.length > 4096) throw new Error('Native biometric signature is invalid.')
  const settings = await getSecuritySettingsByUserId(input.user.id)
  if (!settings?.nativeBiometricEnabled) throw new Error('Android transaction biometrics are disabled for this account.')
  const challenge = await consumeNativeBiometricChallenge(input.user.id, input.challengeId, 'approval')
  const device = await getNativeBiometricDevice(input.user.id, input.deviceId)
  if (!device || !verifyNativeSignature(device.public_key, challenge.challenge, input.signature)) {
    throw new Error('Native biometric verification failed. Enroll this device again if its security settings changed.')
  }
  await touchNativeBiometricDevice(input.user.id, input.deviceId)
  return createBiometricApproval(input.user.id, 'native_android')
}

export async function disableBiometricCredential(userId: string, credentialId: string) {
  await removeBiometricCredential(userId, credentialId)
  const remaining = await getBiometricCredentialsByUserId(userId)
  if (!remaining.length) {
    await upsertSecuritySettings(userId, { biometricEnabled: false })
  }
}

export async function disableNativeBiometricDevice(userId: string, deviceId: string) {
  await revokeNativeBiometricDevice(userId, deviceId)
  const remaining = await getNativeBiometricDevicesByUserId(userId)
  if (!remaining.length) await upsertSecuritySettings(userId, { nativeBiometricEnabled: false })
}
