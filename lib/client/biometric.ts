'use client'

import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

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
