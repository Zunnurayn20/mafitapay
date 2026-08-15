'use client'
import { BankAccountPicker } from '@/components/ui/BankAccountPicker'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PinPad, type PinPadStatus } from '@/components/ui/PinPad'
import { createBiometricApproval } from '@/lib/client/biometric'
import { useNativeTransactionBiometric } from '@/hooks/useNativeTransactionBiometric'
import { useBankDirectory } from '@/lib/client/catalogs'
import { parseJsonBody, readJsonResponse, toUserMessage } from '@/lib/client/http'
import { useAppStore } from '@/store'
import { quoteTransferFee } from '@/lib/transfer-fees'
import { formatNGN, generateRef } from '@/lib/utils'
import type { Beneficiary } from '@/types'

type Step = 'form' | 'pin'

export function WithdrawModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refreshSession = useAppStore(state => state.refreshSession)
  const securitySettings = useAppStore(state => state.securitySettings)
  const { nativeTransactionBiometricEnabled, nativeBiometricBusy, confirmWithNativeBiometric } = useNativeTransactionBiometric()
  const banks = useBankDirectory('NG')
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([])
  const [amount, setAmount] = useState('')
  // Live quote so the fee the user sees matches what the server will charge. quoteTransferFee
  // returns a zero quote for empty or invalid amounts, so the fee row simply stays hidden.
  const transferFeeMarginNgn = useAppStore(state => state.transferFeeMarginNgn)
  // Priced against the server's margin so this matches the debit, not an env default.
  const quote = quoteTransferFee(parseFloat(amount) || 0, transferFeeMarginNgn ?? undefined)
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [step, setStep] = useState<Step>('form')
  const [pinVersion, setPinVersion] = useState(0)
  const [confirmStatus, setConfirmStatus] = useState<PinPadStatus>('pin')
  const [confirmError, setConfirmError] = useState('')
  const [formError, setFormError] = useState('')
  const [reference, setReference] = useState('')

  useEffect(() => {
    if (!open) return

    void fetch('/api/beneficiaries?kind=bank', { credentials: 'include', cache: 'no-store' })
      .then(parseJsonBody)
      .then(payload => {
        if (!Array.isArray(payload.data)) return
        setBeneficiaries(payload.data)
        const bankDefault = payload.data.find((item: Beneficiary) => item.isDefault)
        if (bankDefault) {
          setBankCode(bankDefault.bankCode || '')
          setBankName(bankDefault.bankName || '')
          setAccountNumber(bankDefault.accountNumber || '')
          setAccountName(bankDefault.accountName || '')
        }
      })
      .catch(() => undefined)
  }, [open])

  // Reset the flow whenever the modal transitions to closed. This component stays mounted
  // (ModalManager always renders it), so without this a reopened modal would resume on the PIN
  // step. Adjusting state during render rather than in an effect avoids the cascading re-render
  // an effect-based reset causes.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) {
      setStep('form')
      setPinVersion(0)
      setConfirmStatus('pin')
      setConfirmError('')
      setFormError('')
      setReference('')
    }
  }

  async function confirm() {
    const amt = parseFloat(amount) || 0
    if (!amt) { setFormError('Enter a valid amount'); return }
    if (!bankCode || !bankName || !accountNumber) { setFormError('Fill in all required bank details'); return }
    setFormError('')
    try {
      const response = await fetch('/api/beneficiaries/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ kind: 'bank', bankCode, bankName, accountNumber, accountName }) })
      const data = await readJsonResponse<{ verification: { bankCode: string; bankName: string; accountNumber: string; accountName: string } }>(response)
      setBankCode(data.verification.bankCode)
      setBankName(data.verification.bankName)
      setAccountNumber(data.verification.accountNumber)
      setAccountName(data.verification.accountName)
      setPinVersion(current => current + 1)
      setConfirmStatus('pin')
      setConfirmError('')
      setStep('pin')
    } catch (error) { setFormError(toUserMessage(error, 'Beneficiary verification failed.')) }
  }

  async function submitWithdrawal(input: {
    transactionPin?: string
    biometricApprovalToken?: string
    confirmWithBiometric?: boolean
  }) {
    const amt = parseFloat(amount) || 0
    if (!amt) {
      setConfirmError('Enter a valid amount')
      setConfirmStatus('error')
      return
    }

    if (confirmStatus === 'processing') return
    setConfirmError('')
    setConfirmStatus('processing')
    try {
      const lookupResponse = await fetch('/api/beneficiaries/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kind: 'bank', bankCode, bankName, accountNumber, accountName }),
      })
      const lookupData = await readJsonResponse<{
        verification: {
          bankCode: string
          bankName: string
          accountNumber: string
          accountName: string
        }
      }>(lookupResponse)
      const resolvedBankCode = lookupData.verification.bankCode
      const resolvedBankName = lookupData.verification.bankName
      const resolvedAccountNumber = lookupData.verification.accountNumber
      const resolvedAccountName = lookupData.verification.accountName
      setBankCode(resolvedBankCode)
      setBankName(resolvedBankName)
      setAccountNumber(resolvedAccountNumber)
      setAccountName(resolvedAccountName)

      const response = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount: amt,
          bankCode: resolvedBankCode,
          bankName: resolvedBankName,
          accountNumber: resolvedAccountNumber,
          accountName: resolvedAccountName,
          ...input,
        }),
      })
      const withdrawal = await readJsonResponse<{ transaction: { reference?: string } }>(response)

      await refreshSession()
      setReference(withdrawal.transaction.reference || generateRef())
      setConfirmStatus('success')
    } catch (error) {
      setConfirmError(toUserMessage(error, 'Withdrawal failed.'))
      setConfirmStatus('error')
    }
  }

  async function handleBiometricApproval() {
    try {
      const approval = await createBiometricApproval()
      await submitWithdrawal({ biometricApprovalToken: approval.token })
    } catch (error) {
      setConfirmError(toUserMessage(error, 'Biometric approval failed.'))
      setConfirmStatus('error')
    }
  }

  async function handleNativeBiometricApproval() {
    const result = await confirmWithNativeBiometric({
      title: 'Confirm withdrawal',
      subtitle: 'Use fingerprint or face instead of PIN',
    })
    if (!result.verified) {
      if (!result.cancelled) {
        setConfirmError(result.message || 'Biometric verification failed.')
        setConfirmStatus('error')
      }
      return
    }
    await submitWithdrawal({ confirmWithBiometric: true })
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (confirmStatus === 'processing') return
        onClose()
      }}
      title={confirmStatus === 'processing' ? 'Processing…' : confirmStatus === 'success' ? 'Withdrawal submitted' : confirmStatus === 'error' ? 'Transaction failed' : 'Withdraw Funds'}
      bottomSheet={step === 'pin'}
      dismissible={confirmStatus !== 'processing'}
    >
      {step === 'form' ? (
      <div className="flex flex-col gap-4 p-6">
        <div className="border border-[rgba(67,56,202,.2)] border-l-4 border-l-[var(--terra)] bg-[rgba(67,56,202,.07)] p-4">
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[var(--terra2)]">Bank Payout Withdrawal</div>
          <div className="text-[11px] leading-relaxed text-[var(--text2)]">
            Submit a bank payout request. Funds move to locked balance until the payout settles.
          </div>
        </div>
        <div>
          <Input label="Amount (NGN)" prefix="₦" type="number" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)} className="text-lg font-bold font-display" />
          <div className="mt-2 flex gap-1.5">
            {[5000,20000,50000].map(q => (
              <button key={q} onClick={() => setAmount(String(q))}
                className="flex-1 cursor-pointer border border-[var(--border)] bg-[var(--clay2)] py-1.5 text-[10px] font-bold text-[var(--text2)] transition-all hover:border-[var(--gold2)]">
                ₦{q >= 1000 ? q/1000+'k' : q}
              </button>
            ))}
          </div>
          {quote.fee > 0 && (
            <div className="mt-2 border border-[var(--border)] bg-[var(--clay2)] p-2.5">
              <div className="flex justify-between py-0.5 text-[10px]"><span className="text-[var(--muted)]">Transfer fee</span><span className="font-semibold text-[var(--text2)]">₦{quote.fee.toLocaleString('en-NG')}</span></div>
              <div className="flex justify-between py-0.5 text-[10px]"><span className="text-[var(--muted)]">You&apos;ll be debited</span><span className="font-bold text-[var(--gold2)]">₦{quote.total.toLocaleString('en-NG')}</span></div>
            </div>
          )}
        </div>
        <div className="space-y-3">
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
        </div>
        {formError ? (
          <div className="border border-[rgba(220,38,38,.25)] bg-[rgba(220,38,38,.08)] px-3.5 py-3 text-[11px] font-medium text-[var(--red2)]">
            {formError}
          </div>
        ) : null}
        <Button onClick={confirm} className="w-full py-3.5">Proceed to Withdraw →</Button>
      </div>
      ) : (
        <PinPad
          key={pinVersion}
          onComplete={(pin) => void submitWithdrawal({ transactionPin: pin })}
          title={nativeTransactionBiometricEnabled ? 'PIN or biometrics' : 'Confirm Transaction PIN'}
          subtitle="Check the details, then enter your PIN. Funds stay locked until payout settles."
          details={[
            { label: 'To', value: accountName || 'Bank beneficiary' },
            { label: 'Bank', value: `${bankName} · ${accountNumber}` },
            { label: 'Amount', value: formatNGN(parseFloat(amount) || 0), emphasis: true },
            { label: 'Fee', value: formatNGN(quote.fee) },
            { label: 'Total debit', value: formatNGN(quote.total), emphasis: true },
          ]}
          footer={(
            <button
              type="button"
              onClick={() => setStep('form')}
              className="text-[10px] font-bold uppercase tracking-[.8px] text-[var(--gold2)] underline"
            >
              ← Edit withdrawal
            </button>
          )}
          secondaryActionLabel={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? 'Use passkey' : undefined}
          secondaryActionIconOnly
          onSecondaryAction={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? () => void handleBiometricApproval() : undefined}
          onBiometric={nativeTransactionBiometricEnabled ? () => void handleNativeBiometricApproval() : undefined}
          biometricBusy={nativeBiometricBusy}
          status={confirmStatus}
          statusTitle={confirmStatus === 'processing' ? 'Processing payment' : confirmStatus === 'success' ? 'Withdrawal submitted!' : undefined}
          statusMessage={confirmStatus === 'processing'
            ? 'Submitting your bank payout. Funds stay locked until it settles.'
            : confirmStatus === 'success'
              ? `₦${(parseFloat(amount) || 0).toLocaleString()} bank withdrawal to ${accountName} is pending payout settlement.`
              : confirmError}
          statusReference={reference}
          onRetry={() => {
            setConfirmError('')
            setConfirmStatus('pin')
            setPinVersion(current => current + 1)
          }}
          onDone={onClose}
        />
      )}
    </Modal>
  )
}
