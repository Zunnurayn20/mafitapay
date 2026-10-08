'use client'

import { Capacitor } from '@capacitor/core'
import { AccessControl, NativeBiometric } from '@capgo/capacitor-native-biometric'
import type { SessionData } from '@/store'

const DEVICE_LOGIN_KEY = 'mafitapay.device-login.v1'
const DEVICE_LOGIN_HINT_KEY = 'mfp-device-login-hint'
export const DEVICE_LOGIN_ENROLL_EVENT = 'mafitapay:offer-device-login'

export type DeviceLoginHint = { id: string; emailMasked: string }

export function canBridgeDeviceLogin() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NativeBiometric')
}

export async function canUseFingerprintLogin() {
  if (!canBridgeDeviceLogin()) return false
  try {
    const availability = await NativeBiometric.isAvailable({ useFallback: false })
    return availability.isAvailable && availability.strongBiometryIsAvailable === true
  } catch {
    return false
  }
}

export function getDeviceLoginHint(): DeviceLoginHint | null {
  try {
    const hint = JSON.parse(localStorage.getItem(DEVICE_LOGIN_HINT_KEY) || 'null') as Partial<DeviceLoginHint> | null
    if (!hint || typeof hint.id !== 'string' || !/^dlt_[a-f0-9]{24}$/.test(hint.id) || typeof hint.emailMasked !== 'string') return null
    return { id: hint.id, emailMasked: hint.emailMasked }
  } catch {
    return null
  }
}

function maskEmail(email: string) {
  const [name, domain] = email.trim().toLowerCase().split('@')
  if (!name || !domain) return ''
  return `${name.slice(0, 1)}${'•'.repeat(Math.min(5, Math.max(3, name.length - 1)))}@${domain}`
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(typeof payload?.error === 'string' ? payload.error : 'Fingerprint sign-in request failed.') as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return payload as T
}

async function writeProtectedCredential(id: string, token: string) {
  await NativeBiometric.setData({
    key: DEVICE_LOGIN_KEY,
    value: JSON.stringify({ id, token }),
    accessControl: AccessControl.BIOMETRY_CURRENT_SET,
    // Allow the just-authenticated read to re-encrypt the rotated token without a second prompt.
    // This short window is limited to the Android Keystore operation after the live prompt.
    authValidityDuration: 15,
    title: 'Enable fingerprint sign-in',
    negativeButtonText: 'Cancel',
  })
}

export async function enrollFingerprintLogin(email: string) {
  if (!await canUseFingerprintLogin()) throw new Error('Fingerprint sign-in requires strong biometrics on this Android device.')
  const created = await requestJson<{ data: { id: string; token: string } }>('/api/auth/device-login/enroll', {
    method: 'POST', body: JSON.stringify({ deviceLabel: 'Android device' }),
  })
  try {
    await writeProtectedCredential(created.data.id, created.data.token)
    localStorage.setItem(DEVICE_LOGIN_HINT_KEY, JSON.stringify({ id: created.data.id, emailMasked: maskEmail(email) }))
  } catch (error) {
    await fetch('/api/auth/device-login', { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: created.data.id }) }).catch(() => undefined)
    throw error
  }
}

export async function signInWithFingerprint(): Promise<SessionData> {
  if (!canBridgeDeviceLogin()) throw new Error('Fingerprint sign-in is not available in this app version.')
  const hint = getDeviceLoginHint()
  if (!hint) throw new Error('No fingerprint sign-in is set up on this device.')
  let secret: { value: string }
  try {
    secret = await NativeBiometric.getSecureData({
      key: DEVICE_LOGIN_KEY,
      reason: 'Sign in to MafitaPay',
      title: 'Sign in to MafitaPay',
      subtitle: 'Use your fingerprint',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/no protected data|no data found|invalidated/i.test(message) || (error as { code?: unknown })?.code === 21) {
      await forgetFingerprintLogin()
      throw new Error('Your fingerprint setup changed. Sign in with your email and set it up again.')
    }
    throw error
  }
  const credential = JSON.parse(secret.value) as { id?: unknown; token?: unknown }
  if (credential.id !== hint.id || typeof credential.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential.token)) {
    await forgetFingerprintLogin()
    throw new Error('Fingerprint sign-in needs to be set up again. Sign in with your email.')
  }

  let payload: { data: SessionData; rotated: { id: string; token: string } }
  try {
    payload = await requestJson('/api/auth/device-login', {
      method: 'POST', body: JSON.stringify({ id: credential.id, token: credential.token }),
    })
  } catch (error) {
    if ((error as Error & { status?: number }).status === 401) await forgetFingerprintLogin()
    throw error
  }
  try {
    await writeProtectedCredential(payload.rotated.id, payload.rotated.token)
  } catch (error) {
    await fetch('/api/auth/device-login', { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: payload.rotated.id }) }).catch(() => undefined)
    await forgetFingerprintLogin()
    throw new Error(error instanceof Error ? error.message : 'Could not update secure fingerprint sign-in. Sign in with your email.')
  }
  return payload.data
}

export async function forgetFingerprintLogin() {
  if (canBridgeDeviceLogin()) {
    await NativeBiometric.deleteData({ key: DEVICE_LOGIN_KEY }).catch(() => undefined)
  }
  localStorage.removeItem(DEVICE_LOGIN_HINT_KEY)
}
