import { createHmac, timingSafeEqual } from 'node:crypto'
import { generateRef } from '@/lib/utils'

type FlutterwaveTransferInit = {
  amount: number
  reference: string
  narration: string
  bankCode: string
  accountNumber: string
  accountName: string
  callbackUrl?: string
}

export type FlutterwaveTransferResult = {
  provider: 'flutterwave'
  providerReference?: string
  reference: string
  status: 'pending' | 'success' | 'failed'
  rawStatus?: string
  reason?: string
  payload?: Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getClientId() {
  return readString(process.env.MAFITAPAY_FLUTTERWAVE_CLIENT_ID)
}

function getClientSecret() {
  return readString(process.env.MAFITAPAY_FLUTTERWAVE_CLIENT_SECRET)
}

function getLegacySecretKey() {
  return readString(process.env.MAFITAPAY_FLUTTERWAVE_SECRET_KEY)
    || readString(process.env.FLUTTERWAVE_SECRET_KEY)
}

function getLegacyBaseUrl() {
  const explicit = readString(process.env.MAFITAPAY_FLUTTERWAVE_BASE_URL)
  return (explicit || 'https://api.flutterwave.com/v3').replace(/\/$/, '')
}

export function getFlutterwaveTransferConfigState() {
  const clientId = getClientId()
  const clientSecret = getClientSecret()
  const secretHash = readString(process.env.MAFITAPAY_FLUTTERWAVE_SECRET_HASH)
  const callbackUrl = readString(process.env.MAFITAPAY_FLUTTERWAVE_CALLBACK_URL)
  const jobSecret = readString(process.env.MAFITAPAY_JOB_SECRET)

  return {
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
    secretHashConfigured: Boolean(secretHash),
    callbackUrlConfigured: Boolean(callbackUrl),
    jobSecretConfigured: Boolean(jobSecret),
    payoutsEnabled: Boolean(clientId && clientSecret),
    webhooksEnabled: Boolean(secretHash),
  }
}

function getTransferBaseUrl() {
  const explicit = readString(process.env.MAFITAPAY_FLUTTERWAVE_TRANSFERS_BASE_URL)
  if (explicit) return explicit.replace(/\/$/, '')
  return 'https://developersandbox-api.flutterwave.com'
}

const DEFAULT_TOKEN_URL = 'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token'

function getTokenUrl() {
  return readString(process.env.MAFITAPAY_FLUTTERWAVE_TOKEN_URL) || DEFAULT_TOKEN_URL
}

/**
 * Guard against pointing the OAuth token URL at the v3 REST API.
 *
 * `client_credentials` posted to `api.flutterwave.com/v3/...` does not fail as a bad credential —
 * the API gateway answers 401 `{"status":"error","message":"Authorization required"}`, which this
 * module surfaces as the payout's failure reason. Users then see an opaque "Authorization required"
 * on a receipt while the credentials themselves are perfectly valid, and the real fault (an env var
 * carrying a v3 URL) is invisible. Fail with a message that names the fix instead.
 */
function assertTokenUrlIsIdentityProvider(url: string) {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    throw new Error(`MAFITAPAY_FLUTTERWAVE_TOKEN_URL is not a valid URL: ${url}`)
  }
  if (/^\/v\d+(\/|$)/.test(pathname)) {
    throw new Error(
      `MAFITAPAY_FLUTTERWAVE_TOKEN_URL points at the v3 REST API (${url}), not the OAuth identity provider. `
      + `Set it to ${DEFAULT_TOKEN_URL}`
    )
  }
}

export function isFlutterwavePayoutEnabled() {
  return Boolean((getClientId() && getClientSecret()) || getLegacySecretKey())
}

