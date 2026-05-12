import { createHash, createCipheriv, randomBytes } from 'node:crypto'

type CngnEncryptedPayload = {
  iv: string
  content: string
}

type CngnApiEnvelope = {
  status?: number
  message?: string
  data?: unknown
  error?: string
}

type CngnVirtualAccountResponse = {
  accountReference?: string
  accountNumber?: string
}

function getEnv(name: string) {
  return process.env[name]?.trim() || ''
}

function getCngnBaseUrl() {
  return getEnv('MAFITAPAY_CNGN_BASE_URL') || 'https://api.cngn.co'
}

export function getCngnConfigState() {
  const apiKeyConfigured = Boolean(getEnv('MAFITAPAY_CNGN_API_KEY'))
  const encryptionKeyConfigured = Boolean(getEnv('MAFITAPAY_CNGN_ENCRYPTION_KEY'))
  const privateKeyConfigured = Boolean(getEnv('MAFITAPAY_CNGN_PRIVATE_KEY'))
  const webhookUrlConfigured = Boolean(getEnv('MAFITAPAY_CNGN_WEBHOOK_URL'))

  return {
    apiKeyConfigured,
    encryptionKeyConfigured,
    privateKeyConfigured,
    webhookUrlConfigured,
    baseUrl: getCngnBaseUrl(),
    merchantEnabled: apiKeyConfigured && encryptionKeyConfigured && privateKeyConfigured,
  }
}

async function isSodiumAvailable() {
  try {
    const dynamicImport = new Function("return import('libsodium-wrappers')")
    const sodium = await dynamicImport() as { ready?: Promise<unknown> }
    if (sodium?.ready) {
      await sodium.ready
    }
    return true
  } catch {
    return false
  }
}

export async function getCngnRuntimeState() {
  return {
    sodiumAvailable: await isSodiumAvailable(),
  }
}

export function isCngnMerchantEnabled() {
  return getCngnConfigState().merchantEnabled
}

function prepareAesKey(key: string) {
  return createHash('sha256').update(key).digest()
}

function encryptCngnPayload(data: string, key: string): CngnEncryptedPayload {
  const ivBuffer = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', prepareAesKey(key), ivBuffer)

  let encrypted = cipher.update(data, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  return {
    iv: ivBuffer.toString('base64'),
    content: encrypted,
  }
}

async function decryptCngnResponse(privateKey: string, encryptedData: string) {
  const dynamicImport = new Function("return import('libsodium-wrappers')")
  const sodium = await dynamicImport() as {
    ready: Promise<unknown>
    crypto_sign_ed25519_sk_to_curve25519: (key: Uint8Array) => Uint8Array
    crypto_box_NONCEBYTES: number
    crypto_box_PUBLICKEYBYTES: number
    crypto_box_open_easy: (ciphertext: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array) => Uint8Array
    to_string: (value: Uint8Array) => string
  }
  await sodium.ready

  const lines = privateKey.split('\n')
  const base64PrivateKey = lines.slice(1, -1).join('')
  const privateKeyBuffer = Buffer.from(base64PrivateKey, 'base64')
  const keyDataStart = privateKeyBuffer.indexOf(Buffer.from([0x00, 0x00, 0x00, 0x40]))
  if (keyDataStart === -1) {
    throw new Error('Unable to parse cNGN private key.')
  }

  const fullPrivateKey = new Uint8Array(privateKeyBuffer.subarray(keyDataStart + 4, keyDataStart + 68))
  const curve25519PrivateKey = sodium.crypto_sign_ed25519_sk_to_curve25519(fullPrivateKey)
  const encryptedBuffer = Buffer.from(encryptedData, 'base64')
  const nonce = new Uint8Array(encryptedBuffer.subarray(0, sodium.crypto_box_NONCEBYTES))
  const ephemeralPublicKey = new Uint8Array(encryptedBuffer.subarray(-sodium.crypto_box_PUBLICKEYBYTES))
  const ciphertext = new Uint8Array(encryptedBuffer.subarray(sodium.crypto_box_NONCEBYTES, -sodium.crypto_box_PUBLICKEYBYTES))
  const decrypted = sodium.crypto_box_open_easy(ciphertext, nonce, ephemeralPublicKey, curve25519PrivateKey)

  return sodium.to_string(decrypted)
}

async function parseCngnResponse<T>(payload: CngnApiEnvelope): Promise<T> {
  if (payload.error) {
    throw new Error(payload.error)
  }

  if (typeof payload.data === 'string') {
    const privateKey = getEnv('MAFITAPAY_CNGN_PRIVATE_KEY')
    if (!privateKey) {
      throw new Error('cNGN private key is missing.')
    }

    try {
      const decrypted = await decryptCngnResponse(privateKey, payload.data)
      const parsed = JSON.parse(decrypted) as CngnApiEnvelope | T
      if (parsed && typeof parsed === 'object' && 'data' in (parsed as CngnApiEnvelope)) {
        return (parsed as CngnApiEnvelope).data as T
      }
      return parsed as T
    } catch (error) {
      throw new Error(error instanceof Error
        ? `Unable to decrypt cNGN response. Install libsodium-wrappers or use the official SDK. ${error.message}`
        : 'Unable to decrypt cNGN response.')
    }
  }

  return payload.data as T
}

async function cngnRequest<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: Record<string, unknown> }) {
  const apiKey = getEnv('MAFITAPAY_CNGN_API_KEY')
  const encryptionKey = getEnv('MAFITAPAY_CNGN_ENCRYPTION_KEY')

  if (!apiKey || !encryptionKey) {
    throw new Error('cNGN merchant credentials are incomplete.')
  }

  const method = init?.method ?? 'GET'
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  const requestInit: RequestInit = {
    method,
    headers,
  }

  if (init?.body) {
    requestInit.body = JSON.stringify(encryptCngnPayload(JSON.stringify(init.body), encryptionKey))
  }

  const response = await fetch(`${getCngnBaseUrl()}${path}`, requestInit)
  const payload = await response.json() as CngnApiEnvelope

  if (!response.ok || payload.status === 400 || payload.error) {
    throw new Error(payload.error || payload.message || 'cNGN request failed.')
  }

  return parseCngnResponse<T>(payload)
}

export async function getCngnBalance() {
  return cngnRequest<Array<{ asset_type: string; asset_code: string; balance: string }>>('/v1/api/balance')
}

export async function createCngnVirtualAccount(input?: { provider?: 'korapay' }) {
  const data = await cngnRequest<CngnVirtualAccountResponse>('/v1/api/createVirtualAccount', {
    method: 'POST',
    body: {
      provider: input?.provider ?? 'korapay',
    },
  })

  if (!data?.accountNumber) {
    throw new Error('cNGN virtual account response did not include an account number.')
  }

  return {
    provider: 'cngn' as const,
    bank: 'KoraPay',
    accountNumber: data.accountNumber,
    accountName: 'MAFITAPAY CNGN MINT ACCOUNT',
    reference: data.accountReference,
    isPermanent: true,
  }
}
