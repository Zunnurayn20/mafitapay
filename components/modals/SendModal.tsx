'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { useBankDirectory } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { formatNGN, sleep } from '@/lib/utils'
import type { Beneficiary } from '@/types'

type Step = 'form' | 'review' | 'pin' | 'processing' | 'success'

const QUICK = [5000, 10000, 50000]

export function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshSession, showToast } = useAppStore()
  const banks = useBankDirectory('NG')
  const [step, setStep] = useState<Step>('form')
  const [mode, setMode] = useState<'internal' | 'bank'>('internal')
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [recipient, setRecipient] = useState('')
  const [resolvedRecipient, setResolvedRecipient] = useState<{ name: string; handle: string } | null>(null)
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([])
  const [amount, setAmount]       = useState('')
  const [narration, setNarration] = useState('')
  const [ref, setRef]             = useState('')
  const [procStep, setProcStep]   = useState(0)
  const [pinVersion, setPinVersion] = useState(0)

  const amt = parseFloat(amount) || 0

  useEffect(() => {
    if (!open) return

    void fetch('/api/beneficiaries', { credentials: 'include', cache: 'no-store' })
      .then(response => response.json())
      .then(payload => {
        if (!Array.isArray(payload.data)) return
        setBeneficiaries(payload.data)
        const bankDefault = payload.data.find((item: Beneficiary) => item.kind === 'bank' && item.isDefault)
        const internalDefault = payload.data.find((item: Beneficiary) => item.kind === 'internal' && item.isDefault)

        if (internalDefault) {
          setMode('internal')
          setRecipient(internalDefault.handle || internalDefault.label)
          setResolvedRecipient(internalDefault.handle ? { name: internalDefault.label, handle: internalDefault.handle } : null)
        } else if (bankDefault) {
          setMode('bank')
          setBankCode(bankDefault.bankCode || '')
          setBankName(bankDefault.bankName || '')
          setAccountNumber(bankDefault.accountNumber || '')
          setAccountName(bankDefault.accountName || '')
        }
      })
      .catch(() => undefined)
  }, [open])

  function handleClose() {
    onClose()
    setTimeout(() => {
      setStep('form')
      setMode('internal')
      setAmount('')
      setBankCode('')
      setBankName('')
      setAccountNumber('')
      setAccountName('')
      setRecipient('')
      setResolvedRecipient(null)
      setNarration('')
      setProcStep(0)
      setPinVersion(0)
    }, 400)
  }

  async function goReview() {
    if (!amt) { showToast('Fill in all required fields', 'error'); return }

    if (mode === 'internal') {
      if (!recipient) { showToast('Recipient is required', 'error'); return }
      try {
        const response = await fetch('/api/beneficiaries/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ kind: 'internal', recipient }),
        })
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Recipient verification failed.')
        }
        setResolvedRecipient(payload.data.recipient)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Recipient verification failed.', 'error')
        return
      }
    } else {
      if (!bankCode || !bankName || !accountNumber) { showToast('Fill in all required fields', 'error'); return }
      try {
        const response = await fetch('/api/beneficiaries/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ kind: 'bank', bankCode, bankName, accountNumber, accountName }),
        })
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Beneficiary verification failed.')
        }
        setBankCode(payload.data.verification.bankCode)
        setBankName(payload.data.verification.bankName)
        setAccountNumber(payload.data.verification.accountNumber)
        setAccountName(payload.data.verification.accountName)
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Beneficiary verification failed.', 'error')
        return
      }
    }

    setStep('review')
  }

  async function handlePin() {
    setStep('processing')
    setProcStep(1)
    await sleep(1200)
    setProcStep(2)
    await sleep(1200)
    try {
      const response = await fetch('/api/wallet/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(mode === 'internal'
          ? { mode, recipient, amount: amt, narration }
          : { mode, bankCode, bankName, accountNumber, accountName, amount: amt, narration }),
      })
      const payload = await response.json()

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Transfer failed.')
      }

      setProcStep(3)
      await sleep(400)
      setRef(payload.data.transaction.reference)
      await refreshSession()
      setStep('success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Transfer failed.', 'error')
      setPinVersion(current => current + 1)
      setStep('pin')
    }
  }

  const titles: Record<Step, string> = {
    form: 'Bank Transfer', review: 'Review Transfer', pin: 'Enter PIN',
    processing: 'Processing…', success: 'Transfer Submitted'
  }

  return (
    <Modal open={open} onClose={handleClose} title={titles[step]} size="md">
      {step === 'form' && (
        <div className="p-6 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(['internal', 'bank'] as const).map(option => (
              <button
                key={option}
                onClick={() => setMode(option)}
                className={`border px-3 py-2 text-[10px] font-bold uppercase ${mode === option ? 'border-[var(--gold)] bg-[rgba(79,70,229,.08)] text-[var(--gold2)]' : 'border-[var(--border)] bg-[var(--clay)] text-[var(--text2)]'}`}
              >
                {option === 'internal' ? 'Internal Transfer' : 'Bank Transfer'}
              </button>
            ))}
          </div>
          {mode === 'internal' ? (
            <>
              <Input label="Recipient Email or Handle" placeholder="@aminupay or aminu@mafitapay.ng"
                value={recipient} onChange={e => setRecipient(e.target.value)} />
              {beneficiaries.filter(item => item.kind === 'internal').length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {beneficiaries.filter(item => item.kind === 'internal').slice(0, 4).map(item => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setRecipient(item.handle || item.label)
                        setResolvedRecipient(item.handle ? { name: item.label, handle: item.handle } : null)
                      }}
                      className="border border-[var(--border)] bg-[var(--clay)] px-3 py-1.5 text-[10px] text-[var(--text2)]"
                    >
                      {item.handle || item.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Bank</div>
                <select
                  value={bankCode}
                  onChange={event => {
                    const nextCode = event.target.value
                    const bank = banks.find(item => item.code === nextCode)
                    setBankCode(nextCode)
                    setBankName(bank?.name || '')
                    setAccountName('')
                  }}
                  className="w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-3 text-[12px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
                >
                  <option value="">Select bank</option>
                  {banks.map(item => (
                    <option key={item.code} value={item.code}>{item.name}</option>
                  ))}
                </select>
              </div>
              <Input label="Account Number" placeholder="0123456789"
                value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
              <Input label="Resolved Account Name" placeholder="Verify bank details to resolve name"
                value={accountName} readOnly />
              {beneficiaries.filter(item => item.kind === 'bank').length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {beneficiaries.filter(item => item.kind === 'bank').slice(0, 4).map(item => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setBankCode(item.bankCode || '')
                        setBankName(item.bankName || '')
                        setAccountNumber(item.accountNumber || '')
                        setAccountName(item.accountName || '')
                      }}
                      className="border border-[var(--border)] bg-[var(--clay)] px-3 py-1.5 text-[10px] text-[var(--text2)]"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div>
            <Input label="Amount (NGN)" prefix="₦" type="number" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)}
              className="text-lg font-bold font-display" />
            <div className="text-[10px] text-[var(--muted)] mt-1.5 font-mono">≈ ${(amt/1620).toFixed(2)} USD</div>
            <div className="flex gap-1.5 mt-2">
              {QUICK.map(q => (
                <button key={q} onClick={() => setAmount(String(q))}
                  className="flex-1 py-1.5 bg-[var(--clay2)] border border-[var(--border)] text-[var(--text2)] text-[10px] font-bold cursor-pointer hover:border-[var(--gold2)] transition-all">
                  ₦{q >= 1000 ? q/1000+'k' : q}
                </button>
              ))}
              <button onClick={() => setAmount('147500')}
                className="flex-1 py-1.5 bg-[rgba(79,70,229,.15)] border border-[rgba(79,70,229,.35)] text-[var(--gold2)] text-[10px] font-bold cursor-pointer">
                MAX
              </button>
            </div>
          </div>
          <Input label="Narration (optional)" placeholder="What's this for?" value={narration} onChange={e => setNarration(e.target.value)} />
          <div className="bg-[var(--clay)] border border-[var(--border)] p-3 text-[11px]">
            <div className="flex justify-between py-1"><span className="text-[var(--muted)]">Transfer fee</span><span className="text-[var(--green2)] font-bold">FREE</span></div>
            <div className="flex justify-between py-1"><span className="text-[var(--muted)]">Delivery</span><span className="text-[var(--gold2)] font-bold">{mode === 'internal' ? 'Instant' : 'Pending settlement'}</span></div>
          </div>
          <Button onClick={() => void goReview()} className="w-full py-3.5">{mode === 'internal' ? 'Review Internal Transfer →' : 'Review Bank Transfer →'}</Button>
        </div>
      )}

      {step === 'review' && (
        <div className="p-6 flex flex-col gap-4">
          <div className="bg-[var(--clay)] border border-[var(--border)] p-6 text-center">
            <div className="text-[9px] text-[var(--muted)] uppercase tracking-[1px] mb-2">Sending to</div>
            <div className="text-[15px] font-bold text-[var(--gold2)] font-mono mb-1">{mode === 'internal' ? (resolvedRecipient?.name || recipient) : accountName}</div>
            <div className="text-[10px] text-[var(--muted)] mb-3">{mode === 'internal' ? (resolvedRecipient?.handle || recipient) : `${bankName} · ${accountNumber}`}</div>
            <div className="font-display font-black text-[42px] text-[var(--text)]">₦{amt.toLocaleString()}</div>
          </div>
          <div className="border border-[var(--border)]">
            {[
              ['Amount', formatNGN(amt)],
              ...(mode === 'internal'
                ? [['Recipient', resolvedRecipient?.name || recipient], ['Handle', resolvedRecipient?.handle || recipient]]
                : [['Bank', `${bankName} (${bankCode})`], ['Account Number', accountNumber], ['Account Name', accountName]]),
              ['Narration', narration || 'None'],
              ['Fee', 'FREE'],
              ['Total', formatNGN(amt)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between px-4 py-3 border-b border-[var(--border)] last:border-0 text-[12px]">
                <span className="text-[var(--muted)]">{k}</span>
                <span className={`font-mono font-bold ${k === 'Fee' ? 'text-[var(--green2)]' : 'text-[var(--text)]'}`}>{v}</span>
              </div>
            ))}
          </div>
          <div className="bg-[rgba(79,70,229,.06)] border border-[rgba(79,70,229,.2)] border-l-4 border-l-[var(--gold)] px-4 py-3 text-[11px] text-[var(--text2)]">
            🔐 You&apos;ll enter your <strong>4-digit PIN</strong> to authorise this {mode === 'internal' ? 'internal transfer.' : 'bank transfer. Funds remain locked until payout settlement.'}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('form')} className="flex-none px-5">← Edit</Button>
            <Button onClick={() => { setPinVersion(current => current + 1); setStep('pin') }} className="flex-1">Enter PIN →</Button>
          </div>
        </div>
      )}

      {step === 'pin' && (
        <PinPad
          key={pinVersion}
          onComplete={handlePin}
          title="Confirm Transaction PIN"
          subtitle={`Authorising ${formatNGN(amt)} → ${mode === 'internal' ? (resolvedRecipient?.name || recipient) : accountName}`}
        />
      )}

      {step === 'processing' && (
        <div className="p-10 text-center">
          <div className="spinner mx-auto mb-5" />
          <div className="font-display font-bold text-[18px] text-[var(--text)] mb-1.5">Submitting…</div>
          <div className="text-[11px] text-[var(--muted)]">{mode === 'internal' ? 'Processing internal transfer' : 'Creating your payout request'}</div>
          <div className="mt-6 border border-[var(--border)]">
            {[
              { label: 'PIN verified', done: procStep >= 1 },
              { label: mode === 'internal' ? 'Debiting sender' : 'Locking funds', done: procStep >= 2, active: procStep === 1 },
              { label: mode === 'internal' ? 'Crediting recipient' : 'Queueing bank payout', done: procStep >= 3, active: procStep === 2 },
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${
                  s.done ? 'bg-[rgba(46,170,92,.15)] border border-[rgba(46,170,92,.35)] text-[var(--green2)]'
                  : s.active ? 'bg-[rgba(79,70,229,.15)] border border-[rgba(79,70,229,.35)] animate-pulse-dot'
                  : 'bg-[var(--clay2)] border border-[var(--border)]'
                }`}>{s.done ? '✓' : ''}</div>
                <span className={`text-[12px] ${s.done || s.active ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="p-9 text-center flex flex-col items-center gap-4">
          <div className="w-18 h-18 rounded-full bg-[rgba(46,170,92,.12)] border-2 border-[rgba(46,170,92,.3)] flex items-center justify-center text-[28px] animate-pop w-[72px] h-[72px]">✅</div>
          <div className="font-display font-black text-[26px] text-[var(--text)]">{mode === 'internal' ? 'Sent!' : 'Submitted!'}</div>
          <div className="text-[13px] text-[var(--text2)]">{formatNGN(amt)} {mode === 'internal' ? 'sent to' : 'queued for'} <span className="text-[var(--gold2)]">{mode === 'internal' ? (resolvedRecipient?.name || recipient) : accountName}</span></div>
          <div className="bg-[var(--clay)] border border-[var(--border)] p-3 w-full text-left">
            <div className="text-[8px] text-[var(--muted)] uppercase tracking-[1px] mb-1">Transaction Reference</div>
            <div className="text-[11px] text-[var(--gold2)] font-mono">{ref}</div>
          </div>
          <div className="flex gap-2 w-full">
            <Button variant="secondary" onClick={handleClose} className="flex-1 py-3">Done</Button>
            <Button onClick={() => { setStep('form'); setAmount(''); setBankName(''); setAccountNumber(''); setAccountName(''); setRecipient(''); setResolvedRecipient(null); setNarration('') }} className="flex-1 py-3">Send Again</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
