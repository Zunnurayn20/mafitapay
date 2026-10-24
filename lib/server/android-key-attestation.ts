import { createHash, X509Certificate as NodeX509Certificate } from 'node:crypto'
import { AsnParser } from '@peculiar/asn1-schema'
import {
  AttestationApplicationId,
  id_ce_keyDescription,
  KeyDescription,
  SecurityLevel,
  VerifiedBootState,
} from '@peculiar/asn1-android'
import { X509Certificate as PeculiarX509Certificate } from '@peculiar/x509'

const ANDROID_ATTESTATION_ROOTS_URL = 'https://android.googleapis.com/attestation/root'
const ANDROID_ATTESTATION_STATUS_URL = 'https://android.googleapis.com/attestation/status'
const KEY_ATTESTATION_EXTENSION = id_ce_keyDescription
const MAFITAPAY_ANDROID_PACKAGE = 'ng.mafitapay.app'
const MAX_ATTESTATION_CHAIN_CERTIFICATES = 8
const MAX_ATTESTATION_CHAIN_BYTES = 48 * 1024
const MIN_STATUS_CACHE_MS = 5 * 60_000
const MAX_STATUS_CACHE_MS = 6 * 60 * 60_000

type AttestationCache<T> = { value: T; expiresAt: number }
type AndroidStatusList = { entries: Record<string, { status?: string; expires?: string }> }

let trustedRootsCache: AttestationCache<NodeX509Certificate[]> | undefined
let statusListCache: AttestationCache<AndroidStatusList> | undefined

function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9_+/-]+={0,2}$/.test(value) || value.length > MAX_ATTESTATION_CHAIN_BYTES * 2) {
    throw new Error('Android key attestation data is invalid.')
  }
  return Buffer.from(value, 'base64')
}

function sha256Hex(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeFingerprint(value: string) {
  const hex = value.replace(/[^a-fA-F0-9]/g, '').toLowerCase()
  return /^[a-f0-9]{64}$/.test(hex) ? hex : null
}

function allowedAppSigners() {
  const values = [
    process.env.MAFITAPAY_ANDROID_CERT_SHA256,
    process.env.MAFITAPAY_ANDROID_CERT_SHA256_RELEASE,
  ].filter(Boolean).join(' ').split(/[\s,]+/).filter(Boolean)
  const fingerprints = values.map(normalizeFingerprint).filter((value): value is string => Boolean(value))
  if (!fingerprints.length) {
    throw new Error('Android signing certificate is not configured for hardware attestation.')
  }
  return new Set(fingerprints)
}

function bufferFromArrayBuffer(value: ArrayBuffer) {
  return Buffer.from(new Uint8Array(value))
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: 'no-store' })
  if (!response.ok) throw new Error('Android attestation verification service is unavailable.')
  const payload = await response.json() as T
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/i)?.[1] ?? 0) * 1000
  const ttl = Math.min(MAX_STATUS_CACHE_MS, Math.max(MIN_STATUS_CACHE_MS, maxAge || MIN_STATUS_CACHE_MS))
  return { payload, ttl }
}

async function getTrustedRoots() {
  if (trustedRootsCache && trustedRootsCache.expiresAt > Date.now()) return trustedRootsCache.value
  const { payload, ttl } = await fetchJson<string[]>(ANDROID_ATTESTATION_ROOTS_URL)
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > 10) {
    throw new Error('Android attestation trust roots are invalid.')
  }
  const roots = payload.map(root => new NodeX509Certificate(root))
  trustedRootsCache = { value: roots, expiresAt: Date.now() + ttl }
  return roots
}

async function getStatusList() {
  if (statusListCache && statusListCache.expiresAt > Date.now()) return statusListCache.value
  const { payload, ttl } = await fetchJson<AndroidStatusList>(ANDROID_ATTESTATION_STATUS_URL)
  if (!payload || typeof payload.entries !== 'object' || Array.isArray(payload.entries)) {
    throw new Error('Android attestation revocation data is invalid.')
  }
  statusListCache = { value: payload, expiresAt: Date.now() + ttl }
  return payload
}

function verifyCertificateLink(child: NodeX509Certificate, issuer: NodeX509Certificate) {
  if (child.issuer !== issuer.subject || issuer.ca !== true) return false
  try {
    return child.verify(issuer.publicKey)
  } catch {
    return false
  }
}

function assertCertificateValidity(certificate: NodeX509Certificate, now: number) {
  if (now < new Date(certificate.validFrom).getTime() || now > new Date(certificate.validTo).getTime()) {
    throw new Error('Android device attestation certificate has expired or is not yet valid.')
  }
}

