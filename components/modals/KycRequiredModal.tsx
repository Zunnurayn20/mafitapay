'use client'

import { type FormEvent, useRef, useState } from 'react'
import { Fingerprint, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { canUseBiometrics, enrollBiometricCredential } from '@/lib/client/biometric'
import { useAppStore } from '@/store'

function PinDigits({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  function updateDigit(index: number, rawValue: string) {
    const digit = rawValue.replace(/\D/g, '').slice(-1)
    const digits = value.padEnd(4, ' ').split('').slice(0, 4)
    digits[index] = digit || ' '
    onChange(digits.join(''))
    if (digit && index < 3) inputs.current[index + 1]?.focus()
  }

  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</legend>
      <div className="flex gap-3" dir="ltr">
        {Array.from({ length: 4 }, (_, index) => (
          <input
            key={index}
            ref={element => { inputs.current[index] = element }}
            aria-label={`${label}, digit ${index + 1}`}
            autoComplete="off"
            inputMode="numeric"
            maxLength={1}
            type="password"
            value={(value[index] ?? '').trim()}
            onChange={event => updateDigit(index, event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Backspace' && !value[index] && index > 0) {
                inputs.current[index - 1]?.focus()
              }
              if (event.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus()
              if (event.key === 'ArrowRight' && index < 3) inputs.current[index + 1]?.focus()
            }}
            onPaste={event => {
              const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
              if (!pasted) return
              event.preventDefault()
              onChange(pasted.padEnd(4, ' '))
              inputs.current[Math.min(pasted.length, 3)]?.focus()
            }}
            className="h-14 w-12 border border-[var(--border)] bg-[var(--clay2)] text-center text-xl font-bold text-[var(--text)] outline-none transition-colors focus:border-[var(--gold)] disabled:opacity-60"
          />
        ))}
      </div>
    </fieldset>
  )
}

export function KycRequiredModal({ onSecuritySetupChange }: { onSecuritySetupChange: (active: boolean) => void }) {
  const { refreshSession, showToast } = useAppStore()
  const [step, setStep] = useState<'identity' | 'pin' | 'biometric'>('identity')
  const [documentType, setDocumentType] = useState<'nin' | 'bvn'>('nin')
  const [documentNumber, setDocumentNumber] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [savingPin, setSavingPin] = useState(false)
  const [savingBiometric, setSavingBiometric] = useState(false)
  const [biometricSupported, setBiometricSupported] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  async function submitIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedNumber = documentNumber.replace(/\D/g, '')
    setError('')

    if (!/^\d{11}$/.test(normalizedNumber)) {
      setError(`${documentType.toUpperCase()} must be exactly 11 digits.`)
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ documentType, documentNumber: normalizedNumber }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'KYC submission failed.')
      }

      onSecuritySetupChange(true)
      setStep('pin')
      showToast('Identity submitted. Funding accounts are being prepared.', 'success')
      try {
        await refreshSession()
      } catch {
        showToast('Identity was submitted. Your account details will refresh shortly.', 'error')
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Identity submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function savePin() {
    setError('')
    if (!/^\d{4}$/.test(pin) || !/^\d{4}$/.test(confirmPin)) {
      setError('Enter all four digits in both PIN fields.')
      return
    }
    if (pin !== confirmPin) {
      setError('PIN confirmation does not match.')
      setConfirmPin('')
      return
    }

    setSavingPin(true)
    try {
      const response = await fetch('/api/security/transaction-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newPin: pin }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Transaction PIN setup failed.')
      }

      setStep('biometric')
      showToast('Transaction PIN created.', 'success')
      const supported = await canUseBiometrics()
      setBiometricSupported(supported)
      try {
        await refreshSession()
      } catch {
        showToast('PIN saved. Your account details will refresh shortly.', 'error')
      }
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : 'Transaction PIN setup failed.')
    } finally {
      setSavingPin(false)
    }
  }

  async function finishSecuritySetup() {
    try {
      await refreshSession()
    } catch {
      showToast('Security setup is saved. Refresh the page if your dashboard does not update.', 'error')
    } finally {
      onSecuritySetupChange(false)
    }
  }

  async function enrollBiometrics() {
    setSavingBiometric(true)
    setError('')
    try {
      await enrollBiometricCredential()
      showToast('Biometric approval is ready on this device.', 'success')
      await finishSecuritySetup()
    } catch (biometricError) {
      setError(biometricError instanceof Error ? biometricError.message : 'Biometric enrollment failed.')
    } finally {
      setSavingBiometric(false)
    }
  }

  const titles = {
    identity: 'Submit BVN or NIN',
    pin: 'Create your transaction PIN',
    biometric: 'Set up biometrics',
  }

  return (
    <div className="fixed inset-0 z-[650] flex items-center justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm">
      <section aria-labelledby="onboarding-modal-title" aria-modal="true" role="dialog" className="w-full max-w-md border border-[var(--border)] bg-[var(--coal)]">
        <div className="ank-strip" />
        <div className="p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold2)]">{step === 'identity' ? 'Verification Required' : `Account Setup · ${step === 'pin' ? '2' : '3'} of 3`}</div>
          <h2 id="onboarding-modal-title" className="mt-2 font-display text-[22px] font-black text-[var(--text)]">{titles[step]}</h2>

          {step === 'identity' ? (
            <>
              <div className="mt-2 text-[12px] leading-relaxed text-[var(--text2)]">
                Enter one identity number. We’ll submit it for review and start creating your funding accounts while you finish account security setup.
              </div>
              <form onSubmit={submitIdentity} className="mt-5 grid gap-4">
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[rgba(202,165,96,0.14)] bg-[var(--clay)] p-1">
                  {(['nin', 'bvn'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { setDocumentType(type); setError('') }}
                      className={`rounded-xl px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] transition ${documentType === type ? 'bg-[var(--gold)] text-[var(--dark)] shadow-[0_10px_24px_rgba(202,165,96,.18)]' : 'text-[var(--text2)] hover:text-[var(--gold2)]'}`}
                    >{type}</button>
                  ))}
                </div>
                <Input
                  label={`${documentType.toUpperCase()} Number`}
                  inputMode="numeric"
                  placeholder="Enter 11 digits"
                  value={documentNumber}
                  onChange={event => setDocumentNumber(event.target.value.replace(/\D/g, '').slice(0, 11))}
                  error={error || undefined}
                />
                <div className="border border-[rgba(202,165,96,.16)] bg-[rgba(202,165,96,.07)] p-3 text-[11px] leading-relaxed text-[var(--text2)]">
                  Your number is stored securely and used for funding-account setup and compliance review.
                </div>
                <Button type="submit" loading={submitting} className="w-full py-3">{submitting ? 'Submitting…' : 'Submit & Continue'}</Button>
              </form>
            </>
          ) : null}

          {step === 'pin' ? (
            <div className="mt-3 grid gap-5">
              <p className="text-[12px] leading-relaxed text-[var(--text2)]">Create a four-digit PIN to approve wallet actions. Enter each digit in its own box.</p>
              <PinDigits label="Create PIN" value={pin} onChange={setPin} disabled={savingPin} />
              <PinDigits label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} disabled={savingPin} />
              {error ? <div role="alert" className="text-[11px] text-[var(--red2)]">{error}</div> : null}
              <Button className="w-full py-3" onClick={() => void savePin()} loading={savingPin}>Save PIN & Continue</Button>
            </div>
          ) : null}

          {step === 'biometric' ? (
            <div className="mt-3 grid gap-4">
              <div className="flex gap-3 border border-[var(--border)] bg-[var(--clay)] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[rgba(202,165,96,.14)] text-[var(--gold2)]"><Fingerprint size={20} /></span>
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">Use fingerprint or face unlock</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-[var(--text2)]">
                    {biometricSupported === false ? 'Biometrics are not available on this device. You can finish with your PIN.' : 'This is optional. You can enroll this device now or do it later in Security settings.'}
                  </div>
                </div>
              </div>
              {error ? <div role="alert" className="text-[11px] text-[var(--red2)]">{error}</div> : null}
              {biometricSupported !== false ? (
                <Button className="w-full py-3" onClick={() => void enrollBiometrics()} loading={savingBiometric}>
                  <span className="inline-flex items-center gap-2"><ShieldCheck size={16} /> Enroll biometrics</span>
                </Button>
              ) : null}
              <Button variant="secondary" className="w-full py-3" onClick={() => void finishSecuritySetup()} disabled={savingBiometric}>
                {biometricSupported === false ? 'Finish setup' : 'Do this later'}
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
