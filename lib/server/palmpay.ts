import { createHash, createPrivateKey, createPublicKey, createSign, createVerify, KeyObject, randomBytes } from 'node:crypto'

type PalmPayVirtualAccountInput = {
  reference: string
  email: string
  customerName: string
  virtualAccountName: string
  accountReference?: string
  identityType?: 'personal' | 'personal_nin' | 'company'
  licenseNumber?: string
}

export type PalmPayVirtualAccountResult = {
  provider: 'palmpay'
  reference: string
  status: 'pending' | 'failed'
  providerReference?: string
  rawStatus?: string
  reason?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
  payload?: Record<string, unknown>
}

const PALMPAY_LOGGING_ENABLED = false // disabled to focus on crypto deposit logs

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeKeyInput(key: string) {
  const trimmed = key.trim().replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n')
  return trimmed
}

function toPem(key: string, label: 'PRIVATE KEY' | 'PUBLIC KEY') {
  const trimmed = normalizeKeyInput(key)
  if (!trimmed) return ''
  if (trimmed.includes('BEGIN')) return trimmed
  const lines = trimmed.replace(/\s+/g, '').match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

function logPalmPay(event: string, payload: Record<string, unknown>) {
  if (!PALMPAY_LOGGING_ENABLED) return
  console.log(`[palmpay] ${event}`, JSON.stringify(payload))
}

function getPalmPayBaseUrl() {
  const explicit = readString(process.env.MAFITAPAY_PALMPAY_BASE_URL)
  if (explicit) return explicit.replace(/\/$/, '')
  return process.env.NODE_ENV === 'production'
    ? 'https://open-gw-prod.palmpay-inc.com'
    : 'https://open-gw-sandbox.palmpay-inc.com'
}

function getPalmPayToken() {
  return readString(process.env.MAFITAPAY_PALMPAY_APP_ID)
    || readString(process.env.MAFITAPAY_PALMPAY_AUTH_TOKEN)
}

function getPalmPayPrivateKey() {
  return normalizeKeyInput(readString(process.env.MAFITAPAY_PALMPAY_MERCHANT_PRIVATE_KEY))
}

function getPalmPayPublicKey() {
  return normalizeKeyInput(readString(process.env.MAFITAPAY_PALMPAY_PUBLIC_KEY))
}

function getPalmPayMerchantPublicKey() {
  return normalizeKeyInput(readString(process.env.MAFITAPAY_PALMPAY_MERCHANT_PUBLIC_KEY))
}

function getPalmPayCountryCode() {
  return readString(process.env.MAFITAPAY_PALMPAY_COUNTRY_CODE) || 'NG'
}

function normalizeSignatureValue(value: unknown) {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function buildSignatureBase(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([, value]) => normalizeSignatureValue(value) !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${normalizeSignatureValue(value)}`)
    .join('&')
}

function buildSignatureDigest(payload: Record<string, unknown>) {
  return createHash('md5').update(buildSignatureBase(payload), 'utf8').digest('hex').toUpperCase()
}

function fingerprintKey(input: string) {
  return createHash('sha256').update(input.replace(/\s+/g, ''), 'utf8').digest('hex').slice(0, 16)
}

function normalizePalmPayAccountName(value: string, fallback: string) {
  const normalized = readString(value).replace(/\s*\([^)]*\)\s*$/u, '').trim()
  return normalized || fallback
}

function resolvePalmPayBankName(data: Record<string, unknown>) {
  return readString(data.bankName)
    || readString(data.bank)
    || readString(data.bank_name)
    || readString(data.institutionName)
    || readString(data.institution_name)
    || readString(process.env.MAFITAPAY_PALMPAY_BANK_NAME)
    || 'Bloom MFB'
}

function resolvePrivateKey(input: string): KeyObject {
  const normalized = normalizeKeyInput(input)
  const compactBase64 = normalized.includes('BEGIN')
    ? normalized
        .replace(/-----BEGIN [A-Z ]+-----/g, '')
        .replace(/-----END [A-Z ]+-----/g, '')
        .replace(/\s+/g, '')
    : normalized.replace(/\s+/g, '')
  const derBuffer = compactBase64 ? Buffer.from(compactBase64, 'base64') : null
  const candidates: Array<() => KeyObject> = [
    () => createPrivateKey(normalized),
    () => createPrivateKey(toPem(normalized, 'PRIVATE KEY')),
    () => createPrivateKey(normalized.includes('BEGIN') ? normalized.replace('BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY').replace('END PRIVATE KEY', 'END RSA PRIVATE KEY') : ''),
    () => createPrivateKey(normalized.includes('BEGIN') ? normalized.replace('BEGIN RSA PRIVATE KEY', 'BEGIN PRIVATE KEY').replace('END RSA PRIVATE KEY', 'END PRIVATE KEY') : ''),
    () => {
      if (!derBuffer) throw new Error('PalmPay private key DER buffer is empty.')
      return createPrivateKey({ key: derBuffer, format: 'der', type: 'pkcs8' })
    },
    () => {
      if (!derBuffer) throw new Error('PalmPay private key DER buffer is empty.')
      return createPrivateKey({ key: derBuffer, format: 'der', type: 'pkcs1' })
    },
  ]

  let lastError: Error | null = null
  for (const candidate of candidates) {
    try {
      return candidate()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unable to decode PalmPay private key.')
    }
  }

  throw lastError ?? new Error('Unable to decode PalmPay private key.')
}

function resolvePublicKey(input: string): KeyObject {
  const normalized = normalizeKeyInput(input)
  const compactBase64 = normalized.includes('BEGIN')
    ? normalized
        .replace(/-----BEGIN [A-Z ]+-----/g, '')
        .replace(/-----END [A-Z ]+-----/g, '')
        .replace(/\s+/g, '')
    : normalized.replace(/\s+/g, '')
  const derBuffer = compactBase64 ? Buffer.from(compactBase64, 'base64') : null
  const candidates: Array<() => KeyObject> = [
    () => createPublicKey(normalized),
    () => createPublicKey(toPem(normalized, 'PUBLIC KEY')),
    () => {
      if (!derBuffer) throw new Error('PalmPay public key DER buffer is empty.')
      return createPublicKey({ key: derBuffer, format: 'der', type: 'spki' })
    },
    () => {
      if (!derBuffer) throw new Error('PalmPay public key DER buffer is empty.')
      return createPublicKey({ key: derBuffer, format: 'der', type: 'pkcs1' })
    },
  ]

  let lastError: Error | null = null
  for (const candidate of candidates) {
    try {
      return candidate()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unable to decode PalmPay public key.')
    }
  }

  throw lastError ?? new Error('Unable to decode PalmPay public key.')
}

function decodePalmPaySignature(signature: string) {
  if (!signature) return ''
  try {
    return decodeURIComponent(signature)
  } catch {
    return signature
  }
}

function signPalmPayPayload(payload: Record<string, unknown>) {
  const privateKey = getPalmPayPrivateKey()
  if (!privateKey) {
    throw new Error('PalmPay merchant private key is not configured.')
  }

  const signer = createSign('RSA-SHA1')
  signer.update(buildSignatureDigest(payload))
  signer.end()
  return signer.sign(resolvePrivateKey(privateKey), 'base64')
}

export function verifyPalmPayWebhook(rawBody: string) {
  const publicKey = getPalmPayPublicKey()
  if (!publicKey) return false

  const parsed = JSON.parse(rawBody) as unknown
  const body = isRecord(parsed) ? parsed : {}
  const signature = decodePalmPaySignature(readString(body.sign))
  if (!signature) return false

  const { sign: _sign, ...rest } = body
  const verifier = createVerify('RSA-SHA1')
  verifier.update(buildSignatureDigest(rest))
  verifier.end()
  return verifier.verify(resolvePublicKey(publicKey), signature, 'base64')
}

export function getPalmPayVirtualAccountsConfigState() {
  const token = getPalmPayToken()
  const privateKey = getPalmPayPrivateKey()
  const publicKey = getPalmPayPublicKey()
  const merchantPublicKey = getPalmPayMerchantPublicKey()

  return {
    tokenConfigured: Boolean(token),
    privateKeyConfigured: Boolean(privateKey),
    publicKeyConfigured: Boolean(publicKey),
    merchantPublicKeyConfigured: Boolean(merchantPublicKey),
    depositsEnabled: Boolean(token && privateKey),
    baseUrl: getPalmPayBaseUrl(),
    countryCode: getPalmPayCountryCode(),
  }
}

export function isPalmPayVirtualAccountsEnabled() {
  const config = getPalmPayVirtualAccountsConfigState()
  return config.depositsEnabled
}

export function mapPalmPayVirtualAccountOrderStatus(rawStatus: unknown) {
  const normalized = Number(rawStatus)
  if (normalized === 1) return 'success'
  if (normalized === 2) return 'failed'
  if (normalized === 0 || normalized === 3) return 'pending'
  return null
}

export async function createPalmPayVirtualAccount(input: PalmPayVirtualAccountInput): Promise<PalmPayVirtualAccountResult> {
  const token = getPalmPayToken()
  if (!token) {
    logPalmPay('create.config_missing', {
      hasAppId: Boolean(readString(process.env.MAFITAPAY_PALMPAY_APP_ID)),
      hasLegacyToken: Boolean(readString(process.env.MAFITAPAY_PALMPAY_AUTH_TOKEN)),
      hasPrivateKey: Boolean(getPalmPayPrivateKey()),
      hasPublicKey: Boolean(getPalmPayPublicKey()),
      baseUrl: getPalmPayBaseUrl(),
    })
    return {
      provider: 'palmpay',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'NOT_CONFIGURED',
      reason: 'PalmPay virtual accounts are not configured.',
      payload: { stage: 'config' },
    }
  }

  const payload: Record<string, unknown> = {
    requestTime: Date.now(),
    version: 'V2.0',
    nonceStr: randomBytes(16).toString('hex'),
    virtualAccountName: input.virtualAccountName,
    email: input.email,
    customerName: input.customerName,
    accountReference: input.accountReference || input.reference,
  }

  if (input.identityType && input.licenseNumber) {
    payload.identityType = input.identityType
    payload.licenseNumber = input.licenseNumber
  }

  logPalmPay('create.request', {
    reference: input.reference,
    baseUrl: getPalmPayBaseUrl(),
    countryCode: getPalmPayCountryCode(),
    hasBearerToken: Boolean(token),
    hasPrivateKey: Boolean(getPalmPayPrivateKey()),
    hasPublicKey: Boolean(getPalmPayPublicKey()),
    hasMerchantPublicKey: Boolean(getPalmPayMerchantPublicKey()),
    payload: {
      ...payload,
      nonceStr: '[redacted]',
      email: input.email,
      customerName: input.customerName,
      virtualAccountName: input.virtualAccountName,
      accountReference: payload.accountReference,
      identityType: payload.identityType ?? null,
      hasLicenseNumber: Boolean(payload.licenseNumber),
    },
  })

  try {
    const privateKeyObject = resolvePrivateKey(getPalmPayPrivateKey())
    const derivedMerchantPublicKey = createPublicKey(privateKeyObject).export({ format: 'pem', type: 'spki' }).toString()
    const configuredMerchantPublicKey = getPalmPayMerchantPublicKey()
    logPalmPay('create.key_check', {
      reference: input.reference,
      derivedMerchantPublicKeyFingerprint: fingerprintKey(derivedMerchantPublicKey),
      configuredMerchantPublicKeyFingerprint: configuredMerchantPublicKey ? fingerprintKey(configuredMerchantPublicKey) : null,
      merchantKeyPairMatch: configuredMerchantPublicKey
        ? fingerprintKey(derivedMerchantPublicKey) === fingerprintKey(configuredMerchantPublicKey)
        : null,
    })
  } catch (error) {
    logPalmPay('create.key_check_error', {
      reference: input.reference,
      message: error instanceof Error ? error.message : 'Unable to derive merchant public key from private key.',
    })
  }

  let response: Response
  try {
    response = await fetch(`${getPalmPayBaseUrl()}/api/v2/virtual/account/label/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Signature: signPalmPayPayload(payload),
        countryCode: getPalmPayCountryCode(),
        'Content-Type': 'application/json;charset=UTF-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
  } catch (error) {
    logPalmPay('create.request_error', {
      reference: input.reference,
      message: error instanceof Error ? error.message : 'PalmPay virtual account request failed.',
      baseUrl: getPalmPayBaseUrl(),
    })
    return {
      provider: 'palmpay',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'PalmPay virtual account request failed.',
      payload: {
        stage: 'request',
        message: error instanceof Error ? error.message : 'PalmPay virtual account request failed.',
      },
    }
  }

  const parsed = await response.json().catch(() => null)
  const body = isRecord(parsed) ? parsed : {}
  const data = isRecord(body.data) ? body.data : {}
  const status = body.status === true
  const respCode = readString(body.respCode)
  const respMsg = readString(body.respMsg)
  const accountNumber = readString(data.virtualAccountNo)
  const accountName = normalizePalmPayAccountName(readString(data.virtualAccountName), input.virtualAccountName)
  const bankName = resolvePalmPayBankName(data)
  const accountReference = readString(data.accountReference) || input.accountReference || input.reference

  logPalmPay('create.response', {
    reference: input.reference,
    httpStatus: response.status,
    ok: response.ok,
    respCode: respCode || null,
    respMsg: respMsg || null,
    status,
    accountNumber: accountNumber || null,
    bankName: bankName || null,
    accountName: accountName || null,
    accountReference: accountReference || null,
    payload: body,
  })

  if (!response.ok || !status || respCode !== '00000000' || !accountNumber) {
    return {
      provider: 'palmpay',
      reference: input.reference,
      status: 'failed',
      providerReference: accountReference || undefined,
      rawStatus: respCode || 'FAILED',
      reason: respMsg || 'PalmPay virtual account creation failed.',
      payload: body,
    }
  }

  return {
    provider: 'palmpay',
    reference: input.reference,
    status: 'pending',
    providerReference: accountReference || undefined,
    rawStatus: readString(data.status) || 'Enabled',
    reason: respMsg || undefined,
    bankName,
    accountNumber,
    accountName,
    payload: body,
  }
}
