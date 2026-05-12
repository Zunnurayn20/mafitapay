'use client'
import { useState, useEffect, useRef } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store'
import { P2PMerchant } from '@/types'

export function P2PModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { modalData, openModal, refreshSession, setModalData, closeModal: storeClose, showToast } = useAppStore()
  const merchant = modalData.merchant as P2PMerchant | undefined
  const [amount, setAmount] = useState('')
  const [timeLeft, setTimeLeft] = useState(30 * 60)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    if (open) {
      setTimeLeft(30 * 60)
      timerRef.current = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000)
    } else {
      if(timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if(timerRef.current) clearInterval(timerRef.current) }
  }, [open])

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0')
  const secs = String(timeLeft % 60).padStart(2, '0')

  async function confirm() {
    const amt = parseFloat(amount) || 0
    if (!amt) {
      showToast('Enter a valid amount', 'error')
      return
    }

    try {
      const response = await fetch('/api/p2p', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'deposit', amount: amt, merchantId: merchant?.id }),
      })
      const payload = await response.json()

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'P2P deposit failed.')
      }

      await refreshSession()
      storeClose()
      setAmount('')
      setTimeout(() => {
        setModalData({
          headline: 'Deposit Completed',
          body: `₦${amt.toLocaleString()} deposit from ${merchant?.name} has been credited to your wallet.`,
          ref: payload.data.transaction.reference,
        })
        openModal('success')
      }, 100)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'P2P deposit failed.', 'error')
    }
  }

  if (!merchant) return null

  return (
    <Modal open={open} onClose={onClose} title={merchant.name} subtitle={`${merchant.completionRate}% completion · ${merchant.totalTrades} trades`} size="md">
      <div className="p-6 flex flex-col gap-4">
        <div className="bg-[var(--clay)] border border-[var(--border)] border-l-4 border-l-[var(--green)] p-4">
          <div className="text-[9px] font-bold text-[var(--green2)] uppercase tracking-wider mb-1">How to Complete</div>
          <div className="text-[11px] text-[var(--text2)] leading-[1.7]">Enter amount → Copy the merchant&apos;s account → Transfer from your bank → Tap &quot;I&apos;ve Sent It&quot;.</div>
        </div>
        <Input label="Amount to Deposit (NGN)" prefix="₦" type="number" placeholder="0.00"
          value={amount} onChange={e => setAmount(e.target.value)} className="text-lg font-bold font-display" />
        <div className="bg-[var(--clay2)] border border-[var(--border)] p-4">
          <div className="text-[8px] font-bold text-[var(--gold2)] uppercase tracking-[1px] mb-3">Merchant Bank Account</div>
          <div className="text-[12px] text-[var(--muted)] mb-1">{merchant.bank} · {merchant.accountNumber}</div>
          <div className="text-[16px] font-bold font-mono text-[var(--text)] tracking-[2px] mb-1">{merchant.accountNumber}</div>
          <div className="text-[10px] text-[var(--muted)] mb-3">{merchant.accountName}</div>
          <Button variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(merchant.accountNumber)}>Copy Account</Button>
        </div>
        <div className="flex items-center justify-between bg-[var(--clay)] border border-[var(--border)] px-4 py-3">
          <div className="text-[10px] text-[var(--muted)]">Order expires in</div>
          <div className={`text-[14px] font-bold font-mono ${timeLeft < 300 ? 'text-[var(--red2)]' : 'text-[var(--terra2)]'}`}>{mins}:{secs}</div>
        </div>
          <Button variant="green" onClick={confirm} className="w-full py-3.5">I&apos;ve Sent the Money ✓</Button>
      </div>
    </Modal>
  )
}
