'use client'
import { useAppStore } from '@/store'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardAction } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { fmtDate, formatNGN } from '@/lib/utils'

export function RecentTransactions() {
  const { transactions } = useAppStore()
  const router = useRouter()
  const cryptoAssets = useCryptoAssets()
  const recent = transactions.slice(0, 5)

  return (
    <Card>
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
                  <div className="truncate text-[13px] font-semibold text-[var(--text)]">{tx.description}</div>
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
