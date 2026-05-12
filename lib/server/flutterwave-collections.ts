import { generateRef } from '@/lib/utils'

type FlutterwaveVirtualAccountInput = {
  reference: string
  email: string
  phoneNumber: string
  firstName: string
  lastName: string
  amount: number
  narration: string
}

type FlutterwaveStaticVirtualAccountInput = Omit<FlutterwaveVirtualAccountInput, 'amount'> & {
  identityType: 'bvn' | 'nin'
  identityNumber: string
}

export type FlutterwaveVirtualAccountResult = {
  provider: 'flutterwave'
  reference: string
  status: 'pending' | 'failed'
  providerReference?: string
  rawStatus?: string
  reason?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
  expiresAt?: string
  note?: string
  payload?: Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getFlutterwaveSecretKey() {
  return readString(process.env.MAFITAPAY_FLUTTERWAVE_SECRET_KEY)
}

function getFlutterwaveBaseUrl() {
  const explicit = readString(process.env.MAFITAPAY_FLUTTERWAVE_BASE_URL)
  if (explicit) return explicit.replace(/\/$/, '')
  return 'https://api.flutterwave.com/v3'
}

export function getFlutterwaveCollectionsConfigState() {
  const secretKey = getFlutterwaveSecretKey()

  return {
    secretKeyConfigured: Boolean(secretKey),
    depositsEnabled: Boolean(secretKey),
    baseUrl: getFlutterwaveBaseUrl(),
  }
}

export function isFlutterwaveCollectionsEnabled() {
  return Boolean(getFlutterwaveSecretKey())
}

export async function createFlutterwaveVirtualAccount(input: FlutterwaveVirtualAccountInput): Promise<FlutterwaveVirtualAccountResult> {
  const secretKey = getFlutterwaveSecretKey()
  if (!secretKey) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'NOT_CONFIGURED',
      reason: 'Flutterwave deposit collections are not configured.',
      payload: {
        stage: 'config',
      },
    }
  }

  let response: Response
  try {
    response = await fetch(`${getFlutterwaveBaseUrl()}/virtual-account-numbers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        amount: input.amount,
        currency: 'NGN',
        tx_ref: input.reference,
        phonenumber: input.phoneNumber,
        firstname: input.firstName,
        lastname: input.lastName,
        narration: input.narration,
      }),
      cache: 'no-store',
    })
  } catch (error) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'Flutterwave virtual account request failed.',
      payload: {
        stage: 'request',
        message: error instanceof Error ? error.message : 'Flutterwave virtual account request failed.',
      },
    }
  }

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}
  const data = isRecord(body.data) ? body.data : {}
  const rawStatus = readString(body.status).toLowerCase()
  const providerReference = readString(data.flw_ref) || readString(data.order_ref)
  const bankName = readString(data.bank_name)
  const accountNumber = readString(data.account_number)
  const expiresAt = readString(data.expiry_date)
  const note = readString(data.note)
  const providerMessage = readString(body.message) || readString(data.response_message)

  if (!response.ok || rawStatus !== 'success' || !accountNumber || !bankName) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      providerReference: providerReference || undefined,
      rawStatus: readString(data.response_code) || rawStatus || 'FAILED',
      reason: providerMessage || 'Flutterwave virtual account creation failed.',
      payload: body,
    }
  }

  return {
    provider: 'flutterwave',
    reference: input.reference,
    status: 'pending',
    providerReference: providerReference || undefined,
    rawStatus: readString(data.response_code) || '02',
    reason: providerMessage || undefined,
    bankName,
    accountNumber,
    accountName: input.narration,
    expiresAt: expiresAt && expiresAt !== 'N/A' ? expiresAt : undefined,
    note: note || undefined,
    payload: body,
  }
}

export async function createFlutterwaveStaticVirtualAccount(input: FlutterwaveStaticVirtualAccountInput): Promise<FlutterwaveVirtualAccountResult> {
  const secretKey = getFlutterwaveSecretKey()
  if (!secretKey) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'NOT_CONFIGURED',
      reason: 'Flutterwave deposit collections are not configured.',
      payload: {
        stage: 'config',
      },
    }
  }

  let response: Response
  try {
    response = await fetch(`${getFlutterwaveBaseUrl()}/virtual-account-numbers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        tx_ref: input.reference,
        phonenumber: input.phoneNumber,
        firstname: input.firstName,
        lastname: input.lastName,
        narration: input.narration,
        is_permanent: true,
        [input.identityType]: input.identityNumber,
      }),
      cache: 'no-store',
    })
  } catch (error) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      rawStatus: 'REQUEST_ERROR',
      reason: error instanceof Error ? error.message : 'Flutterwave static virtual account request failed.',
      payload: {
        stage: 'request',
        message: error instanceof Error ? error.message : 'Flutterwave static virtual account request failed.',
      },
    }
  }

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}
  const data = isRecord(body.data) ? body.data : {}
  const rawStatus = readString(body.status).toLowerCase()
  const providerReference = readString(data.flw_ref) || readString(data.order_ref)
  const bankName = readString(data.bank_name)
  const accountNumber = readString(data.account_number)
  const note = readString(data.note)
  const providerMessage = readString(body.message) || readString(data.response_message)

  if (!response.ok || rawStatus !== 'success' || !accountNumber || !bankName) {
    return {
      provider: 'flutterwave',
      reference: input.reference,
      status: 'failed',
      providerReference: providerReference || undefined,
      rawStatus: readString(data.response_code) || rawStatus || 'FAILED',
      reason: providerMessage || 'Flutterwave static virtual account creation failed.',
      payload: body,
    }
  }

  return {
    provider: 'flutterwave',
    reference: input.reference,
    status: 'pending',
    providerReference: providerReference || undefined,
    rawStatus: readString(data.response_code) || '02',
    reason: providerMessage || undefined,
    bankName,
    accountNumber,
    accountName: input.narration,
    note: note || undefined,
    payload: body,
  }
}

export function mapFlutterwaveChargeStatus(rawStatus: string) {
  const normalized = rawStatus.trim().toLowerCase()
  if (normalized === 'successful' || normalized === 'success') return 'success'
  if (normalized === 'failed' || normalized === 'failure') return 'failed'
  return null
}

export function buildFlutterwaveCollectionsEventId(eventType: string, reference: string, providerReference?: string) {
  return providerReference || `${eventType}:${reference}:${generateRef()}`
}
