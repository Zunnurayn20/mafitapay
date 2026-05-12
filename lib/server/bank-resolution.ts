import { generateRef } from '@/lib/utils'
import type { BankDirectoryEntry } from '@/types'
import { validateBankPayoutInput } from '@/lib/server/validation'

export type BankResolutionResult = {
  provider: string
  status: 'verified' | 'rejected'
  reference: string
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
  reason?: string
  errorCode?: string
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

export function getFlutterwaveResolutionConfigState() {
  const secretKey = getFlutterwaveSecretKey()
  const configuredProvider = readString(process.env.MAFITAPAY_BANK_RESOLUTION_PROVIDER)
  const baseUrl = getFlutterwaveBaseUrl()

  return {
    provider: configuredProvider || 'local_validation',
    secretKeyConfigured: Boolean(secretKey),
    resolutionEnabled: Boolean(secretKey) && (!configuredProvider || configuredProvider === 'flutterwave'),
    baseUrl,
  }
}

function getFlutterwaveBaseUrl() {
  const explicit = readString(process.env.MAFITAPAY_FLUTTERWAVE_BASE_URL)
  if (explicit) return explicit.replace(/\/$/, '')
  return 'https://api.flutterwave.com/v3'
}

export async function fetchFlutterwaveBanks(country = 'NG'): Promise<BankDirectoryEntry[]> {
  const secretKey = getFlutterwaveSecretKey()
  if (!secretKey) {
    throw new Error('Flutterwave secret key is not configured.')
  }

  const response = await fetch(`${getFlutterwaveBaseUrl()}/banks/${encodeURIComponent(country)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  const body = isRecord(payload) ? payload : {}
  const banks = Array.isArray(body.data) ? body.data : []

  if (!response.ok) {
    throw new Error(readString(body.message) || 'Failed to fetch Flutterwave bank list.')
  }

  return banks
    .map(item => isRecord(item) ? item : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map(item => ({
      code: readString(item.code),
      name: readString(item.name),
      country,
      provider: 'flutterwave',
      isActive: true,
    }))
    .filter(item => item.code && item.name)
}

export async function resolveBankBeneficiary(input: {
  bankCode?: string
  bankName?: string
  accountNumber?: string
  accountName?: string
}): Promise<BankResolutionResult> {
  const { bankCode, bankName, accountNumber, accountName } = validateBankPayoutInput(input)
  const configuredProvider = readString(process.env.MAFITAPAY_BANK_RESOLUTION_PROVIDER)

  if (configuredProvider && configuredProvider !== 'flutterwave') {
    if (!accountName) {
      return {
        provider: configuredProvider,
        status: 'rejected',
        reference: generateRef(),
        bankCode,
        bankName,
        accountNumber,
        accountName,
        reason: 'Account name is required when a live resolver is not configured.',
        errorCode: 'account_name_required',
      }
    }
    return {
      provider: configuredProvider,
      status: 'verified',
      reference: generateRef(),
      bankCode,
      bankName,
      accountNumber,
      accountName,
      reason: 'Validated against local bank beneficiary rules.',
      payload: {
        mode: 'local',
        bankCode,
        bankName,
        accountNumber,
        accountName,
      },
    }
  }

  const secretKey = getFlutterwaveSecretKey()
  if (!secretKey) {
    if (!accountName) {
      return {
        provider: 'local_validation',
        status: 'rejected',
        reference: generateRef(),
        bankCode,
        bankName,
        accountNumber,
        accountName,
        reason: 'Flutterwave is not configured. Account name is required for local validation fallback.',
        errorCode: 'flutterwave_not_configured',
      }
    }
    return {
      provider: 'local_validation',
      status: 'verified',
      reference: generateRef(),
      bankCode,
      bankName,
      accountNumber,
      accountName,
      reason: 'Validated against local bank beneficiary rules.',
      payload: {
        mode: 'local',
        bankCode,
        bankName,
        accountNumber,
        accountName,
      },
    }
  }

  let response: Response
  let payload: unknown = null
  try {
    response = await fetch(`${getFlutterwaveBaseUrl()}/accounts/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_number: accountNumber,
        account_bank: bankCode,
      }),
      cache: 'no-store',
    })

    try {
      payload = await response.json()
    } catch {
      payload = null
    }
  } catch (error) {
    return {
      provider: 'flutterwave',
      status: 'rejected',
      reference: generateRef(),
      bankCode,
      bankName,
      accountNumber,
      accountName,
      reason: error instanceof Error ? error.message : 'Provider verification request failed.',
      errorCode: 'provider_request_failed',
      payload: {
        mode: 'provider_error',
        bankCode,
        bankName,
        accountNumber,
      },
    }
  }

  const body = isRecord(payload) ? payload : {}
  const data = isRecord(body.data) ? body.data : {}
  const status = response.ok && readString(body.status).toLowerCase() === 'success' ? 'verified' : 'rejected'
  const resolvedAccountName = readString(data.account_name) || accountName
  const resolvedAccountNumber = readString(data.account_number) || accountNumber
  const reference = readString(data.reference) || readString(data.flw_ref) || generateRef()
  const reason = readString(body.message) || (status === 'rejected' ? 'Provider verification failed.' : '')
  const errorCode = status === 'rejected' ? readString(body.code) || `http_${response.status}` : ''

  return {
    provider: 'flutterwave',
    status,
    reference,
    bankCode,
    bankName,
    accountNumber: resolvedAccountNumber,
    accountName: resolvedAccountName,
    reason: reason || undefined,
    errorCode: errorCode || undefined,
    payload: isRecord(body) ? body : undefined,
  }
}
