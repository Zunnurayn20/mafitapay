'use client'

import { useEffect, useRef, useState } from 'react'
import { Lock, Mail } from 'lucide-react'
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

const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)

export default function LoginPage() {
  const { authResolved, login, isAuthenticated, theme } = useAppStore()
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

  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.replace('/dashboard') }, [authResolved, isAuthenticated, router])

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
      router.replace('/dashboard')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to sign in.'
      if (/email address/i.test(message) && /verify/i.test(message)) setEmailTouched(true)
      setCanResendVerification(/verify your email/i.test(message))
      setError(message)
    } finally { setLoading(false) }
  }

  const compactHeader = !showCheckEmail && (mode === 'password' || !emailCodeSent) ? <AuthBrandHeader /> : null
  return <AuthSplitShell compactHeader={compactHeader}>
    {showCheckEmail ? <CheckEmailPanel email={normalizedEmail} onBack={() => setShowCheckEmail(false)} /> : <div className="mt-8 flex flex-col gap-6">
      <header className="text-center">
        <h1 className="font-display text-[32px] md:text-[24px] font-bold leading-[1.12] tracking-[-.4px] text-[var(--text)]">Welcome back</h1>
        <p className="mt-3 text-[15px] leading-[1.5] text-[var(--text2)]">Sign in to send, receive and pay bills from your secure wallet.</p>
      </header>

      {privyEnabled ? <SegmentedControl value={mode} onChange={value => { setMode(value as 'code' | 'password'); setError(''); setEmailCodeSent(false) }} options={[
        { value: 'code', label: 'Email code', icon: <Mail size={17} /> },
        { value: 'password', label: 'Password', icon: <Lock size={17} /> },
      ]} /> : null}

      {mode === 'password' ? <form onSubmit={handleLogin} noValidate className="flex flex-col gap-5">
        <Input ref={emailRef} variant="auth" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" leadingIcon={<Mail size={20} />} value={email} onChange={event => { setEmail(event.target.value); setError('') }} onBlur={() => setEmailTouched(true)} error={emailError || undefined} />
        <PasswordInput ref={passwordRef} label="Password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={event => { setPassword(event.target.value); setError('') }} onBlur={() => setPasswordTouched(true)} error={passwordError || undefined} />
        <div className="-mt-2 flex justify-end"><button type="button" onClick={() => router.push('/forgot-password')} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-[var(--gold2)]">Forgot password?</button></div>
        {error ? <div role="alert" className="text-[13.5px] text-[var(--danger-text)]">{error}</div> : null}
        {canResendVerification ? <button type="button" className="inline-flex min-h-11 items-center justify-center text-[14px] font-semibold text-[var(--gold2)]" onClick={() => setShowCheckEmail(true)}>Resend verification email</button> : null}
        <Button type="submit" variant="gold" size="xl" loading={loading} className="w-full">Sign in <span aria-hidden="true">→</span></Button>
      </form> : <div className="flex flex-col gap-5">
        {!emailCodeSent ? <Input variant="auth" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" leadingIcon={<Mail size={20} />} value={email} onChange={event => setEmail(event.target.value)} onBlur={() => setEmailTouched(true)} error={emailError || undefined} /> : null}
        <PrivyAuthAction intent="login" email={normalizedEmail} onCodeSentChange={setEmailCodeSent} />
      </div>}

      <div className="mt-auto pt-2 text-center text-[15px] text-[var(--text2)]">New to MafitaPay? <button type="button" className="inline-flex min-h-11 items-center font-semibold text-[var(--gold2)]" onClick={() => router.push('/register')}>Create account</button></div>
    </div>}
  </AuthSplitShell>
}
