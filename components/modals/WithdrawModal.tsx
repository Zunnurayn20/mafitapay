'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { createBiometricApproval } from '@/lib/client/biometric'
import { useBankDirectory } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { formatNGN, generateRef } from '@/lib/utils'
import type { Beneficiary } from '@/types'

type Step = 'form' | 'pin'

export function WithdrawModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openModal = useAppStore(state => state.openModal)
  const refreshSession = useAppStore(state => state.refreshSession)
  const setModalData = useAppStore(state => state.setModalData)
  const closeModal = useAppStore(state => state.closeModal)
  const showToast = useAppStore(state => state.showToast)
  const securitySettings = useAppStore(state => state.securitySettings)
  const banks = useBankDirectory('NG')
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([])
  const [amount, setAmount] = useState('')
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [step, setStep] = useState<Step>('form')
  const [pinVersion, setPinVersion] = useState(0)

  useEffect(() => {
    if (!open) return

    void fetch('/api/beneficiaries?kind=bank', { credentials: 'include', cache: 'no-store' })
      .then(response => response.json())
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

  useEffect(() => {
    if (!open) {
      setStep('form')
      setPinVersion(0)
    }
  }, [open])

  async function confirm() {
    setPinVersion(current => current + 1)
    setStep('pin')
  }

  async function submitWithdrawal(input: { transactionPin?: string; biometricApprovalToken?: string }) {
    const amt = parseFloat(amount) || 0
    if (!amt) { showToast('Enter a valid amount', 'error'); return }

    try {
      const lookupResponse = await fetch('/api/beneficiaries/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kind: 'bank', bankCode, bankName, accountNumber, accountName }),
      })
      const lookupPayload = await lookupResponse.json()
      if (!lookupResponse.ok || lookupPayload.success === false) {
        throw new Error(lookupPayload.error || 'Beneficiary verification failed.')
      }
      const resolvedBankCode = lookupPayload.data.verification.bankCode
      const resolvedBankName = lookupPayload.data.verification.bankName
      const resolvedAccountNumber = lookupPayload.data.verification.accountNumber
      const resolvedAccountName = lookupPayload.data.verification.accountName
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
      const payload = await response.json()

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Withdrawal failed.')
      }

      await refreshSession()
      closeModal()
      setTimeout(() => {
        setModalData({
          headline: 'Withdrawal Submitted!',
          body: `₦${amt.toLocaleString()} bank withdrawal to ${resolvedAccountName} is pending payout settlement.`,
          ref: payload.data.transaction.reference || generateRef(),
        })
        openModal('success')
      }, 100)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Withdrawal failed.', 'error')
      setPinVersion(current => current + 1)
      setStep('pin')
    }
  }

  async function handleBiometricApproval() {
    try {
      const approval = await createBiometricApproval()
      await submitWithdrawal({ biometricApprovalToken: approval.token })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Biometric approval failed.', 'error')
      setPinVersion(current => current + 1)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Withdraw Funds">
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
        </div>
        <div className="space-y-3">
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
          <Input label="Account Number" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="0123456789" />
          <Input label="Resolved Account Name" value={accountName} readOnly placeholder="Use a saved beneficiary or verify from transfer flow" />
          {beneficiaries.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {beneficiaries.slice(0, 4).map(item => (
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
        </div>
        <Button onClick={confirm} className="w-full py-3.5">Proceed to Withdraw →</Button>
      </div>
      ) : (
        <PinPad
          key={pinVersion}
          onComplete={(pin) => void submitWithdrawal({ transactionPin: pin })}
          title="Confirm Transaction PIN"
          subtitle={`Authorising ${formatNGN(parseFloat(amount) || 0)} to ${accountName || 'bank beneficiary'}`}
          secondaryActionLabel={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? 'Use biometrics' : undefined}
          secondaryActionIconOnly
          onSecondaryAction={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? () => void handleBiometricApproval() : undefined}
        />
      )}
    </Modal>
  )
}