'use client'
import { Card } from '@/components/ui/Card'
import { useAppStore } from '@/store'
import { formatNGN } from '@/lib/utils'

function formatCompactNgn(value: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function StatCards() {
  const { transactions } = useAppStore()
  const successful = transactions.filter(item => item.status === 'success')
  const pending = transactions.filter(item => item.status === 'pending' || item.status === 'processing')
  const totalInflows = successful.filter(item => item.amount > 0).reduce((sum, item) => sum + item.amount, 0)
  const totalOutflows = successful.filter(item => item.amount < 0).reduce((sum, item) => sum + Math.abs(item.amount), 0)
  const p2pTrades = successful.filter(item => item.type.startsWith('p2p')).length
  const cryptoVolume = successful
    .filter(item => item.type === 'crypto_buy' || item.type === 'crypto_sell')
    .reduce((sum, item) => sum + Math.abs(item.amount), 0)
  const stats = [
    {
      label: 'Total Inflow',
      value: formatCompactNgn(totalInflows),
      sub: totalInflows > 0 ? `${formatNGN(totalInflows)} settled` : 'No completed inflows yet',
      color: 'var(--green)',
      subColor: totalInflows > 0 ? 'var(--green2)' : 'var(--muted)',
    },
    {
      label: 'Total Outflow',
      value: formatCompactNgn(totalOutflows),
      sub: totalOutflows > 0 ? `${formatNGN(totalOutflows)} settled` : 'No completed outflows yet',
      color: 'var(--terra2)',
      subColor: totalOutflows > 0 ? 'var(--red2)' : 'var(--muted)',
    },
    {
      label: 'Pending Actions',
      value: String(pending.length),
      sub: pending.length > 0 ? `${pending.length} transaction${pending.length === 1 ? '' : 's'} awaiting resolution` : 'No pending transaction',
      color: 'var(--gold2)',
      subColor: pending.length > 0 ? 'var(--gold2)' : 'var(--muted)',
    },
    {
      label: 'Crypto Volume',
      value: formatCompactNgn(cryptoVolume),
      sub: p2pTrades > 0 ? `${p2pTrades} completed P2P trade${p2pTrades === 1 ? '' : 's'}` : 'No completed P2P trades yet',
      color: 'var(--purple)',
      subColor: p2pTrades > 0 ? 'var(--green2)' : 'var(--muted)',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(s => (
        <Card key={s.label} className="p-5" accent={s.color}>
          <div className="text-[8px] font-bold uppercase tracking-[1.3px] text-[var(--muted)] mb-2">{s.label}</div>
          <div className="font-display font-black text-[26px] text-[var(--text)] leading-none mb-1.5">{s.value}</div>
          <div className="text-[10px]" style={{ color: s.subColor }}>{s.sub}</div>
        </Card>
      ))}
    </div>
  )
}
