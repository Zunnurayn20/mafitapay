'use client'
import { AssetLogo } from '@/components/ui/AssetLogo'
import type { Transaction } from '@/types'

/** Dark tile surface (matches activity card); only the glyph keeps a type colour. */
const TX_TILE = 'border-[var(--border)] bg-[var(--coal)]'

function getTransactionTypeIconStyle(type: Transaction['type'], amount: number) {
  const styles: Record<Transaction['type'], string> = {
    deposit: `${TX_TILE} text-emerald-400`,
    withdrawal: `${TX_TILE} text-rose-400`,
    transfer_in: `${TX_TILE} text-green-400`,
    transfer_out: `${TX_TILE} text-sky-400`,
    airtime: `${TX_TILE} text-amber-400`,
    data: `${TX_TILE} text-sky-400`,
    electric: `${TX_TILE} text-emerald-400`,
    cable: `${TX_TILE} text-violet-400`,
    education: `${TX_TILE} text-sky-400`,
    gas: `${TX_TILE} text-orange-400`,
    insurance: `${TX_TILE} text-rose-400`,
    water: `${TX_TILE} text-cyan-400`,
    crypto_buy: `${TX_TILE} text-orange-400`,
    crypto_sell: `${TX_TILE} text-yellow-400`,
    referral_bonus: `${TX_TILE} text-lime-400`,
    reward_bonus: `${TX_TILE} text-teal-400`,
    admin_credit: `${TX_TILE} text-green-400`,
    admin_debit: `${TX_TILE} text-red-400`,
    p2p_deposit: `${TX_TILE} text-emerald-400`,
    p2p_withdrawal: `${TX_TILE} text-rose-400`,
  }

  return styles[type] || (amount > 0
    ? `${TX_TILE} text-emerald-400`
    : `${TX_TILE} text-[var(--text2)]`)
}

/**
 * The 40px enclosing tile a transaction row leads with. The dashboard activity card and the history
 * list both render this one component, so the two views cannot drift apart. Callers own the
 * fixed-width wrapper (`w-10 flex-shrink-0`) that reserves the column.
 */
export function TransactionIcon({
  tx,
  cryptoAsset,
}: {
  tx: Transaction
  cryptoAsset?: { icon?: string; symbol: string }
}) {
  const tile = getTransactionTypeIconStyle(tx.type, tx.amount)

  if (cryptoAsset) {
    return (
      <AssetLogo
        src={cryptoAsset.icon}
        alt={`${cryptoAsset.symbol} logo`}
        fallback={cryptoAsset.symbol.slice(0, 1)}
        className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border ${tile}`}
        imgClassName="h-5 w-5 object-contain"
        textClassName="text-[15px] font-bold"
      />
    )
  }

  return (
    <div className={`flex h-10 w-10 items-center justify-center rounded-xl border text-[16px] ${tile}`}>
      {'icon' in tx && typeof tx.icon === 'string' ? tx.icon : '•'}
    </div>
  )
}
