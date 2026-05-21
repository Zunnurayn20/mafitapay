'use client'

import { Badge } from '@/components/ui/Badge'
import { fmtDate, formatNGN } from '@/lib/utils'
import type { Transaction } from '@/types'

export function TransactionReceiptSheet({
  id,
  transaction,
  title,
}: {
  id: string
  transaction: Transaction
  title: string
}) {
  return (
    <div
      id={id}
      className="relative mt-3 overflow-hidden border border-[rgba(202,165,96,.26)] bg-[linear-gradient(180deg,#fcf7ec_0%,#f6efdd_100%)] p-5 text-[#2c2418] shadow-[0_18px_40px_rgba(0,0,0,.18)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-[-2.5rem] w-40 bg-center bg-no-repeat opacity-[0.07]"
        style={{ backgroundImage: "url('/mafitapay-logo.jpg')", backgroundSize: 'contain' }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(90deg,rgba(202,165,96,.55)_0_16px,transparent_16px_24px)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[2px] text-[#8c6b31]">MafitaPay Receipt</div>
            <div className="mt-2 text-[18px] font-bold text-[#1f1a12]">
              {title}
            </div>
            <div className="mt-1 text-[11px] font-mono text-[#7c6a4b]">{transaction.reference}</div>
          </div>
          <div className="rounded-full border border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.7)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[1px] text-[#8c6b31]">
            Official Copy
          </div>
        </div>

        <div className="mt-5 border-y border-dashed border-[rgba(140,107,49,.3)] py-4">
          <div className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#8c6b31]">Amount</div>
          <div className={`mt-1 text-[28px] font-black tracking-[-0.02em] ${transaction.amount > 0 ? 'text-[#227a45]' : 'text-[#1f1a12]'}`}>
            {transaction.amount > 0 ? '+' : ''}{formatNGN(transaction.amount)}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-3">
            <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Recorded</div>
            <div className="mt-1 text-[11px] font-mono text-[#3a3123]">{fmtDate(transaction.createdAt)}</div>
          </div>
          <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-3">
            <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Status</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="pending">{transaction.type.replace(/_/g, ' ')}</Badge>
              <Badge variant={transaction.status === 'success' ? 'success' : transaction.status === 'failed' ? 'failed' : 'pending'}>
                {transaction.status}
              </Badge>
            </div>
          </div>
        </div>

        {(transaction.recipient || transaction.narration) && (
          <div className="mt-4 grid gap-3">
            {transaction.recipient && (
              <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-3">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Recipient</div>
                <div className="mt-1 text-[11px] text-[#3a3123]">{transaction.recipient}</div>
              </div>
            )}
            {transaction.narration && (
              <div className="border border-[rgba(140,107,49,.2)] bg-[rgba(255,255,255,.55)] p-3">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Narration</div>
                <div className="mt-1 text-[11px] text-[#3a3123]">{transaction.narration}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
