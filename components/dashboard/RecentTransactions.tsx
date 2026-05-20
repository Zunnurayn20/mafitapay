'use client'
import { useAppStore } from '@/store'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardAction } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { fmtDate, formatNGN } from '@/lib/utils'
import type { Transaction } from '@/types'

function formatCryptoQuantity(value: number) {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1) return value.toFixed(4).replace(/\.?0+$/, '')
  return value.toFixed(5).replace(/\.?0+$/, '')
}

function formatTransactionTitle(tx: Transaction, cryptoAsset?: { symbol?: string }) {
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
        return 'Airtime'
      case 'data':
        return 'Data'
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
        return 'P2P Deposit'
      case 'p2p_withdrawal':
        return 'P2P Withdrawal'
      default:
        return tx.description
    }
  }

  const side = tx.type === 'crypto_sell' ? 'Sell' : 'Buy'
  const amount =
    typeof tx.metadata?.cryptoAmount === 'number' && Number.isFinite(tx.metadata.cryptoAmount)
      ? formatCryptoQuantity(tx.metadata.cryptoAmount)
      : null
  const symbol =
    cryptoAsset?.symbol
    || (typeof tx.metadata?.symbol === 'string' ? tx.metadata.symbol : '')
  const amountLabel = amount && symbol ? `${amount} ${symbol}` : ''
  const providerLabel = ''

  return `${side}${providerLabel}${amountLabel ? ` ${amountLabel}` : ''}`
}

export function RecentTransactions() {
  const { transactions } = useAppStore()
  const router = useRouter()
  const cryptoAssets = useCryptoAssets()
  const recent = transactions.slice(0, 5)

  return (
    <Card pattern="soft">
      <CardHeader>
        <CardTitle>Recent Transactions</CardTitle>
        <CardAction onClick={() => router.push('/history')}>View All →</CardAction>
      </CardHeader>
      <div className="divide-y divide-[var(--border)]">
        {recent.map(tx => {
          const icon = 'icon' in tx && typeof tx.icon === 'string' ? tx.icon : '•'
          const pairId = typeof tx.metadata?.pairId === 'string' ? tx.metadata.pairId : ''
          const cryptoAsset = pairId ? cryptoAssets.find(asset => asset.id === pairId) : undefined
          const statusVariant =
            tx.status === 'success' ? 'success' : tx.status === 'failed' ? 'failed' : 'pending'

          return (
            <button
              key={tx.id}
              onClick={() => router.push('/history')}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[rgba(26,26,46,.6)]"
            >
              <div className="w-8 flex-shrink-0">
                {cryptoAsset ? (
                  <AssetLogo
                    src={cryptoAsset.icon}
                    alt={`${cryptoAsset.symbol} logo`}
                    fallback={cryptoAsset.symbol.slice(0, 1)}
                    className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[rgba(79,70,229,.1)]"
                    imgClassName="h-5 w-5 object-contain"
                    textClassName="text-[15px] font-bold text-[var(--gold2)]"
                  />
                ) : (
                  <div className="text-[18px]">{icon}</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate text-[13px] font-semibold text-[var(--text)]">{formatTransactionTitle(tx, cryptoAsset)}</div>
                  <Badge variant={statusVariant}>{tx.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-[var(--muted)] font-mono">
                  <span>{tx.type.replace(/_/g,' ')}</span>
                  <span>·</span>
                  <span>{fmtDate(tx.createdAt)}</span>
                  <span>·</span>
                  <span>{tx.reference}</span>
                </div>
              </div>
              <div className={`text-right text-[13px] font-bold font-mono ${tx.amount > 0 ? 'text-[var(--green2)]' : 'text-[var(--text2)]'}`}>
                {tx.amount > 0 ? '+' : ''}{formatNGN(tx.amount)}
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
