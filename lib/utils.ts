import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatNGN(amount: number): string {
  return '₦' + Math.abs(amount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatUSD(amount: number): string {
  return '$' + Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatUSDAdaptive(amount: number): string {
  const absolute = Math.abs(amount)
  if (!Number.isFinite(absolute)) return '$0.00'
  const fractionDigits = absolute < 10 ? 4 : absolute < 100 ? 3 : 2
  return '$' + absolute.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

export function formatPercentChange(value: number): string {
  const amount = Math.abs(value)
  if (!Number.isFinite(amount)) return '0.00%'
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

export function formatRelativeSyncTime(updatedAt?: string): string {
  if (!updatedAt) return 'No recent sync'

  const timestamp = new Date(updatedAt).getTime()
  if (!Number.isFinite(timestamp)) return 'No recent sync'

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 5) return 'Synced just now'
  if (seconds < 60) return `Synced ${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Synced ${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  return `Synced ${hours}h ago`
}

export function formatCrypto(amount: number, symbol: string): string {
  if (amount === 0) return `— ${symbol}`
  if (amount < 0.001) return `${amount.toFixed(8)} ${symbol}`
  if (amount < 1) return `${amount.toFixed(6)} ${symbol}`
  return `${amount.toFixed(4)} ${symbol}`
}

export function generateRef(): string {
  return 'MFP-' + Math.random().toString(36).slice(2,6).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase()
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (d.toDateString() === today.toDateString()) {
    return 'Today ' + d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday ' + d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
}

export function calcCryptoFee(amount: number): number {
  return Math.max(50, amount * 0.005)
}
