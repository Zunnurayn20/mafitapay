import type { CryptoOrder, CryptoQuote, Transaction } from '@/types'

/** Keep provider/debug details in server records while returning clean customer transaction data. */
export function toCustomerTransaction(transaction: Transaction): Transaction {
  const metadata = transaction.metadata ? { ...transaction.metadata } : undefined
  if (metadata) {
    delete metadata.reason
    delete metadata.failureReason
    delete metadata.providerError
  }

  return { ...transaction, metadata }
}

export function toCustomerCryptoOrder(order: CryptoOrder): CryptoOrder {
  const customerOrder = { ...order }
  delete customerOrder.providerPayload
  return customerOrder
}

export function toCustomerCryptoQuote<T extends { quote: CryptoQuote }>(data: T): T {
  const quote = { ...data.quote }
  delete quote.providerPayload
  return { ...data, quote }
}

export function toCustomerCryptoSyncResult<T>(result: T): T {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return result
  const clean = { ...(result as Record<string, unknown>) }
  const order = clean.order
  if (typeof order === 'object' && order !== null && 'id' in order && 'userId' in order) {
    clean.order = toCustomerCryptoOrder(order as CryptoOrder)
  }
  const transaction = clean.transaction
  if (typeof transaction === 'object' && transaction !== null && 'id' in transaction && 'metadata' in transaction) {
    clean.transaction = toCustomerTransaction(transaction as Transaction)
  }
  return clean as T
}

export function toCustomerProviderEvent<T extends {
  provider: string
  status: string
  createdAt: string
  processedAt?: string
  reference?: string
  externalEventId?: string
}>(event: T) {
  return {
    provider: event.provider,
    status: event.status,
    createdAt: event.createdAt,
    processedAt: event.processedAt,
    reference: event.reference,
    externalEventId: event.externalEventId,
  }
}
