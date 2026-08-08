/**
 * Shared shape for "how much float does this provider hold for us right now".
 *
 * Every provider reports through this type so the admin liquidity card can sum them without
 * knowing which vendor is which. Lookups fail soft — a provider being down or misconfigured
 * yields `balance: null` with a reason, never a throw, because the overview page must still
 * render when a vendor API is unreachable.
 */
export type ProviderBalance = {
  provider: string
  label: string
  configured: boolean
  balance: number | null
  message?: string
}

const BALANCE_KEYS = [
  'balance',
  'Balance',
  'account_balance',
  'Account_Balance',
  'wallet_balance',
  'Wallet_Balance',
  'available_balance',
  'ledger_balance',
  'amount',
]

const NESTED_KEYS = ['data', 'user', 'account', 'wallet', 'profile', 'result']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Coerce a provider's balance field to a number.
 *
 * Vendors return balances as bare numbers, decimal strings, or strings carrying separators and a
 * currency symbol ("₦12,500.00"), so strip anything that is not part of a decimal number before
 * parsing rather than trusting Number() with the raw value.
 */
export function readBalanceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Walk an arbitrary provider payload looking for a balance figure.
 *
 * These VTU APIs wrap the same field under different names and nesting depths, and the shapes
 * change without notice, so search a known key list breadth-first instead of hardcoding one path.
 */
export function findBalanceInPayload(value: unknown): number | null {
  if (!isRecord(value)) return readBalanceNumber(value)

  for (const key of BALANCE_KEYS) {
    const found = readBalanceNumber(value[key])
    if (found != null) return found
  }

  for (const key of NESTED_KEYS) {
    const nested = value[key]
    if (isRecord(nested)) {
      const found = findBalanceInPayload(nested)
      if (found != null) return found
    }
    // Some endpoints return a single-element list for the account record.
    if (Array.isArray(nested) && nested.length > 0 && isRecord(nested[0])) {
      const found = findBalanceInPayload(nested[0])
      if (found != null) return found
    }
  }

  return null
}
