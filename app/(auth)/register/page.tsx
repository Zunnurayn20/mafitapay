'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, Check, CheckCircle2, Gift, Mail, User } from 'lucide-react'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/client/native-system-bars'
import { AuthSplitShell } from '@/components/auth/AuthSplitShell'
import { AuthTopNav } from '@/components/auth/AuthBrand'
import { AuthStepper } from '@/components/auth/AuthStepper'
import { CheckEmailPanel } from '@/components/auth/CheckEmailPanel'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { PasswordStrength } from '@/components/auth/PasswordStrength'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PrivyAuthAction } from '@/components/auth/PrivyAuthAction'
import { phoneFromChipInput, validateProfileFields, isPasswordValid } from '@/lib/auth/validation'

const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)
const TERMS_URL = process.env.NEXT_PUBLIC_TERMS_URL?.trim() || ''
const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL?.trim() || ''

export default function RegisterPage() {
  const { authResolved, isAuthenticated, register, theme } = useAppStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const [passwordMode, setPasswordMode] = useState(!privyEnabled)
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [refFromLink, setRefFromLink] = useState(false)
  const [showReferralCode, setShowReferralCode] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [referralError, setReferralError] = useState('')
  const [success, setSuccess] = useState('')
  const [verificationLink, setVerificationLink] = useState('')

  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.replace('/dashboard') }, [authResolved, isAuthenticated, router])
  useEffect(() => {
    const referral = searchParams.get('ref')?.trim().toUpperCase() ?? ''
    if (referral) { setReferralCode(referral); setRefFromLink(true); setShowReferralCode(true) }
  }, [searchParams])

  const fieldErrors = validateProfileFields({ name, email, phone })
  const match = confirmPassword.length > 0 && confirmPassword === password
  const showFieldError = (key: keyof typeof fieldErrors) => touched[key] ? fieldErrors[key] : undefined
  const progress = step === 1 ? 1 : (Number(isPasswordValid(password)) + Number(match) + Number(termsAccepted)) / 3

  function markTouched(key: string) { setTouched(current => ({ ...current, [key]: true })) }
  function continueToSecurity() {
    setTouched({ name: true, email: true, phone: true })
    if (fieldErrors.name) { nameRef.current?.focus(); return }
    if (fieldErrors.email) { emailRef.current?.focus(); return }
    if (fieldErrors.phone) { phoneRef.current?.focus(); return }
    setStep(2)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (step === 1) { continueToSecurity(); return }
    if (!isPasswordValid(password)) { setTouched(current => ({ ...current, password: true })); setError('Use at least 8 characters with a letter and a number.'); return }
    if (!match) { setTouched(current => ({ ...current, confirmPassword: true })); setError("Passwords don't match."); return }
    if (!termsAccepted) { setError('Please accept the Terms of Service and Privacy Policy.'); return }

    setLoading(true)
    try {
      const result = await register({ name: name.trim(), email: email.trim().toLowerCase(), phone: phoneFromChipInput(phone), password, referralCode: referralCode.trim().toUpperCase() || undefined })
      setSuccess(result.message || 'We sent a verification link to your email address.')
      setVerificationLink(result.verificationLink || '')
      setStep(1)
      setPassword('')
      setConfirmPassword('')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to create account.'
      if (/referral code is invalid/i.test(message)) setReferralError(message)
      else if (/email/i.test(message) && /already exists/i.test(message)) { markTouched('email'); setError(message) }
      else if (/phone number/i.test(message) && /already exists/i.test(message)) { markTouched('phone'); setError(message) }
      else setError(message)
    } finally { setLoading(false) }
  }

  function switchMode(nextPasswordMode: boolean) {
    setError(''); setStep(1); setEmailCodeSent(false); setPasswordMode(nextPasswordMode)
  }

  if (success) return <AuthSplitShell><CheckEmailPanel email={email} verificationLink={verificationLink} onBack={() => router.push('/login')} /></AuthSplitShell>

  return <AuthSplitShell><div className="flex min-h-full flex-col">
    <AuthTopNav onBack={() => step === 2 ? setStep(1) : router.push('/login')} />
    <AuthStepper step={step} label={step === 1 ? 'Your details' : 'Security'} progress={progress} />
    <div className="mt-7">
      <h1 className="font-display text-[29px] md:text-[24px] font-bold leading-[1.12] tracking-[-.4px] text-[var(--text)]">{step === 1 ? 'Open your wallet in 2 minutes' : 'Secure your account'}</h1>
      <p className="mt-3 text-[15px] leading-[1.5] text-[var(--text2)]">{step === 1 ? 'Just a few details to get you started.' : 'Choose a strong password to protect your wallet and money.'}</p>
    </div>

    {(refFromLink || showReferralCode) ? <div className="mt-[18px] flex items-start gap-3 rounded-2xl border border-[var(--success-ring)] bg-[linear-gradient(135deg,rgba(72,204,120,.12),var(--gold-tint))] p-3 pl-3.5">
      <div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl bg-[rgba(72,204,120,.16)] text-[var(--success-text)]"><Gift size={20} /></div>
      <div className="min-w-0 flex-1"><b className="block text-[14.5px] font-semibold text-[var(--text)]">You were invited by a friend 🎉</b>
        <div className="mt-1.5 flex items-center justify-between gap-2"><span className="text-[13px] text-[var(--text2)]">{referralError || 'Referral code added'}</span><span className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-[var(--gold)] bg-[var(--coal)] px-2.5 font-mono text-[13px] font-bold tracking-[.8px] text-[var(--gold2)]"><small className="font-sans text-[10.5px] tracking-[.6px] text-[var(--muted)]">REF</small>{referralCode || '—'}</span></div>
        {referralError ? <button type="button" className="mt-1 inline-flex min-h-11 items-center text-[13px] font-semibold text-[var(--gold2)]" onClick={() => { setReferralCode(''); setRefFromLink(false); setShowReferralCode(false); setReferralError('') }}>Remove code</button> : null}
      </div>
    </div> : null}

    {passwordMode ? <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-5">
      {step === 1 ? <>
        <Input ref={nameRef} variant="auth" label="Full name" autoComplete="name" placeholder="Your full name" leadingIcon={<User size={20} />} value={name} onChange={event => setName(event.target.value)} onBlur={() => markTouched('name')} error={showFieldError('name')} />
        <Input ref={emailRef} variant="auth" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" leadingIcon={<Mail size={20} />} trailing={showFieldError('email') ? <AlertCircle size={20} className="text-[var(--danger-text)]" /> : null} value={email} onChange={event => setEmail(event.target.value)} onBlur={() => markTouched('email')} error={showFieldError('email')} />
        <Input ref={phoneRef} variant="auth" label="Phone number" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="803 123 4567" prefix={<span className="-ml-2 flex h-9 items-center gap-[7px] rounded-[10px] border border-[var(--border)] bg-[var(--clay)] px-[11px] text-[15px] font-semibold text-[var(--text)]"><span aria-hidden="true" className="text-[17px] leading-none">🇳🇬</span>+234</span>} value={phone} onChange={event => setPhone(event.target.value)} onBlur={() => markTouched('phone')} error={showFieldError('phone')} />
        {!refFromLink && !showReferralCode ? <button type="button" onClick={() => setShowReferralCode(true)} className="inline-flex min-h-11 self-start items-center text-[14.5px] font-semibold text-[var(--gold2)]">Add a referral code</button> : null}
        {showReferralCode && !refFromLink ? <Input variant="auth" label="Referral code" placeholder="Optional" value={referralCode} onChange={event => setReferralCode(event.target.value.toUpperCase())} /> : null}
      </> : <>
        <PasswordInput label="Create password" autoComplete="new-password" placeholder="Create a password" aria-describedby="password-strength" value={password} onChange={event => { setPassword(event.target.value); setError('') }} onBlur={() => markTouched('password')} error={touched.password && !isPasswordValid(password) ? 'Use at least 8 characters with a letter and a number.' : undefined} />
        <PasswordStrength id="password-strength" password={password} />
        <PasswordInput label="Confirm password" autoComplete="new-password" placeholder="Enter password again" status={match ? 'success' : 'default'} statusIcon={match ? <CheckCircle2 size={20} className="text-[var(--success-text)]" /> : undefined} hint={match ? <><Check size={16} />Passwords match</> : undefined} hintTone="success" error={touched.confirmPassword && !match ? "Passwords don't match" : undefined} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} onBlur={() => markTouched('confirmPassword')} />
        <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-[1.5] text-[var(--text2)]"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-1 h-[22px] w-[22px] shrink-0 accent-[var(--gold)]" /><span>I agree to MafitaPay&apos;s {TERMS_URL ? <a href={TERMS_URL} className="font-semibold text-[var(--gold2)] underline underline-offset-2">Terms of Service</a> : <span>Terms of Service</span>} and {PRIVACY_URL ? <a href={PRIVACY_URL} className="font-semibold text-[var(--gold2)] underline underline-offset-2">Privacy Policy</a> : <span>Privacy Policy</span>}.</span></label>
      </>}
      {error ? <div role="alert" className="text-[13.5px] text-[var(--danger-text)]">{error}</div> : null}
      <Button type="submit" variant="gold" size="xl" loading={loading} className="w-full">{step === 1 ? <>Continue <span aria-hidden="true">→</span></> : 'Create account'}</Button>
    </form> : <div className="mt-6 flex flex-col gap-5">
      {!emailCodeSent ? <>
        <Input variant="auth" label="Full name" autoComplete="name" leadingIcon={<User size={20} />} value={name} onChange={event => setName(event.target.value)} />
        <Input variant="auth" label="Email address" type="email" inputMode="email" autoComplete="email" leadingIcon={<Mail size={20} />} value={email} onChange={event => setEmail(event.target.value)} />
        <Input variant="auth" label="Phone number" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="803 123 4567" prefix={<span className="-ml-2 flex h-9 items-center gap-[7px] rounded-[10px] border border-[var(--border)] bg-[var(--clay)] px-[11px] text-[15px] font-semibold text-[var(--text)]">🇳🇬 +234</span>} value={phone} onChange={event => setPhone(event.target.value)} />
        {!refFromLink && !showReferralCode ? <button type="button" onClick={() => setShowReferralCode(true)} className="inline-flex min-h-11 self-start items-center text-[14.5px] font-semibold text-[var(--gold2)]">Add a referral code</button> : null}
        {showReferralCode && !refFromLink ? <Input variant="auth" label="Referral code" value={referralCode} onChange={event => setReferralCode(event.target.value.toUpperCase())} /> : null}
      </> : null}
      <PrivyAuthAction intent="register" email={email.trim().toLowerCase()} onCodeSentChange={setEmailCodeSent} profile={{ name, email, phone: phoneFromChipInput(phone), referralCode }} />
      {!emailCodeSent ? <p className="text-[13px] leading-relaxed text-[var(--muted)]">By creating an account, you agree to our {TERMS_URL ? <a href={TERMS_URL} className="text-[var(--gold2)] underline">Terms of Service</a> : <span>Terms of Service</span>} and {PRIVACY_URL ? <a href={PRIVACY_URL} className="text-[var(--gold2)] underline">Privacy Policy</a> : <span>Privacy Policy</span>}.</p> : null}
    </div>}

    {privyEnabled ? <button type="button" onClick={() => switchMode(!passwordMode)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center text-[14.5px] font-semibold text-[var(--gold2)]">Use {passwordMode ? 'email code' : 'password'} instead</button> : null}
    <div className="mt-auto pt-6 text-center text-[15px] text-[var(--text2)]">Already have an account? <button type="button" className="inline-flex min-h-11 items-center font-semibold text-[var(--gold2)]" onClick={() => router.push('/login')}>Sign in</button></div>
  </div></AuthSplitShell>
}
