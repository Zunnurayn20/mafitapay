'use client'

export type ConfirmationDetail = { label: string; value: string }

export type PendingConfirmation = {
  kind: 'bill' | 'transfer' | 'withdrawal' | 'crypto_buy'
  title: string
  amountNgn: number
  details: ConfirmationDetail[]
  request: Record<string, unknown>
  returnPath: string
}

const KEY = 'mafitapay:pending-transaction-confirmation'

export function savePendingConfirmation(payload: PendingConfirmation) {
  sessionStorage.setItem(KEY, JSON.stringify(payload))
}

export function loadPendingConfirmation(): PendingConfirmation | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as PendingConfirmation : null
  } catch {
    return null
  }
}

export function clearPendingConfirmation() {
  sessionStorage.removeItem(KEY)
}