async function buildTrustedChain(encodedCertificates: string[]) {
  if (!Array.isArray(encodedCertificates) || encodedCertificates.length < 1 || encodedCertificates.length > MAX_ATTESTATION_CHAIN_CERTIFICATES) {
    throw new Error('Android device attestation chain is invalid.')
  }
  const certs = encodedCertificates.map(encoded => new NodeX509Certificate(decodeBase64(encoded)))
  const totalBytes = certs.reduce((sum, certificate) => sum + certificate.raw.length, 0)
  if (totalBytes > MAX_ATTESTATION_CHAIN_BYTES) throw new Error('Android device attestation chain is too large.')

  const [trustedRoots, statusList] = await Promise.all([getTrustedRoots(), getStatusList()])
  let rootIndex = certs.findIndex(certificate => trustedRoots.some(root => root.fingerprint256 === certificate.fingerprint256))
  if (rootIndex < 0) {
    const last = certs[certs.length - 1]
    const trustedRoot = trustedRoots.find(root => verifyCertificateLink(last, root))
    if (!trustedRoot) throw new Error('Android device is not rooted in a trusted hardware attestation authority.')
    certs.push(trustedRoot)
    rootIndex = certs.length - 1
  } else if (rootIndex !== certs.length - 1) {
    throw new Error('Android device attestation chain has certificates after its trusted root.')
  }

  const now = Date.now()
  for (let index = 0; index < rootIndex; index += 1) {
    assertCertificateValidity(certs[index], now)
    if (!verifyCertificateLink(certs[index], certs[index + 1])) {
      throw new Error('Android device attestation certificate chain signature is invalid.')
    }
  }

  for (const certificate of certs.slice(0, rootIndex)) {
    const serialNumber = certificate.serialNumber.toLowerCase().replace(/^0+/, '')
    const revoked = statusList.entries[serialNumber]
    if (revoked?.status === 'REVOKED' || revoked?.status === 'SUSPENDED') {
      throw new Error('Android device attestation certificate has been revoked.')
    }
  }
  return certs
}

function parseKeyDescription(certificateChain: NodeX509Certificate[]) {
  // Android documents that the first key-attestation extension encountered while
  // walking from the root toward the leaf is the one issued by secure hardware.
  for (let index = certificateChain.length - 1; index >= 0; index -= 1) {
    const certificate = new PeculiarX509Certificate(certificateChain[index].raw)
    const extension = certificate.getExtension(KEY_ATTESTATION_EXTENSION)
    if (!extension) continue
    return AsnParser.parse(extension.value, KeyDescription)
  }
  throw new Error('Android device attestation extension is missing.')
}

function assertAppIdentity(applicationId: AttestationApplicationId) {
  const expectedSigners = allowedAppSigners()
  const packageMatches = applicationId.packageInfos.some(info => Buffer.from(info.packageName.buffer).toString('utf8') === MAFITAPAY_ANDROID_PACKAGE)
  const signerMatches = applicationId.signatureDigests.some(digest => expectedSigners.has(sha256Hex(bufferFromArrayBuffer(digest.buffer))))
  if (!packageMatches || !signerMatches) {
    throw new Error('Android device attestation does not match the MafitaPay app signing certificate.')
  }
}

export async function verifyAndroidKeyAttestation(input: {
  challenge: string
  publicKey: string
  certificateChain: string[]
}) {
  const trustedChain = await buildTrustedChain(input.certificateChain)
  const description = parseKeyDescription(trustedChain)
  const challengeBytes = Buffer.from(input.challenge, 'utf8')
  if (!Buffer.from(description.attestationChallenge.buffer).equals(challengeBytes)) {
    throw new Error('Android device attestation challenge does not match this request.')
  }

  const hardwareLevel = Math.min(description.attestationSecurityLevel, description.keymasterSecurityLevel)
  if (hardwareLevel < SecurityLevel.trustedEnvironment) {
    throw new Error('This phone does not provide hardware-backed biometric key storage.')
  }

  const authorization = description.teeEnforced
  const attestationApplicationId = authorization?.attestationApplicationId ?? description.softwareEnforced?.attestationApplicationId
  if (
    !authorization
    || authorization.algorithm !== 3 // Keymaster EC
    || authorization.origin !== 0 // Generated in the secure hardware
    || !authorization.purpose?.includes(2) // Keymaster SIGN
    || !authorization.digest?.includes(4) // Keymaster SHA-256
    || authorization.userAuthType !== 2 // BIOMETRIC_STRONG
    || authorization.authTimeout !== 0 // Auth-per-use
    || authorization.noAuthRequired !== undefined
    || authorization.allApplications !== undefined
    || authorization.rootOfTrust?.deviceLocked !== true
    || authorization.rootOfTrust?.verifiedBootState !== VerifiedBootState.verified
    || !attestationApplicationId
  ) {
    throw new Error('Android key attestation does not meet MafitaPay biometric security requirements.')
  }

  const applicationId = AsnParser.parse(bufferFromArrayBuffer(attestationApplicationId.buffer), AttestationApplicationId)
  assertAppIdentity(applicationId)

  const publicKey = decodeBase64(input.publicKey)
  const certificatePublicKey = trustedChain[0].publicKey.export({ type: 'spki', format: 'der' })
  if (!Buffer.from(certificatePublicKey).equals(publicKey)) {
    throw new Error('Android attestation key does not match the registered device key.')
  }
}
