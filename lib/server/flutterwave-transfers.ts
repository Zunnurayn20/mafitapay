import { createHmac } from 'node:crypto'
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

function getTokenUrl() {
  return readString(process.env.MAFITAPAY_FLUTTERWAVE_TOKEN_URL)
    || 'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token'
}

export function isFlutterwavePayoutEnabled() {
  return Boolean(getClientId() && getClientSecret())
}

async function getFlutterwaveAccessToken() {
  const clientId = getClientId()
  const clientSecret = getClientSecret()
  if (!clientId || !clientSecret) {
    throw new Error('Flutterwave transfer credentials are not configured.')
  }

  const response = await fetch(getTokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}
  const token = readString(body.access_token)
  if (!response.ok || !token) {
    throw new Error(readString(body.error_description) || readString(body.message) || 'Unable to obtain Flutterwave access token.')
  }
  return token
}

export async function initiateFlutterwaveBankTransfer(input: FlutterwaveTransferInit): Promise<FlutterwaveTransferResult> {
  let token = ''
  try {
    token = await getFlutterwaveAccessToken()
  } catch (error) {
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
            type: 'bank',
            bank: {
              account_number: input.accountNumber,
              code: input.bankCode,
            },
            name: input.accountName,
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

export function verifyFlutterwaveWebhook(rawBody: string, signature: string | null) {
  const secretHash = readString(process.env.MAFITAPAY_FLUTTERWAVE_SECRET_HASH)
  if (!secretHash || !signature) return false
  const computed = createHmac('sha256', secretHash).update(rawBody).digest('base64')
  return computed === signature || signature === secretHash
}

export function mapFlutterwaveTransferStatus(status: string | null | undefined): 'success' | 'failed' | null {
  const normalized = readString(status).toUpperCase()
  if (normalized === 'SUCCESSFUL' || normalized === 'SUCCESS') return 'success'
  if (normalized === 'FAILED' || normalized === 'FAIL' || normalized === 'ERROR') return 'failed'
  return null
}
