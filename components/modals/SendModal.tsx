'use client'
import { BankAccountPicker } from '@/components/ui/BankAccountPicker'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { createBiometricApproval } from '@/lib/client/biometric'
import { useNativeTransactionBiometric } from '@/hooks/useNativeTransactionBiometric'
import { useBankDirectory } from '@/lib/client/catalogs'
import { parseJsonBody, readJsonResponse, toUserMessage } from '@/lib/client/http'
import { useAppStore } from '@/store'
import { quoteTransferFee } from '@/lib/transfer-fees'
import { formatNGN } from '@/lib/utils'
import { savePendingConfirmation } from '@/lib/client/transaction-confirmation'
import type { Beneficiary } from '@/types'

type Step = 'form' | 'pin' | 'processing' | 'success'

const QUICK = [5000, 10000, 50000]

export function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { refreshSession, showToast, securitySettings, transferFeeMarginNgn } = useAppStore()
  const { nativeTransactionBiometricEnabled, nativeBiometricBusy, confirmWithNativeBiometric } = useNativeTransactionBiometric()
  const banks = useBankDirectory('NG')
  const [step, setStep] = useState<Step>('form')
  const [mode, setMode] = useState<'internal' | 'bank'>('bank')
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
  const [verifying, setVerifying]   = useState(false)

  const amt = parseFloat(amount) || 0
  // Bank transfers carry a fee; internal transfers stay free, so the quote is only surfaced in
  // bank mode. Quoted client-side from the same module the server charges from.
  // Priced against the server's margin so this matches the debit, not an env default.
  const quote = quoteTransferFee(amt, transferFeeMarginNgn ?? undefined)

  useEffect(() => {
    if (!open) return

    void fetch('/api/beneficiaries', { credentials: 'include', cache: 'no-store' })
      .then(parseJsonBody)
      .then(payload => {
        if (!Array.isArray(payload.data)) return
        setBeneficiaries(payload.data)
        const bankDefault = payload.data.find((item: Beneficiary) => item.kind === 'bank' && item.isDefault)
        const internalDefault = payload.data.find((item: Beneficiary) => item.kind === 'internal' && item.isDefault)

        // Bank is checked first so a saved bank beneficiary keeps the modal on its default tab.
        // The old order preferred internal purely because that used to be the default mode, and
        // leaving it would flip anyone with an internal default straight back off the bank tab.
        if (bankDefault) {
          setMode('bank')
          setBankCode(bankDefault.bankCode || '')
          setBankName(bankDefault.bankName || '')
          setAccountNumber(bankDefault.accountNumber || '')
          setAccountName(bankDefault.accountName || '')
        } else if (internalDefault) {
          setMode('internal')
          setRecipient(internalDefault.handle || internalDefault.label)
          setResolvedRecipient(internalDefault.handle ? { name: internalDefault.label, handle: internalDefault.handle } : null)
        }
      })
      .catch(() => undefined)
  }, [open])

  function handleClose() {
    onClose()
    setTimeout(() => {
      setStep('form')
      setMode('bank')
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
      setVerifying(false)
    }, 400)
  }

  // Verifies the recipient, then goes straight to the PIN pad. The transfer summary rides along
  // as PinPad details, so authorising and reviewing happen on one screen instead of two.
  async function goConfirm() {
    if (verifying) return
    if (!amt) { showToast('Fill in all required fields', 'error'); return }

    if (mode === 'internal' && !recipient) { showToast('Recipient is required', 'error'); return }
    if (mode === 'bank' && (!bankCode || !bankName || !accountNumber)) {
      showToast('Fill in all required fields', 'error')
      return
    }

    // The lookup is a network round-trip -- resolving an email or handle to an account, or
    // verifying bank details. Without a pending state the button looks inert and gets tapped
    // again, firing duplicate lookups.
    setVerifying(true)
    try {
      if (mode === 'internal') {
        try {
          const response = await fetch('/api/beneficiaries/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ kind: 'internal', recipient }),
          })
          const data = await readJsonResponse<{ recipient: { name: string; handle: string } }>(response)
          setResolvedRecipient(data.recipient)
        } catch (error) {
          showToast(toUserMessage(error, 'Recipient verification failed.'), 'error')
          return
        }
      } else {
        try {
          const response = await fetch('/api/beneficiaries/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ kind: 'bank', bankCode, bankName, accountNumber, accountName }),
          })
          const data = await readJsonResponse<{
            verification: {
              bankCode: string
              bankName: string
              accountNumber: string
              accountName: string
            }
          }>(response)
          setBankCode(data.verification.bankCode)
          setBankName(data.verification.bankName)
          setAccountNumber(data.verification.accountNumber)
          setAccountName(data.verification.accountName)
        } catch (error) {
          showToast(toUserMessage(error, 'Beneficiary verification failed.'), 'error')
          return
        }
      }

      savePendingConfirmation({
        kind: 'transfer', title: mode === 'internal' ? 'Internal transfer' : 'Bank transfer', amountNgn: amt,
        details: mode === 'internal'
          ? [{ label: 'Recipient', value: recipient }, { label: 'Amount', value: formatNGN(amt) }, { label: 'Fee', value: 'FREE' }]
          : [{ label: 'Recipient', value: accountName }, { label: 'Bank', value: `${bankName} · ${accountNumber}` }, { label: 'Fee', value: formatNGN(quote.fee) }, { label: 'Total debit', value: formatNGN(quote.total) }],
        request: mode === 'internal' ? { mode, recipient, amount: amt, narration } : { mode, bankCode, bankName, accountNumber, accountName, amount: amt, narration },
        returnPath: '/dashboard',
      })
      onClose()
      router.push('/confirm')
    } finally {
      setVerifying(false)
    }
  }

  async function submitTransfer(input: {
    transactionPin?: string
    biometricApprovalToken?: string
    confirmWithBiometric?: boolean
  }) {
    setStep('processing')
    setProcStep(1)
    try {
      setProcStep(2)
      const response = await fetch('/api/wallet/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(mode === 'internal'
          ? { mode, recipient, amount: amt, narration, ...input }
          : { mode, bankCode, bankName, accountNumber, accountName, amount: amt, narration, ...input }),
      })
      const transfer = await readJsonResponse<{ transaction: { reference: string } }>(response)

      setProcStep(3)
      setRef(transfer.transaction.reference)
      await refreshSession()
      setStep('success')
    } catch (error) {
      showToast(toUserMessage(error, 'Transfer failed.'), 'error')
      setPinVersion(current => current + 1)
      setStep('pin')
    }
  }

  async function handlePin(pin: string) {
    await submitTransfer({ transactionPin: pin })
  }

  async function handleBiometricApproval() {
    try {
      const approval = await createBiometricApproval()
      await submitTransfer({ biometricApprovalToken: approval.token })
    } catch (error) {
      showToast(toUserMessage(error, 'Biometric approval failed.'), 'error')
      setPinVersion(current => current + 1)
    }
  }

  async function handleNativeBiometricApproval() {
    const result = await confirmWithNativeBiometric({
      title: 'Confirm transfer',
      subtitle: 'Use fingerprint or face instead of PIN',
    })
    if (!result.verified) {
      if (!result.cancelled) {
        showToast(result.message || 'Biometric verification failed.', 'error')
      }
      return
    }
    await submitTransfer({ confirmWithBiometric: true })
  }

  const titles: Record<Step, string> = {
    form: 'Bank Transfer', pin: nativeTransactionBiometricEnabled ? 'Confirm' : 'Confirm with PIN',
    processing: 'Processing…', success: 'Transfer Submitted'
  }

  const transferDetails = mode === 'internal'
    ? [
        { label: 'To', value: resolvedRecipient?.name || recipient },
        { label: 'Handle', value: resolvedRecipient?.handle || recipient },
        { label: 'Amount', value: formatNGN(amt), emphasis: true },
        { label: 'Fee', value: 'FREE' },
      ]
    : [
        { label: 'To', value: accountName },
        { label: 'Bank', value: `${bankName} · ${accountNumber}` },
        { label: 'Amount', value: formatNGN(amt), emphasis: true },
        { label: 'Fee', value: formatNGN(quote.fee) },
        { label: 'Total debit', value: formatNGN(quote.total), emphasis: true },
      ]

  return (
    <Modal open={open} onClose={handleClose} title={titles[step]} size="md">
      {step === 'form' && (
        <div className="p-6 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(['bank', 'internal'] as const).map(option => (
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
            <BankAccountPicker
              banks={banks}
              beneficiaries={beneficiaries}
              value={{ bankCode, bankName, accountNumber, accountName }}
              onChange={next => {
                setBankCode(next.bankCode)
                setBankName(next.bankName)
                setAccountNumber(next.accountNumber)
                setAccountName(next.accountName)
              }}
            />
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
            <div className="flex justify-between py-1"><span className="text-[var(--muted)]">Transfer fee</span>{mode === 'internal'
              ? <span className="text-[var(--green2)] font-bold">FREE</span>
              : <span className="text-[var(--text2)] font-bold">{quote.fee > 0 ? `₦${quote.fee.toLocaleString('en-NG')}` : '—'}</span>}</div>
            {mode !== 'internal' && quote.fee > 0 && (
              <div className="flex justify-between py-1"><span className="text-[var(--muted)]">You&apos;ll be debited</span><span className="text-[var(--gold2)] font-bold">₦{quote.total.toLocaleString('en-NG')}</span></div>
            )}
            <div className="flex justify-between py-1"><span className="text-[var(--muted)]">Delivery</span><span className="text-[var(--gold2)] font-bold">{mode === 'internal' ? 'Instant' : 'Pending settlement'}</span></div>
          </div>
          <Button onClick={() => void goConfirm()} loading={verifying} className="w-full py-3.5">
            {verifying
              ? (mode === 'internal' ? 'Verifying recipient…' : 'Verifying account…')
              : 'Continue to PIN →'}
          </Button>
        </div>
      )}

      {step === 'pin' && (
        <PinPad
          key={pinVersion}
          onComplete={handlePin}
          title={nativeTransactionBiometricEnabled ? 'PIN or biometrics' : 'Confirm Transaction PIN'}
          subtitle={mode === 'internal'
            ? 'Check the details, then enter your PIN to send.'
            : 'Check the details, then enter your PIN. Funds stay locked until payout settles.'}
          details={transferDetails}
          footer={(
            <button
              type="button"
              onClick={() => setStep('form')}
              className="text-[10px] font-bold uppercase tracking-[.8px] text-[var(--gold2)] underline"
            >
              ← Edit transfer
            </button>
          )}
          secondaryActionLabel={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? 'Use passkey' : undefined}
          secondaryActionIconOnly
          onSecondaryAction={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? () => void handleBiometricApproval() : undefined}
          onBiometric={nativeTransactionBiometricEnabled ? () => void handleNativeBiometricApproval() : undefined}
          biometricBusy={nativeBiometricBusy}
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
