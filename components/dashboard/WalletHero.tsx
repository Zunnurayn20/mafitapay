'use client'
import { useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatNGN } from '@/lib/utils'
import type { Wallet } from '@/types'

export function WalletHero() {
  const { wallet, transactions, openModal, showToast } = useAppStore()
  const [visible, setVisible] = useState(true)
  const [copied, setCopied] = useState(false)
  const [activeAccountIndex, setActiveAccountIndex] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const accounts = (wallet?.virtualAccounts ?? []).filter(item => item.isPermanent)
  const account = accounts[activeAccountIndex] ?? accounts[0] ?? null
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

  function selectAccount(index: number) {
    setActiveAccountIndex(index)
    setCopied(false)
  }

  function moveAccount(direction: 'prev' | 'next') {
    if (accounts.length < 2) return
    setCopied(false)
    setActiveAccountIndex(current => {
      if (direction === 'prev') {
        return current === 0 ? accounts.length - 1 : current - 1
      }
      return current === accounts.length - 1 ? 0 : current + 1
    })
  }

  function handleTouchStart(clientX: number) {
    touchStartX.current = clientX
  }

  function handleTouchEnd(clientX: number) {
    if (touchStartX.current === null) return
    const delta = clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) < 36) return
    moveAccount(delta > 0 ? 'prev' : 'next')
  }

  function renderAccountLabel(item: Wallet['virtualAccounts'][number]) {
    if (item.provider === 'palmpay') return 'PalmPay'
    if (item.provider === 'flutterwave') return 'Flutterwave'
    return item.bank
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
      <div className="relative z-[1] grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="mb-1.5 text-[8px] font-bold uppercase tracking-[1.5px] text-[rgba(233,214,186,0.56)]">NGN Balance</div>
          <div className="mb-2 flex flex-wrap items-end gap-2">
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

        <div className="flex min-w-0 flex-col gap-2 xl:max-w-sm xl:items-end">
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <Button variant="green" size="sm" onClick={() => openModal('deposit')}>⬇ Deposit</Button>
            <Button size="sm" onClick={() => openModal('send')}>↗ Send</Button>
            <Button variant="secondary" size="sm" onClick={() => openModal('withdraw')}>⬆ Withdraw</Button>
          </div>

          <div className="xl:hidden">
            <div className="mb-1 flex items-center justify-between px-1">
              <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Funding Accounts</div>
            </div>
            <div className="overflow-hidden">
              <div
                className="flex transition-transform duration-300 ease-out"
                style={{ transform: `translateX(-${activeAccountIndex * 100}%)` }}
                onTouchStart={event => handleTouchStart(event.touches[0]?.clientX ?? 0)}
                onTouchEnd={event => handleTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
              >
                {(accounts.length ? accounts : [null]).map((item, index) => (
                  <div key={item ? `${item.provider}-${item.accountNumber}-${index}` : 'empty-mobile'} className="min-w-full pr-0.5">
                    <div
                      className={`min-w-0 border px-3 py-2.5 text-left transition-all ${
                        copied && index === activeAccountIndex
                          ? 'border-[rgba(46,170,92,0.38)] bg-[rgba(46,170,92,0.14)] shadow-[0_0_0_1px_rgba(46,170,92,0.18)]'
                          : 'border-[rgba(224,196,138,0.2)] bg-[rgba(33,23,15,0.62)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[8px] text-[rgba(233,214,186,0.62)] sm:text-[9px]">
                            {item ? `${item.bank} • ${item.accountName}` : 'Funding account not available yet.'}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (index !== activeAccountIndex) selectAccount(index)
                          void copyFundingAccount()
                        }}
                        disabled={!item?.accountNumber}
                        className="mt-3 flex w-full items-center justify-between gap-3 border-y border-dashed border-[rgba(224,196,138,0.22)] py-2.5 text-left transition-colors hover:bg-[rgba(224,196,138,0.04)]"
                      >
                        <div className="font-mono text-[13px] font-bold tracking-[1.4px] text-[rgba(244,231,208,0.9)] sm:text-[14px]">
                          {item ? item.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim() : '—'}
                        </div>
                        <span className={`inline-flex h-7 w-7 items-center justify-center border transition-all ${
                          copied && index === activeAccountIndex
                            ? 'border-[rgba(46,170,92,0.32)] bg-[rgba(46,170,92,0.12)] text-[var(--green2)]'
                            : 'border-[rgba(224,196,138,0.22)] bg-[rgba(224,196,138,0.08)] text-[var(--gold2)]'
                        } ${!item?.accountNumber ? 'opacity-80' : ''}`}>
                          <Copy size={13} />
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {accounts.length > 1 ? (
              <div className="mt-2 flex items-center justify-center gap-1.5 px-1">
                <div className="flex items-center gap-1.5">
                  {accounts.map((item, index) => (
                    <button
                      key={`${item.provider}-${item.accountNumber}-dot-${index}`}
                      type="button"
                      onClick={() => selectAccount(index)}
                      className={`h-1.5 transition-all ${index === activeAccountIndex ? 'w-6 bg-[var(--gold2)]' : 'w-1.5 bg-[rgba(233,214,186,0.32)]'}`}
                      aria-label={`Show ${renderAccountLabel(item)} funding account`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="relative z-[1] mt-4 hidden xl:block">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Funding Accounts</div>
          <div className="text-[9px] text-[rgba(233,214,186,0.62)]">All available wallet funding routes</div>
        </div>
        <div className={`grid gap-3 ${accounts.length > 1 ? 'xl:grid-cols-2' : 'xl:grid-cols-1'}`}>
          {(accounts.length ? accounts : [null]).map((item, index) => (
            <div
              key={item ? `${item.provider}-${item.accountNumber}-desktop-${index}` : 'empty-desktop'}
              className={`overflow-hidden border px-4 py-3 text-left transition-all ${
                copied && index === activeAccountIndex
                  ? 'border-[rgba(46,170,92,0.38)] bg-[rgba(46,170,92,0.14)] shadow-[0_0_0_1px_rgba(46,170,92,0.18)]'
                  : 'border-[rgba(224,196,138,0.2)] bg-[rgba(33,23,15,0.62)]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-[9px] text-[rgba(244,231,208,0.88)]">
                    {item?.accountName || 'Generate a deposit account to fund your wallet with NGN'}
                  </div>
                  <div className="mt-1 text-[9px] text-[rgba(233,214,186,0.62)]">
                    {item ? item.bank : 'Funding account not available yet.'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (item && index !== activeAccountIndex) selectAccount(index)
                  void copyFundingAccount()
                }}
                disabled={!item?.accountNumber}
                className="mt-3 flex w-full items-center justify-between gap-3 border-y border-dashed border-[rgba(224,196,138,0.22)] py-3 text-left transition-colors hover:bg-[rgba(224,196,138,0.04)]"
              >
                <div className="font-mono text-[15px] font-bold tracking-[2px] text-[rgba(244,231,208,0.9)]">
                  {item ? item.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim() : '—'}
                </div>
                <span className={`inline-flex h-8 w-8 items-center justify-center border transition-all ${
                  copied && index === activeAccountIndex
                    ? 'border-[rgba(46,170,92,0.32)] bg-[rgba(46,170,92,0.12)] text-[var(--green2)]'
                    : 'border-[rgba(224,196,138,0.22)] bg-[rgba(224,196,138,0.08)] text-[var(--gold2)]'
                } ${!item?.accountNumber ? 'opacity-80' : ''}`}>
                  <Copy size={14} />
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
