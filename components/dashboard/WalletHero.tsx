'use client'
import { useState } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatNGN } from '@/lib/utils'

export function WalletHero() {
  const { wallet, transactions, openModal, showToast } = useAppStore()
  const [visible, setVisible] = useState(true)
  const [copied, setCopied] = useState(false)
  const account = wallet?.virtualAccounts.find(item => item.provider === 'flutterwave' && item.isPermanent)
  const availableBalance = wallet?.balance ?? 0
  const reserveBalance = wallet?.reserveBalance ?? 0
  const reserveLockedBalance = wallet?.reserveLockedBalance ?? 0
  const pendingTransactions = transactions.filter(item => item.status === 'pending' || item.status === 'processing').length
  const totalReserved = reserveBalance + reserveLockedBalance

  async function copyFundingAccount() {
    if (!account?.accountNumber) return
    await navigator.clipboard?.writeText(account.accountNumber)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
    showToast('Funding account copied.')
  }

  return (
    <Card
      className="overflow-hidden border-[rgba(202,165,96,0.28)] bg-[linear-gradient(180deg,rgba(66,46,28,0.96)_0%,rgba(45,31,19,0.98)_100%)] p-5 sm:p-6 lg:p-7"
      accent="repeating-linear-gradient(90deg,var(--gold) 0,var(--gold) 10px,var(--terra) 10px,var(--terra) 18px,var(--green) 18px,var(--green) 26px,var(--char) 26px,var(--char) 30px)"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: `
            radial-gradient(circle at 18px 18px, rgba(224,196,138,0.26) 0 2px, transparent 2px),
            linear-gradient(135deg, transparent 0 40%, rgba(202,165,96,0.22) 40% 44%, transparent 44% 56%, rgba(202,165,96,0.22) 56% 60%, transparent 60% 100%),
            linear-gradient(45deg, transparent 0 40%, rgba(140,107,49,0.18) 40% 44%, transparent 44% 56%, rgba(140,107,49,0.18) 56% 60%, transparent 60% 100%)
          `,
          backgroundSize: '28px 28px, 72px 72px, 72px 72px',
          backgroundPosition: '0 0, 0 0, 36px 36px',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-[-1rem] w-32 bg-center bg-no-repeat opacity-[0.12] sm:w-40"
        style={{ backgroundImage: "url('/mafitapay-logo.png')", backgroundSize: 'contain' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-[0.22]"
        style={{ background: 'linear-gradient(180deg, transparent 0%, rgba(202,165,96,0.12) 100%)' }}
      />
      <div className="relative z-[1] grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="mb-2 text-[8px] font-bold uppercase tracking-[1.5px] text-[rgba(233,214,186,0.56)]">NGN Balance</div>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <span className="font-display text-[20px] font-black text-[var(--gold2)]">₦</span>
            <span className={`font-display text-[clamp(2.5rem,7vw,3.75rem)] font-black leading-none text-[rgba(248,238,220,0.96)] transition-all ${!visible ? 'blur-sm select-none' : ''}`}>
              {wallet
                ? availableBalance.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '—'}
            </span>
            <button onClick={() => setVisible(v => !v)} className="pb-1 text-[18px] text-[rgba(233,214,186,0.58)] transition-colors hover:text-[rgba(244,231,208,0.88)]">
              {visible ? '👁' : '🙈'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {totalReserved > 0 && (
              <span className="border border-[rgba(224,196,138,0.2)] bg-[rgba(224,196,138,0.08)] px-3 py-1 text-[10px] font-bold text-[rgba(244,231,208,0.86)] font-mono">
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

          <button
            type="button"
            onClick={() => void copyFundingAccount()}
            disabled={!account?.accountNumber}
            className={`min-w-0 border px-3 py-3 text-left transition-all xl:hidden ${
              copied
                ? 'border-[rgba(46,170,92,0.38)] bg-[rgba(46,170,92,0.14)] shadow-[0_0_0_1px_rgba(46,170,92,0.18)]'
                : 'border-[rgba(224,196,138,0.2)] bg-[rgba(33,23,15,0.62)] hover:bg-[rgba(46,170,92,0.08)]'
            } ${!account?.accountNumber ? 'cursor-default opacity-80' : 'cursor-pointer'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Funding Account</div>
                <div className="mt-1 font-mono text-[13px] font-bold tracking-[1.4px] text-[rgba(244,231,208,0.9)] sm:text-[14px]">
                  {account ? account.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim() : '—'}
                </div>
                <div className="truncate text-[8px] text-[rgba(233,214,186,0.62)] sm:text-[9px]">
                  {account?.bank || 'Permanent funding account not available yet.'}
                </div>
              </div>
              <span
                className={`flex-shrink-0 border px-2.5 py-1 text-[8px] font-bold tracking-[1px] transition-all ${
                  copied
                    ? 'border-[rgba(46,170,92,0.32)] bg-[rgba(46,170,92,0.12)] text-[var(--green2)]'
                    : 'border-[rgba(224,196,138,0.22)] bg-[rgba(224,196,138,0.08)] text-[var(--gold2)]'
                }`}
              >
                {copied ? 'COPIED' : 'COPY'}
              </span>
            </div>
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void copyFundingAccount()}
        disabled={!account?.accountNumber}
        className={`relative z-[1] mt-6 hidden overflow-hidden border text-left transition-all xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center xl:gap-3 xl:px-4 xl:py-4 ${
          copied
            ? 'border-[rgba(46,170,92,0.38)] bg-[rgba(46,170,92,0.14)] shadow-[0_0_0_1px_rgba(46,170,92,0.18)]'
            : 'border-[rgba(224,196,138,0.2)] bg-[rgba(33,23,15,0.62)] hover:bg-[rgba(46,170,92,0.08)]'
        } ${!account?.accountNumber ? 'xl:cursor-default xl:opacity-80' : 'xl:cursor-pointer'}`}
      >
        <div className="min-w-0">
          <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Permanent Funding Account</div>
          <div className="mt-1 font-mono text-[15px] font-bold tracking-[2px] text-[rgba(244,231,208,0.9)]">
            {account ? account.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim() : '—'}
          </div>
          <div className="truncate text-[9px] text-[rgba(244,231,208,0.88)]">{account?.accountName || 'Generate a deposit account to fund your wallet with NGN'}</div>
          <div className="mt-1 text-[9px] text-[rgba(233,214,186,0.62)]">
            {account ? account.bank : 'Permanent funding account not available yet.'}
          </div>
        </div>
        <span
          className={`justify-self-start border px-3 py-1.5 text-[9px] font-bold tracking-wider transition-all xl:justify-self-end ${
            copied
              ? 'border-[rgba(46,170,92,0.32)] bg-[rgba(46,170,92,0.12)] text-[var(--green2)]'
              : 'border-[rgba(224,196,138,0.22)] bg-[rgba(224,196,138,0.08)] text-[var(--gold2)]'
          }`}
        >
          {copied ? 'COPIED' : 'COPY'}
        </span>
      </button>
    </Card>
  )
}
