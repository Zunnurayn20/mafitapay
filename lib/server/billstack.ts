import { createHmac, timingSafeEqual } from 'node:crypto'

type BillStackBank = '9PSB' | 'SAFEHAVEN' | 'PROVIDUS' | 'PALMPAY'

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getSecretKey() {
  return readString(process.env.BILLSTACK_SECRET_KEY)
}

export function isBillStackEnabled() {
  return Boolean(getSecretKey())
}

export function getBillStackVirtualAccountBank(): BillStackBank | null {
  const configured = readString(process.env.BILLSTACK_VIRTUAL_ACCOUNT_BANK)
  if (!configured) return 'PALMPAY'
  const bank = configured.toUpperCase()
  return bank === '9PSB' || bank === 'SAFEHAVEN' || bank === 'PROVIDUS' || bank === 'PALMPAY'
    ? bank
    : null
}

export async function createBillStackVirtualAccount(input: {
  reference: string
  email: string
  phone: string
  firstName: string
  lastName: string
  bank: BillStackBank
  idType?: 'nin' | 'bvn'
  idNumber?: string
}) {
  const secretKey = getSecretKey()
  if (!secretKey) return { status: 'failed' as const, reason: 'BillStack is not configured.' }
  if (!input.email || !input.phone || !input.firstName || !input.lastName) {
    return { status: 'failed' as const, reason: 'The customer profile is missing required account details.' }
  }

  const body: Record<string, unknown> = {
    reference: input.reference,
    email: input.email,
    phone: input.phone,
    firstName: input.firstName,
    lastName: input.lastName,
    bank: input.bank,
  }
  if (input.bank === 'PALMPAY') {
    if (!input.idType || !input.idNumber) {
      return { status: 'failed' as const, reason: 'Secure BVN/NIN is required for a BillStack PalmPay account.' }
    }
    body.idType = input.idType
    body.idNumber = input.idNumber
  }

  let response: Response
  try {
    response = await fetch('https://api.billstack.co/v2/thirdparty/generateVirtualAccount/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    return {
      status: 'failed' as const,
      indeterminate: true,
      reason: error instanceof Error ? error.message : 'BillStack account request timed out.',
    }
  }

  const parsed: unknown = await response.json().catch(() => null)
  const envelope = isRecord(parsed) ? parsed : {}
  const data = isRecord(envelope.data) ? envelope.data : {}
  const account = Array.isArray(data.account) && isRecord(data.account[0]) ? data.account[0] : null
  const accountNumber = account ? readString(account.account_number) : ''
  const accountName = account ? readString(account.account_name) : ''
  const bankName = account ? readString(account.bank_name) : ''
  const providerReference = readString(data.reference)

  if (response.ok && envelope.status === true && accountNumber && accountName && bankName && providerReference) {
    return {
      status: 'success' as const,
      accountNumber,
      accountName,
      bankName,
      providerReference,
      payload: data,
    }
  }

  return {
    status: 'failed' as const,
    indeterminate: response.status >= 500 || response.ok,
    reason: readString(envelope.message) || `BillStack account request failed (${response.status}).`,
    rawStatus: response.status,
  }
}

export function verifyBillStackWebhookSignature(input: {
  rawBody: string
  timestamp: string | null
  signature: string | null
  nowMs?: number
}) {
  const secretKey = getSecretKey()
  const timestamp = input.timestamp?.trim() ?? ''
  const signature = input.signature?.trim().toLowerCase() ?? ''
  if (!secretKey || !/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false

  const timestampSeconds = Number(timestamp)
  const timestampMs = timestamp.length === 13 ? timestampSeconds : timestampSeconds * 1000
  const now = input.nowMs ?? Date.now()
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) return false

  const expected = createHmac('sha256', secretKey).update(`${timestamp}.${input.rawBody}`).digest()
  const received = Buffer.from(signature, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export async function getBillStackTransaction(sessionId: string) {
  const secretKey = getSecretKey()
  if (!secretKey) throw new Error('BillStack is not configured.')

  const response = await fetch('https://api.billstack.co/v2/thirdparty/getTransaction/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ session_id: sessionId }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  })
  const parsed: unknown = await response.json().catch(() => null)
  const envelope = isRecord(parsed) ? parsed : {}
  if (!response.ok || envelope.status !== true || !isRecord(envelope.data)) {
    throw new Error('BillStack could not verify the deposit transaction.')
  }
  return envelope.data
}
