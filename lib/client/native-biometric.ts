'use client'

import { Capacitor, registerPlugin } from '@capacitor/core'

export const BIOMETRIC_UNLOCK_KEY = 'mfp-biometric-unlock'
export const BIOMETRIC_TRANSACTION_KEY = 'mfp-biometric-transaction'
/** Session flag so we don't re-prompt on every client navigation */
export const BIOMETRIC_SESSION_OK_KEY = 'mfp-biometric-session-ok'

export type BiometricAvailability = {
  available: boolean
  status?: number
  statusLabel?: string
}

export type AuthenticateOptions = {
  title?: string
  subtitle?: string
  description?: string
}

export type AuthenticateResult = {
  verified: boolean
  cancelled?: boolean
  message?: string
}

type BiometricAuthPlugin = {
  isAvailable(): Promise<BiometricAvailability>
  authenticate(options?: AuthenticateOptions): Promise<AuthenticateResult>
}

const BiometricAuth = registerPlugin<BiometricAuthPlugin>('BiometricAuth')

export function isNativeBiometricPlatform() {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform()
}

export async function getBiometricAvailability(): Promise<BiometricAvailability> {
  if (!isNativeBiometricPlatform()) {
    return { available: false, statusLabel: 'not_native' }
  }
  try {
    const result = await BiometricAuth.isAvailable()
    return {
      available: Boolean(result?.available),
      status: result?.status,
      statusLabel: result?.statusLabel,
    }
  } catch {
    return { available: false, statusLabel: 'error' }
  }
}

/**
 * Show the system fingerprint / face prompt.
 * Returns verified=true only on success; cancelled=true if user dismissed.
 */
export async function authenticateBiometric(
  options?: AuthenticateOptions,
): Promise<AuthenticateResult> {
  if (!isNativeBiometricPlatform()) {
    return { verified: false, message: 'Biometrics only work in the Android app.' }
  }
  try {
    const result = await BiometricAuth.authenticate({
      title: options?.title ?? 'Verify identity',
      subtitle: options?.subtitle ?? 'Use fingerprint or face to continue',
      description: options?.description,
    })
    return {
      verified: Boolean(result?.verified),
      cancelled: Boolean(result?.cancelled),
      message: result?.message,
    }
  } catch (error) {
    return {
      verified: false,
      message: error instanceof Error ? error.message : 'Biometric verification failed',
    }
  }
}

export function readBiometricSetting(key: string, fallback = false) {
  if (typeof window === 'undefined') return fallback
  return window.localStorage.getItem(key) === '1'
}

export function writeBiometricSetting(key: string, enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, enabled ? '1' : '0')
}

export function markBiometricSessionUnlocked() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(BIOMETRIC_SESSION_OK_KEY, '1')
  } catch {
    // ignore
  }
}

export function isBiometricSessionUnlocked() {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(BIOMETRIC_SESSION_OK_KEY) === '1'
  } catch {
    return false
  }
}

export function clearBiometricSession() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(BIOMETRIC_SESSION_OK_KEY)
  } catch {
    // ignore
  }
}

export function biometricUnavailableHint(statusLabel?: string) {
  switch (statusLabel) {
    case 'not_native':
      return 'Open the Android app to use fingerprint or face unlock. This does not work in a regular browser.'
    case 'none_enrolled':
      return 'No fingerprint or face is enrolled on this phone. Add one in system Settings, then try again.'
    case 'no_hardware':
    case 'hw_unavailable':
      return 'This device does not have a working fingerprint or face sensor.'
    case 'security_update_required':
      return 'Install a security update on this phone, then try again.'
    default:
      return 'Biometric security needs the Android app on a device with fingerprint or face unlock set up.'
  }
}