async function initiateLegacyFlutterwaveTransfer(input: FlutterwaveTransferInit): Promise<FlutterwaveTransferResult> {
  const secretKey = getLegacySecretKey()
  if (!secretKey) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'TOKEN_ERROR',
      reason: 'Flutterwave payout credentials are unavailable.',
      payload: { stage: 'legacy_fallback' },
    }
  }

  const callbackUrl = input.callbackUrl || readString(process.env.MAFITAPAY_FLUTTERWAVE_CALLBACK_URL)
  let response: Response
  try {
    response = await fetch(`${getLegacyBaseUrl()}/transfers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_bank: input.bankCode,
        account_number: input.accountNumber,
        amount: input.amount,
        narration: input.narration,
        currency: 'NGN',
        reference: input.reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        debit_currency: 'NGN',
      }),
      cache: 'no-store',
    })
  } catch (error) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'Flutterwave transfer request failed.',
      payload: { stage: 'legacy_request' },
    }
  }

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}
  const data = isRecord(body.data) ? body.data : {}
  const rawStatus = readString(data.status).toUpperCase()
  const providerReference = readString(data.id) || readString(data.reference) || input.reference
  if (!response.ok || readString(body.status).toLowerCase() !== 'success') {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      providerReference: `v3:${providerReference}`,
      status: 'failed',
      rawStatus: rawStatus || 'FAILED',
      reason: readString(body.message) || `Flutterwave payout failed (HTTP ${response.status}).`,
      payload: body,
    }
  }
  return {
    provider: 'flutterwave',
    reference: input.reference,
    providerReference: `v3:${providerReference}`,
    status: rawStatus === 'SUCCESSFUL' ? 'success' : 'pending',
    rawStatus: rawStatus || 'NEW',
    reason: readString(body.message) || undefined,
    payload: body,
  }
}

async function retrieveLegacyFlutterwaveTransfer(providerReference: string): Promise<FlutterwaveTransferResult> {
  const secretKey = getLegacySecretKey()
  const id = providerReference.replace(/^v3:/, '')
  if (!secretKey) {
    return { provider: 'flutterwave', reference: '', providerReference, status: 'failed', rawStatus: 'CREDENTIAL_ERROR', reason: 'Flutterwave payout credentials are unavailable.' }
  }
  let response: Response
  try {
    response = await fetch(`${getLegacyBaseUrl()}/transfers/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
  } catch (error) {
    return { provider: 'flutterwave', reference: '', providerReference, status: 'failed', rawStatus: 'REQUEST_ERROR', reason: error instanceof Error ? error.message : 'Flutterwave transfer retrieval failed.' }
  }
  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}
  const data = isRecord(body.data) ? body.data : {}
  const rawStatus = readString(data.status).toUpperCase()
  const reference = readString(data.reference) || readString(data.tx_ref)
  if (!response.ok || readString(body.status).toLowerCase() !== 'success') {
    return { provider: 'flutterwave', reference, providerReference, status: 'failed', rawStatus: rawStatus || 'FAILED', reason: readString(body.message) || `Flutterwave transfer retrieval failed (HTTP ${response.status}).`, payload: body }
  }
  return { provider: 'flutterwave', reference, providerReference, status: rawStatus === 'SUCCESSFUL' ? 'success' : rawStatus === 'FAILED' ? 'failed' : 'pending', rawStatus: rawStatus || 'UNKNOWN', reason: readString(body.message) || undefined, payload: body }
}

async function getFlutterwaveAccessToken() {
  const clientId = getClientId()
  const clientSecret = getClientSecret()
  if (!clientId || !clientSecret) {
    throw new Error('Flutterwave transfer credentials are not configured.')
  }

  const tokenUrl = getTokenUrl()
  assertTokenUrlIsIdentityProvider(tokenUrl)

  let lastReason = 'Unable to obtain Flutterwave access token.'
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
        }),
        cache: 'no-store',
      })
    } catch (error) {
      lastReason = error instanceof Error ? error.message : lastReason
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)))
      continue
    }

    const payload = await response.json().catch(() => null)
    const body = isRecord(payload) ? payload : {}
    const token = readString(body.access_token)
    if (response.ok && token) return token

    lastReason = readString(body.error_description) || readString(body.message) || `Flutterwave token endpoint returned HTTP ${response.status}.`
    // Retry transient provider or gateway failures. Invalid credentials and other 4xx
    // responses are returned immediately so a bad configuration is not masked.
    if (response.status < 500 && response.status !== 429) break
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)))
  }

  throw new Error(lastReason)
}

