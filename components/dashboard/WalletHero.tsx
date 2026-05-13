'use client'
import { useState } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatNGN } from '@/lib/utils'

export function WalletHero() {
  const { wallet, transactions, openModal, showToast } = useAppStore()
  const [visible, setVisible] = useState(true)
  const account = wallet?.virtualAccounts.find(item => (item.provider === 'flutterwave' || item.provider === 'cngn') && item.isPermanent)
  const availableBalance = wallet?.balance ?? 0
  const reserveBalance = wallet?.reserveBalance ?? 0
  const reserveLockedBalance = wallet?.reserveLockedBalance ?? 0
  const pendingTransactions = transactions.filter(item => item.status === 'pending' || item.status === 'processing').length
  const totalReserved = reserveBalance + reserveLockedBalance

  async function copyFundingAccount() {
    if (!account?.accountNumber) return
    await navigator.clipboard?.writeText(account.accountNumber)
    showToast('Funding account copied.')
  }

  return (
    <Card
      className="p-5 sm:p-6 lg:p-7"
      accent="repeating-linear-gradient(90deg,var(--gold) 0,var(--gold) 10px,var(--terra) 10px,var(--terra) 18px,var(--green) 18px,var(--green) 26px,var(--char) 26px,var(--char) 30px)"
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="mb-2 text-[8px] font-bold uppercase tracking-[1.5px] text-[var(--muted)]">NGN Balance</div>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <span className="font-display text-[20px] font-black text-[var(--gold2)]">₦</span>
            <span className={`font-display text-[clamp(2.5rem,7vw,3.75rem)] font-black leading-none text-[var(--text)] transition-all ${!visible ? 'blur-sm select-none' : ''}`}>
              {wallet ? Math.floor(availableBalance).toLocaleString() : '—'}
            </span>
            <button onClick={() => setVisible(v => !v)} className="pb-1 text-[18px] text-[var(--muted)] transition-colors hover:text-[var(--text2)]">
              {visible ? '👁' : '🙈'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {totalReserved > 0 && (
              <span className="border border-[rgba(99,102,241,.25)] bg-[rgba(79,70,229,.1)] px-3 py-1 text-[10px] font-bold text-[var(--text2)] font-mono">
                Reserve: {formatNGN(totalReserved)}
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 xl:max-w-sm xl:items-end">
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <Button variant="green" size="sm" onClick={() => openModal('deposit')}>⬇ Deposit</Button>
            <Button size="sm" onClick={() => openModal('send')}>↗ Send</Button>
            <Button variant="secondary" size="sm" onClick={() => openModal('withdraw')}>⬆ Withdraw</Button>
          </div>

          <div className="min-w-0 border border-[var(--border)] bg-[var(--clay)] px-3 py-3 xl:hidden">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Funding Account</div>
                <div className="mt-1 font-mono text-[13px] font-bold tracking-[1.4px] text-[var(--text2)] sm:text-[14px]">
                  {account ? account.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim() : '—'}
                </div>
                <div className="truncate text-[8px] text-[var(--muted)] sm:text-[9px]">
                  {account?.bank || 'Permanent funding account not available yet.'}
                </div>
              </div>
              <button
                onClick={() => void copyFundingAccount()}
                disabled={!account?.accountNumber}
                className="flex-shrink-0 border border-[rgba(99,102,241,.3)] bg-[rgba(79,70,229,.12)] px-2.5 py-1 text-[8px] font-bold tracking-[1px] text-[var(--gold2)] transition-all hover:bg-[rgba(79,70,229,.25)]"
              >
                COPY
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 hidden xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center xl:gap-3 xl:border xl:border-[var(--border)] xl:bg-[var(--clay)] xl:px-4 xl:py-4">
        <div className="min-w-0">
          <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Permanent Funding Account</div>
          <div className="mt-1 font-mono text-[15px] font-bold tracking-[2px] text-[var(--text2)]">
            {account ? account.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim() : '—'}
          </div>
          <div className="truncate text-[9px] text-[var(--muted)]">{account?.accountName || 'Generate a deposit account to fund your wallet with NGN'}</div>
          <div className="mt-1 text-[9px] text-[var(--muted)]">
            {account ? account.bank : 'Permanent funding account not available yet.'}
          </div>
        </div>
        <button
          onClick={() => void copyFundingAccount()}
          disabled={!account?.accountNumber}
          className="justify-self-start border border-[rgba(99,102,241,.3)] bg-[rgba(79,70,229,.12)] px-3 py-1.5 text-[9px] font-bold tracking-wider text-[var(--gold2)] transition-all hover:bg-[rgba(79,70,229,.25)] xl:justify-self-end"
        >
          COPY
        </button>
      </div>
    </Card>
  )
}
