import type { Transaction } from '@/types'

/** Crypto quantities: 4dp from one unit up, 5dp below it, trailing zeros trimmed. */
export function formatCryptoQuantity(value: number) {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1) return value.toFixed(4).replace(/\.?0+$/, '')
  return value.toFixed(5).replace(/\.?0+$/, '')
}

/**
 * The customer-facing name for a transaction. The dashboard activity card, history, the bills list
 * and the crypto page all read it from here, so one transaction cannot be called two different
 * things on two screens.
 *
 * Titles derive from tx.type, not the stored description, which is why renaming a label also
 * relabels transactions already in the ledger.
 */
export function formatTransactionTitle(tx: Transaction, cryptoAsset?: { symbol?: string }) {
  if (!tx.type.startsWith('crypto')) {
    switch (tx.type) {
      case 'deposit':
        return 'Bank Deposit'
      case 'withdrawal':
        return 'Bank Withdrawal'
      case 'transfer_in':
        return 'Funds Received'
      case 'transfer_out':
        return tx.metadata?.settlementKind === 'bank_transfer_out' ? 'Bank Transfer' : 'Internal Transfer'
      case 'airtime':
        return 'Airtime Purchase'
      case 'data':
        return 'Data Purchase'
      case 'electric':
        return 'Electricity'
      case 'cable':
        return 'Cable TV'
      case 'education':
        return 'Education'
      case 'gas':
        return 'Gas'
      case 'insurance':
        return 'Insurance'
      case 'water':
        return 'Water'
      case 'referral_bonus':
        return 'Referral Bonus'
      case 'reward_bonus':
        return 'Reward Bonus'
      case 'p2p_deposit':
        return 'Deposit'
      case 'p2p_withdrawal':
        return 'Withdrawal'
      default:
        return tx.description
    }
  }

  const side = tx.type === 'crypto_sell' ? 'Crypto Deposit' : 'Buy'
  const amount =
    typeof tx.metadata?.cryptoAmount === 'number' && Number.isFinite(tx.metadata.cryptoAmount)
      ? formatCryptoQuantity(tx.metadata.cryptoAmount)
      : null
  const symbol =
    cryptoAsset?.symbol
    || (typeof tx.metadata?.symbol === 'string' ? tx.metadata.symbol : '')
  const amountLabel = amount && symbol ? `${amount} ${symbol}` : ''

  return `${side}${amountLabel ? ` ${amountLabel}` : ''}`
}