export async function initiateFlutterwaveBankTransfer(input: FlutterwaveTransferInit): Promise<FlutterwaveTransferResult> {
  let token = ''
  try {
    token = await getFlutterwaveAccessToken()
  } catch (error) {
    // Keep payouts available while the v4 OAuth application is rejected or unavailable.
    // The legacy v3 endpoint uses the existing server-side secret key and the same reference.
    if (getLegacySecretKey()) return initiateLegacyFlutterwaveTransfer(input)
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'TOKEN_ERROR',
      reason: error instanceof Error ? error.message : 'Unable to obtain Flutterwave access token.',
      payload: {
        stage: 'token',
        message: error instanceof Error ? error.message : 'Unable to obtain Flutterwave access token.',
      },
    }
  }
  const callbackUrl = input.callbackUrl || readString(process.env.MAFITAPAY_FLUTTERWAVE_CALLBACK_URL)
  const traceId = generateRef()
  const idempotencyKey = input.reference

  let response: Response
  try {
    response = await fetch(`${getTransferBaseUrl()}/direct-transfers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        action: 'instant',
        type: 'bank',
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        narration: input.narration,
        reference: input.reference,
        payment_instruction: {
          source_currency: 'NGN',
          destination_currency: 'NGN',
          amount: {
            value: input.amount,
            applies_to: 'destination_currency',
          },
          recipient: {
            bank: {
              account_number: input.accountNumber,
              code: input.bankCode,
            },
          },
        },
      }),
      cache: 'no-store',
    })
  } catch (error) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'Flutterwave transfer request failed.',
      payload: {
        stage: 'request',
        message: error instanceof Error ? error.message : 'Flutterwave transfer request failed.',
        traceId,
      },
    }
  }

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}
  const data = isRecord(body.data) ? body.data : {}
  const rawStatus = readString(data.status).toUpperCase()
  const providerReference = readString(data.id)

  if (!response.ok || readString(body.status).toLowerCase() !== 'success') {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: rawStatus || 'FAILED',
      providerReference: providerReference || undefined,
      reason: readString(body.message) || 'Flutterwave transfer initiation failed.',
      payload: body,
    }
  }

  return {
    provider: 'flutterwave',
    reference: input.reference,
    status: rawStatus === 'SUCCESSFUL' ? 'success' : 'pending',
    rawStatus: rawStatus || 'NEW',
    providerReference: providerReference || undefined,
    reason: readString(body.message) || undefined,
    payload: body,
  }
}

export async function retrieveFlutterwaveTransfer(providerReference: string): Promise<FlutterwaveTransferResult> {
  if (providerReference.startsWith('v3:')) return retrieveLegacyFlutterwaveTransfer(providerReference)
  let token = ''
  try {
    token = await getFlutterwaveAccessToken()
  } catch (error) {
    return {
      provider: 'flutterwave',
      reference: '',
      providerReference,
      status: 'failed',
      rawStatus: 'TOKEN_ERROR',
      reason: error instanceof Error ? error.message : 'Unable to obtain Flutterwave access token.',
      payload: {
        stage: 'token',
        message: error instanceof Error ? error.message : 'Unable to obtain Flutterwave access token.',
      },
    }
  }

  const traceId = generateRef()
  let response: Response
  try {
    response = await fetch(`${getTransferBaseUrl()}/transfers/${encodeURIComponent(providerReference)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Idempotency-Key': providerReference,
      },
      cache: 'no-store',
    })
  } catch (error) {
    return {
      provider: 'flutterwave',
      reference: '',
      providerReference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'Flutterwave transfer retrieval failed.',
      payload: {
        stage: 'retrieve_request',
        message: error instanceof Error ? error.message : 'Flutterwave transfer retrieval failed.',
        traceId,
      },
    }
  }

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}
  const data = isRecord(body.data) ? body.data : {}
  const rawStatus = readString(data.status).toUpperCase()
  const reference = readString(data.reference)

  if (!response.ok || readString(body.status).toLowerCase() !== 'success') {
    return {
      provider: 'flutterwave',
      reference,
      providerReference,
      status: 'failed',
      rawStatus: rawStatus || 'FAILED',
      reason: readString(body.message) || 'Flutterwave transfer retrieval failed.',
      payload: body,
    }
  }

  return {
    provider: 'flutterwave',
    reference,
    providerReference,
    status: rawStatus === 'SUCCESSFUL' ? 'success' : rawStatus === 'FAILED' ? 'failed' : 'pending',
    rawStatus: rawStatus || 'UNKNOWN',
    reason: readString(body.message) || undefined,
    payload: body,
  }
}

function safeStringEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export function verifyFlutterwaveWebhook(
  rawBody: string,
  signature: string | null,
  format: 'hmac' | 'secret_hash' = 'hmac'
) {
  const secretHash = readString(process.env.MAFITAPAY_FLUTTERWAVE_SECRET_HASH)
  if (!secretHash || !signature) return false
  if (format === 'secret_hash') return safeStringEqual(signature, secretHash)
  const computed = createHmac('sha256', secretHash).update(rawBody).digest('base64')
  return safeStringEqual(computed, signature)
}

export function mapFlutterwaveTransferStatus(status: string | null | undefined): 'success' | 'failed' | null {
  const normalized = readString(status).toUpperCase()
  if (normalized === 'SUCCESSFUL' || normalized === 'SUCCESS') return 'success'
  if (normalized === 'FAILED' || normalized === 'FAIL' || normalized === 'ERROR') return 'failed'
  return null
}
