'use client'

import { type FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store'

export function KycRequiredModal() {
  const router = useRouter()
  const { refreshSession, showToast } = useAppStore()
  const [documentType, setDocumentType] = useState<'nin' | 'bvn'>('nin')
  const [documentNumber, setDocumentNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function createFundingAccounts() {
    const providers = ['palmpay', 'flutterwave'] as const
    return Promise.allSettled(
      providers.map(provider => (
        fetch('/api/wallet/deposit/account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ provider }),
        })
      ))
    )
  }

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
        body: JSON.stringify({
          documentType,
          documentNumber: normalizedNumber,
        }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'KYC submission failed.')
      }

      await refreshSession()
      void createFundingAccounts().finally(() => {
        void refreshSession()
      })
      showToast('Identity submitted. Funding accounts are being prepared.', 'success')
      router.replace('/security?setup=1')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Identity submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[650] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md border border-[var(--border)] bg-[var(--coal)]">
        <div className="ank-strip" />
        <div className="p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold2)]">Verification Required</div>
          <div className="mt-2 font-display text-[22px] font-black text-[var(--text)]">Submit BVN or NIN</div>
          <div className="mt-2 text-[12px] leading-relaxed text-[var(--text2)]">
            Before you proceed, enter one identity number. We will submit it for review and start creating your funding accounts while you set up your PIN and biometrics.
          </div>

          <form onSubmit={submitIdentity} className="mt-5 grid gap-4">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[rgba(202,165,96,0.14)] bg-[var(--clay)] p-1">
              {(['nin', 'bvn'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setDocumentType(type)
                    setError('')
                  }}
                  className={`rounded-xl px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] transition ${
                    documentType === type
                      ? 'bg-[var(--gold)] text-[var(--dark)] shadow-[0_10px_24px_rgba(202,165,96,.18)]'
                      : 'text-[var(--text2)] hover:text-[var(--gold2)]'
                  }`}
                >
                  {type}
                </button>
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
              Your number is stored securely and used only for funding-account setup and compliance review.
            </div>

            <Button type="submit" loading={submitting} className="w-full py-3">
              {submitting ? 'Submitting Identity…' : 'Submit & Continue'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
