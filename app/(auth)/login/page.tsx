'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Fingerprint, Lock, Mail } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AuthSplitShell } from '@/components/auth/AuthSplitShell'
import { AuthBrandHeader } from '@/components/auth/AuthBrand'
import { SegmentedControl } from '@/components/auth/SegmentedControl'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PrivyAuthAction } from '@/components/auth/PrivyAuthAction'
import { CheckEmailPanel } from '@/components/auth/CheckEmailPanel'
import { EMAIL_RE } from '@/lib/auth/validation'
import { applyTheme } from '@/lib/client/native-system-bars'
import { useAppStore } from '@/store'
import { canBridgeDeviceLogin, DEVICE_LOGIN_ENROLL_EVENT, forgetFingerprintLogin, getDeviceLoginHint, signInWithFingerprint, type DeviceLoginHint } from '@/lib/client/device-login'

const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)

export default function LoginPage() {
  const { authResolved, login, isAuthenticated, theme, acceptSession } = useAppStore()
  const router = useRouter()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'code' | 'password'>(privyEnabled ? 'password' : 'password')
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [error, setError] = useState('')
  const [canResendVerification, setCanResendVerification] = useState(false)
  const [showCheckEmail, setShowCheckEmail] = useState(false)
  const [deviceHint, setDeviceHint] = useState<DeviceLoginHint | null>(null)
  const [deviceLoginLoading, setDeviceLoginLoading] = useState(false)
  const [deviceLoginError, setDeviceLoginError] = useState('')
  const fingerprintAttempted = useRef(false)

  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.replace('/dashboard') }, [authResolved, isAuthenticated, router])
  const handleFingerprintLogin = useCallback(async () => {
    if (deviceLoginLoading) return
    setDeviceLoginLoading(true)
    setDeviceLoginError('')
    try {
      const session = await signInWithFingerprint()
      acceptSession(session)
      router.replace('/dashboard')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Fingerprint sign-in could not be completed.'
      if (!/cancel|canceled|cancelled/i.test(message)) setDeviceLoginError(message)
      if (!getDeviceLoginHint()) setDeviceHint(null)
    } finally { setDeviceLoginLoading(false) }
  }, [acceptSession, deviceLoginLoading, router])

  useEffect(() => {
    if (!authResolved || isAuthenticated || !canBridgeDeviceLogin()) return
    const hint = getDeviceLoginHint()
    setDeviceHint(hint)
    if (!hint || fingerprintAttempted.current) return
    fingerprintAttempted.current = true
    void handleFingerprintLogin()
    // Auto-prompt once for this page visit; failures leave the email and password form usable.
  }, [authResolved, handleFingerprintLogin, isAuthenticated])

  async function handleForgetFingerprint() {
    await forgetFingerprintLogin()
    setDeviceHint(null)
    setDeviceLoginError('')
  }

  const normalizedEmail = email.trim().toLowerCase()
  const emailError = (emailTouched || submitAttempted) ? (!normalizedEmail ? 'Enter your email address' : !EMAIL_RE.test(normalizedEmail) ? "That email doesn't look right" : '') : ''
  const passwordError = (passwordTouched || submitAttempted) && !password ? 'Enter your password' : ''

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setSubmitAttempted(true)
    setEmailTouched(true)
    setPasswordTouched(true)
    setError('')
    if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) { emailRef.current?.focus(); return }
    if (!password) { passwordRef.current?.focus(); return }
    setLoading(true)
    try {
      await login(normalizedEmail, password)
      window.dispatchEvent(new Event(DEVICE_LOGIN_ENROLL_EVENT))
      router.replace('/dashboard')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to sign in.'
      if (/email address/i.test(message) && /verify/i.test(message)) setEmailTouched(true)
      setCanResendVerification(/verify your email/i.test(message))
      setError(message)
    } finally { setLoading(false) }
  }

  const compactHeader = !showCheckEmail && (mode === 'password' || !emailCodeSent) ? <AuthBrandHeader /> : null
  return <AuthSplitShell compactHeader={compactHeader} centered={Boolean(deviceHint)}>
    {showCheckEmail ? <CheckEmailPanel email={normalizedEmail} onBack={() => setShowCheckEmail(false)} /> : <div className={`flex flex-col gap-6 ${deviceHint ? 'mt-0' : 'mt-8'}`}>
      {!deviceHint ? <header className="text-center">
        <h1 className="font-display text-[32px] md:text-[24px] font-bold leading-[1.12] tracking-[-.4px] text-[var(--text)]">Welcome back</h1>
        <p className="mt-3 text-[15px] leading-[1.5] text-[var(--text2)]">Sign in to send, receive and pay bills from your secure wallet.</p>
      </header> : null}

      {deviceHint ? <section className="rounded-2xl border border-[var(--gold)]/35 bg-[var(--coal)] p-4 text-center">
        <p className="text-sm font-semibold text-[var(--text)]">Welcome back, {deviceHint.emailMasked}</p>
        <button type="button" aria-label="Sign in with fingerprint" onClick={() => void handleFingerprintLogin()} disabled={deviceLoginLoading} className="mx-auto mt-3 grid h-16 w-16 place-items-center rounded-full border-2 border-[var(--gold)] bg-[var(--gold-tint)] text-[var(--gold2)] shadow-[0_0_0_6px_var(--gold-tint)] disabled:opacity-60">
          <Fingerprint size={30} />
        </button>
        <p className="mt-3 text-xs text-[var(--muted)]">{deviceLoginLoading ? 'Checking fingerprint…' : 'Use your fingerprint to sign in'}</p>
        <button type="button" onClick={() => void handleForgetFingerprint()} className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-[var(--gold2)]">Not you? Use email instead</button>
        {deviceLoginError ? <p role="alert" className="mt-2 text-sm text-[var(--danger-text)]">{deviceLoginError}</p> : null}
      </section> : null}
      {!deviceHint && deviceLoginError ? <p role="alert" className="text-center text-sm text-[var(--danger-text)]">{deviceLoginError}</p> : null}

      {!deviceHint && privyEnabled ? <SegmentedControl value={mode} onChange={value => { setMode(value as 'code' | 'password'); setError(''); setEmailCodeSent(false) }} options={[
        { value: 'code', label: 'Email code', icon: <Mail size={17} /> },
        { value: 'password', label: 'Password', icon: <Lock size={17} /> },
      ]} /> : null}

      {!deviceHint ? mode === 'password' ? <form onSubmit={handleLogin} noValidate className="flex flex-col gap-5">
        <Input ref={emailRef} variant="auth" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" leadingIcon={<Mail size={20} />} value={email} onChange={event => { setEmail(event.target.value); setError('') }} onBlur={() => setEmailTouched(true)} error={emailError || undefined} />
        <PasswordInput ref={passwordRef} label="Password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={event => { setPassword(event.target.value); setError('') }} onBlur={() => setPasswordTouched(true)} error={passwordError || undefined} />
        <div className="-mt-2 flex justify-end"><button type="button" onClick={() => router.push('/forgot-password')} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-[var(--gold2)]">Forgot password?</button></div>
        {error ? <div role="alert" className="text-[13.5px] text-[var(--danger-text)]">{error}</div> : null}
        {canResendVerification ? <button type="button" className="inline-flex min-h-11 items-center justify-center text-[14px] font-semibold text-[var(--gold2)]" onClick={() => setShowCheckEmail(true)}>Resend verification email</button> : null}
        <Button type="submit" variant="gold" size="xl" loading={loading} className="w-full">Sign in <span aria-hidden="true">→</span></Button>
      </form> : <div className="flex flex-col gap-5">
        {!emailCodeSent ? <Input variant="auth" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" leadingIcon={<Mail size={20} />} value={email} onChange={event => setEmail(event.target.value)} onBlur={() => setEmailTouched(true)} error={emailError || undefined} /> : null}
        <PrivyAuthAction intent="login" email={normalizedEmail} onCodeSentChange={setEmailCodeSent} />
      </div> : null}

      {!deviceHint ? <div className="mt-auto pt-2 text-center text-[15px] text-[var(--text2)]">New to MafitaPay? <button type="button" className="inline-flex min-h-11 items-center font-semibold text-[var(--gold2)]" onClick={() => router.push('/register')}>Create account</button></div> : null}
    </div>}
  </AuthSplitShell>
}
