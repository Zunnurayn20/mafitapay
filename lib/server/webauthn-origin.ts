import { Buffer } from 'node:buffer'

/**
 * Host the Android app actually loads. Must match `server.url` in capacitor.config.ts.
 * A passkey RP ID has to be this host, or a parent of it. Anything else makes the
 * browser throw "The RP ID … is invalid for this domain".
 */
export const MOBILE_APP_HOST = 'mafitapay.vercel.app'

/**
 * Debug signing certificate. Must stay in sync with public/.well-known/assetlinks.json.
 * Android WebView passkeys report origin `android:apk-key-hash:<base64url(SHA-256)>`,
 * not the website origin. Play App Signing uses a different certificate: add it with
 * MAFITAPAY_ANDROID_CERT_SHA256 and the same assetlinks file.
 */
export const DEBUG_ANDROID_CERT_SHA256 =
  '6A:09:5D:E4:52:AF:78:8E:36:9B:FF:C7:6D:66:90:1F:ED:69:F3:F9:B9:66:6D:4D:B7:F2:F9:36:DF:63:C2:5E'

const BLOCKED_RP_IDS = new Set(['vercel.app', 'com', 'net', 'org', 'app', 'ng'])

export type WebAuthnEnv = {
  appUrl?: string
  rpId?: string
  rpName?: string
  androidCertSha256?: string
}

export type WebAuthnTarget = {
  origin: string
  rpID: string
  rpName: string
}

export function readWebAuthnEnv(env: NodeJS.ProcessEnv = process.env): WebAuthnEnv {
  return {
    appUrl: env.MAFITAPAY_APP_URL,
    rpId: env.MAFITAPAY_WEBAUTHN_RP_ID,
    rpName: env.MAFITAPAY_WEBAUTHN_RP_NAME,
    androidCertSha256: env.MAFITAPAY_ANDROID_CERT_SHA256,
  }
}

export function androidApkKeyHashOrigin(fingerprint: string) {
  const hex = fingerprint.replace(/[^a-fA-F0-9]/g, '')
  if (hex.length !== 64) return null
  return `android:apk-key-hash:${Buffer.from(hex, 'hex').toString('base64url')}`
}

export function androidPasskeyOrigins(env: WebAuthnEnv = readWebAuthnEnv()) {
  const fingerprints = [DEBUG_ANDROID_CERT_SHA256, ...(env.androidCertSha256 || '').split(/[\s,]+/)]
  const origins = new Set<string>()
  for (const fingerprint of fingerprints) {
    const origin = androidApkKeyHashOrigin(fingerprint)
    if (origin) origins.add(origin)
  }
  return [...origins]
}

function hostnameOf(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

function hostMatches(host: string, root: string) {
  return host === root || host.endsWith(`.${root}`)
}

function allowedHosts(env: WebAuthnEnv) {
  return [MOBILE_APP_HOST, hostnameOf(env.appUrl), hostnameOf(env.rpId), 'localhost', '127.0.0.1']
    .filter((host): host is string => Boolean(host))
}

export function resolveWebAuthnTarget(requestOrigin: string, env: WebAuthnEnv = readWebAuthnEnv()): WebAuthnTarget {
  let requestUrl: URL
  try {
    requestUrl = new URL(requestOrigin)
  } catch {
    throw new Error('Biometric approval could not start.')
  }

  const host = requestUrl.hostname.toLowerCase()
  if (!allowedHosts(env).some(root => hostMatches(host, root))) {
    throw new Error('Biometric approval is not available for this site.')
  }

  const configuredRpId = hostnameOf(env.rpId)
  const rpID =
    configuredRpId && !BLOCKED_RP_IDS.has(configuredRpId) && hostMatches(host, configuredRpId)
      ? configuredRpId
      : host

  return {
    origin: requestUrl.origin,
    rpID,
    rpName: env.rpName?.trim() || 'MafitaPay',
  }
}

/** Origins a stored ceremony may present. Includes the site and this app's signing certs. */
export function acceptedCeremonyOrigins(webOrigin: string, env: WebAuthnEnv = readWebAuthnEnv()) {
  const origins = new Set(androidPasskeyOrigins(env))
  try {
    origins.add(new URL(webOrigin).origin)
  } catch {
    // A stored origin we cannot parse still leaves the Android app origins.
  }
  return [...origins]
}
