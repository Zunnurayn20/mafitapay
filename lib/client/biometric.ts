'use client'

import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { createTransactionBiometricKey, isNativeBiometricPlatform, listTransactionBiometricKeyIds, signTransactionBiometricChallenge } from './native-biometric'
import { useAppStore } from '@/store'

async function postBiometricIntent(intent: string, body: Record<string, unknown> = {}) {
  const response = await fetch('/api/security/biometric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ intent, ...body }),
  })
  const payload = await response.json()
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'Biometric request failed.')
  return payload.data
}

function nativeDeviceStorageKey() {
  const userId = useAppStore.getState().user?.id
  if (!userId) throw new Error('Your session is not ready. Sign in again and retry.')
  return `mfp-native-transaction-device:${userId}`
}

function newNativeDeviceId() {
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  return `mfp_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function getNativeDeviceId() {
  const key = nativeDeviceStorageKey()
  const saved = window.localStorage.getItem(key)
  const localKeyIds = await listTransactionBiometricKeyIds()
  if (saved && localKeyIds.includes(saved)) return saved
  const response = await fetch('/api/security/biometric', { credentials: 'include', cache: 'no-store' })
  const payload = await response.json()
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'Biometric devices could not be loaded.')
  const device = (payload.data?.credentials || []).find((item: { credentialType?: string; credentialId?: string }) =>
    item.credentialType === 'native_android' && localKeyIds.includes(item.credentialId || ''),
  )
  if (!device?.credentialId) throw new Error('Enroll this Android device for transaction biometrics first.')
  window.localStorage.setItem(key, device.credentialId)
  return device.credentialId as string
}

export async function enrollNativeBiometricCredential() {
  const { challenge } = await postBiometricIntent('native_register_challenge')
  const deviceId = newNativeDeviceId()
  const proof = await createTransactionBiometricKey({ deviceId, challenge: challenge.challenge })
  const result = await postBiometricIntent('native_register_verify', {
    challengeId: challenge.id,
    deviceId: proof.deviceId,
    publicKey: proof.publicKey,
    signature: proof.signature,
    certificateChain: proof.certificateChain,
  })
  window.localStorage.setItem(nativeDeviceStorageKey(), deviceId)
  return result
}

export async function canUseBiometrics() {
  if (typeof window === 'undefined' || typeof window.PublicKeyCredential === 'undefined') {
    return false
  }
  if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
    return false
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export async function enrollBiometricCredential() {
  const optionsResponse = await fetch('/api/security/biometric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ intent: 'register_options' }),
  })
  const optionsPayload = await optionsResponse.json()
  if (!optionsResponse.ok || optionsPayload.success === false) {
    throw new Error(optionsPayload.error || 'Biometric registration could not start.')
  }

  const registrationResponse = await startRegistration({
    optionsJSON: optionsPayload.data.options,
  })

  const verifyResponse = await fetch('/api/security/biometric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      intent: 'register_verify',
      response: registrationResponse,
    }),
  })
  const verifyPayload = await verifyResponse.json()
  if (!verifyResponse.ok || verifyPayload.success === false) {
    throw new Error(verifyPayload.error || 'Biometric registration could not be verified.')
  }

  return verifyPayload.data
}

export async function createBiometricApproval() {
  if (isNativeBiometricPlatform()) {
    const { challenge } = await postBiometricIntent('native_approval_challenge')
    const deviceId = await getNativeDeviceId()
    const proof = await signTransactionBiometricChallenge({ deviceId, challenge: challenge.challenge })
    const result = await postBiometricIntent('native_approval_verify', {
      challengeId: challenge.id,
      deviceId: proof.deviceId,
      signature: proof.signature,
    })
    return result.approval as { token: string; expiresAt: string }
  }

  const optionsResponse = await fetch('/api/security/biometric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ intent: 'approval_options' }),
  })
  const optionsPayload = await optionsResponse.json()
  if (!optionsResponse.ok || optionsPayload.success === false) {
    throw new Error(optionsPayload.error || 'Biometric approval could not start.')
  }

  const authenticationResponse = await startAuthentication({
    optionsJSON: optionsPayload.data.options,
  })

  const verifyResponse = await fetch('/api/security/biometric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      intent: 'approval_verify',
      response: authenticationResponse,
    }),
  })
  const verifyPayload = await verifyResponse.json()
  if (!verifyResponse.ok || verifyPayload.success === false) {
    throw new Error(verifyPayload.error || 'Biometric approval failed.')
  }

  return verifyPayload.data.approval as { token: string; expiresAt: string }
}

export function isBiometricApprovalEnabled(settings: {
  biometricEnabled?: boolean
  hasWebBiometricCredential?: boolean
  nativeBiometricEnabled?: boolean
  hasNativeBiometricCredential?: boolean
} | null | undefined) {
  if (isNativeBiometricPlatform()) return Boolean(settings?.nativeBiometricEnabled && settings?.hasNativeBiometricCredential)
  return Boolean(settings?.biometricEnabled && settings?.hasWebBiometricCredential)
}
