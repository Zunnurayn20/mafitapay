'use client'
import { BankAccountPicker } from '@/components/ui/BankAccountPicker'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { createBiometricApproval } from '@/lib/client/biometric'
import { useNativeTransactionBiometric } from '@/hooks/useNativeTransactionBiometric'
import { useBankDirectory } from '@/lib/client/catalogs'
import { parseJsonBody, readJsonResponse, toUserMessage } from '@/lib/client/http'
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
  const { nativeTransactionBiometricEnabled, nativeBiometricBusy, confirmWithNativeBiometric } = useNativeTransactionBiometric()
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
    }
  }

  async function confirm() {
    setPinVersion(current => current + 1)
    setStep('pin')
  }

  async function submitWithdrawal(input: {
    transactionPin?: string
    biometricApprovalToken?: string
    confirmWithBiometric?: boolean
  }) {
    const amt = parseFloat(amount) || 0
    if (!amt) { showToast('Enter a valid amount', 'error'); return }

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
      closeModal()
      setTimeout(() => {
        setModalData({
          headline: 'Withdrawal Submitted!',
          body: `₦${amt.toLocaleString()} bank withdrawal to ${resolvedAccountName} is pending payout settlement.`,
          ref: withdrawal.transaction.reference || generateRef(),
        })
        openModal('success')
      }, 100)
    } catch (error) {
      showToast(toUserMessage(error, 'Withdrawal failed.'), 'error')
      setPinVersion(current => current + 1)
      setStep('pin')
    }
  }

  async function handleBiometricApproval() {
    try {
      const approval = await createBiometricApproval()
      await submitWithdrawal({ biometricApprovalToken: approval.token })
    } catch (error) {
      showToast(toUserMessage(error, 'Biometric approval failed.'), 'error')
      setPinVersion(current => current + 1)
    }
  }

  async function handleNativeBiometricApproval() {
    const result = await confirmWithNativeBiometric({
      title: 'Confirm withdrawal',
      subtitle: 'Use fingerprint or face instead of PIN',
    })
    if (!result.verified) {
      if (!result.cancelled) {
        showToast(result.message || 'Biometric verification failed.', 'error')
      }
      return
    }
    await submitWithdrawal({ confirmWithBiometric: true })
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
        <Button onClick={confirm} className="w-full py-3.5">Proceed to Withdraw →</Button>
      </div>
      ) : (
        <PinPad
          key={pinVersion}
          onComplete={(pin) => void submitWithdrawal({ transactionPin: pin })}
          title={nativeTransactionBiometricEnabled ? 'PIN or biometrics' : 'Confirm Transaction PIN'}
          subtitle={`Authorising ${formatNGN(parseFloat(amount) || 0)} to ${accountName || 'bank beneficiary'}`}
          secondaryActionLabel={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? 'Use passkey' : undefined}
          secondaryActionIconOnly
          onSecondaryAction={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? () => void handleBiometricApproval() : undefined}
          onBiometric={nativeTransactionBiometricEnabled ? () => void handleNativeBiometricApproval() : undefined}
          biometricBusy={nativeBiometricBusy}
        />
      )}
    </Modal>
  )
}