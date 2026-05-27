'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAppStore } from '@/store'
import { AuthSplitShell } from '@/components/auth/AuthSplitShell'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ArrowLeft } from 'lucide-react'

export default function RegisterPage() {
  const { authResolved, isAuthenticated, register, theme } = useAppStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [step, setStep]     = useState(1)
  const [name, setName]     = useState('')
  const [email, setEmail]   = useState('')
  const [phone, setPhone]   = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [pass, setPass]     = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [verificationLink, setVerificationLink] = useState('')

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.push('/dashboard') }, [authResolved, isAuthenticated, router])
  useEffect(() => {
    const ref = searchParams.get('ref')?.trim().toUpperCase() ?? ''
    if (ref) setReferralCode(ref)
  }, [searchParams])

  function normalizePhone(value: string) {
    const trimmed = value.trim()
    const normalized = trimmed.replace(/[^\d+]/g, '')
    if (normalized.startsWith('+')) return normalized
    if (normalized.startsWith('0')) return `+234${normalized.slice(1)}`
    if (normalized.startsWith('234')) return `+${normalized}`
    return normalized
  }

  function validateStepOne() {
    if (!name.trim() || !email.trim() || !phone.trim()) {
      return 'Full name, email, and phone number are required.'
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      return 'Enter a valid email address.'
    }
    if (!/^\+?[1-9]\d{9,14}$/.test(normalizePhone(phone))) {
      return 'Enter a valid phone number.'
    }
    return ''
  }

  function validateStepTwo() {
    if (!pass.trim()) {
      return 'Password is required.'
    }
    if (pass.length < 8 || !/[A-Za-z]/.test(pass) || !/\d/.test(pass)) {
      return 'Password must be at least 8 characters and include both letters and numbers.'
    }
    if (pass !== confirmPass) {
      return 'Passwords do not match.'
    }
    return ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setVerificationLink('')
    if (step < 2) {
      const stepOneError = validateStepOne()
      if (stepOneError) {
        setError(stepOneError)
        return
      }
      setStep(2)
      return
    }

    const stepTwoError = validateStepTwo()
    if (stepTwoError) {
      setError(stepTwoError)
      return
    }

    setLoading(true)
    try {
      const result = await register({ name: name.trim(), email: email.trim().toLowerCase(), phone: normalizePhone(phone), password: pass, referralCode: referralCode.trim().toUpperCase() || undefined })
      setSuccess(result.message || 'Account created. Verify your email address before signing in.')
      setVerificationLink(result.verificationLink || '')
      setStep(1)
      setPass('')
      setConfirmPass('')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to create account.')
    } finally {
      setLoading(false)
    }
  }

  function handleBackToDetails() {
    setError('')
    setSuccess('')
    setVerificationLink('')
    setStep(1)
  }

  return (
    <AuthSplitShell>
      <div className="lg:hidden text-center mb-8">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden">
          <img
            src="/mafitapay-logo.png"
            alt="MafitaPay logo"
            className="h-20 w-20 object-contain"
          />
        </div>
        <div className="font-display font-black text-3xl text-[var(--text)]">MafitaPay</div>
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-widest mt-1">Create Your Account</div>
      </div>

      <div className="relative overflow-hidden bg-[var(--coal)] border border-[var(--border)]">
        <div className="ank-strip" />
        <div className="p-7">
          <div className="flex gap-2 mb-6">
            {[1,2].map(s => (
              <div key={s} className={`flex-1 h-1 ${s <= step ? 'bg-[var(--gold)]' : 'bg-[var(--border)]'}`} />
            ))}
          </div>
          <div className="mb-5 flex items-center gap-3">
            {step === 2 ? (
              <button
                type="button"
                aria-label="Back to personal details"
                onClick={handleBackToDetails}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,.03)] text-[var(--text)] transition hover:border-[var(--gold)] hover:text-[var(--gold2)]"
              >
                <ArrowLeft size={16} />
              </button>
            ) : null}
            <div className="font-display font-black text-[20px] text-[var(--text)]">
              {step === 1 ? 'Personal Details' : 'Secure Your Account'}
            </div>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {step === 1 && (<>
              <Input label="Full Name" placeholder="Aminu Ibrahim" value={name} onChange={e => setName(e.target.value)} error={error && (!name.trim() || !email.trim() || !phone.trim()) ? error : undefined} />
              <Input label="Email Address" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} error={error && !email.trim() ? error : undefined} />
              <Input label="Phone Number" type="tel" placeholder="+2348012345678" value={phone} onChange={e => setPhone(e.target.value)} error={error && !phone.trim() ? error : undefined} />
              <Input label="Referral Code (Optional)" placeholder="MAFAT2912" value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())} />
            </>)}
            {step === 2 && (<>
              <Input label="Create Password" type="password" placeholder="At least 8 chars with letters and numbers" value={pass} onChange={e => setPass(e.target.value)} error={error ? error : undefined} />
              <Input label="Confirm Password" type="password" placeholder="Repeat password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} error={error ? error : undefined} />
              <div className="bg-[rgba(79,70,229,.06)] border border-[rgba(79,70,229,.18)] border-l-4 border-l-[var(--gold)] p-3 text-[11px] text-[var(--text2)]">
                By creating an account you agree to our <span className="text-[var(--gold2)] cursor-pointer">Terms of Service</span> and <span className="text-[var(--gold2)] cursor-pointer">Privacy Policy</span>.
              </div>
            </>)}
            {error && (
              <div className="border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] p-3 text-[11px] text-[var(--red2)]">
                {error}
              </div>
            )}
            <Button type="submit" loading={loading} className="w-full py-3.5">
              {step === 1 ? 'Continue →' : 'Create Account'}
            </Button>
          </form>
          <div className="text-center mt-5 text-[12px] text-[var(--muted)]">
            Already have an account?{' '}
            <span className="text-[var(--gold2)] font-bold cursor-pointer" onClick={() => router.push('/login')}>Sign in →</span>
          </div>
        </div>
        {success ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(8,7,5,.88)] px-5 backdrop-blur-md">
            <div className="w-full border border-[rgba(202,165,96,.24)] bg-[var(--coal)] p-5 text-center shadow-[0_24px_70px_rgba(0,0,0,.35)]">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[rgba(46,170,92,.14)] text-[var(--green2)]">
                ✓
              </div>
              <div className="mt-4 font-display text-[20px] font-black text-[var(--text)]">
                Check your email
              </div>
              <div className="mt-2 text-[12px] leading-relaxed text-[var(--text2)]">
                {success}
              </div>
              {verificationLink ? (
                <a
                  className="mt-4 block break-all border border-[rgba(202,165,96,.22)] bg-[rgba(202,165,96,.08)] px-3 py-3 text-[11px] font-bold text-[var(--gold2)] underline"
                  href={verificationLink}
                >
                  Open local verification link
                </a>
              ) : null}
              <Button className="mt-4 w-full py-3" onClick={() => router.push('/login')}>
                Go To Login
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </AuthSplitShell>
  )
}
