import { useAppStore } from '@/store'

type TxFilter = 'all' | 'deposit' | 'withdrawal' | 'bills' | 'crypto' | 'p2p'

export function useTransactions(filter: TxFilter = 'all') {
  const { transactions } = useAppStore()

  const filtered = transactions.filter(tx => {
    if (filter === 'all')       return true
    if (filter === 'deposit')   return tx.type.includes('deposit')
    if (filter === 'withdrawal')return tx.type.includes('withdrawal') || tx.type.includes('transfer_out')
    if (filter === 'bills')     return ['airtime','data','electric','cable','education','gas','insurance','water'].includes(tx.type)
    if (filter === 'crypto')    return tx.type.startsWith('crypto')
    if (filter === 'p2p')       return tx.type.startsWith('p2p')
    return true
  })

  const totalIn  = filtered.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOut = filtered.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)

  return { transactions: filtered, totalIn, totalOut, count: filtered.length }
}
