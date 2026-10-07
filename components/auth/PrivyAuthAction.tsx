'use client'

import { getIdentityToken, useLoginWithEmail, usePrivy } from '@privy-io/react-auth'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore, type SessionData } from '@/store'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { phoneFromChipInput, validateProfileFields } from '@/lib/auth/validation'

type PrivyAuthActionProps = {
  intent: 'login' | 'register'
  email?: string
  onCodeSentChange: (sent: boolean) => void
  profile?: { name: string; email: string; phone: string; referralCode?: string }
}

export function PrivyAuthAction({ intent, email = '', onCodeSentChange, profile }: PrivyAuthActionProps) {
  const router = useRouter()
  const acceptAuthenticatedUser = useAppStore(state => state.acceptAuthenticatedUser)
  const refreshSession = useAppStore(state => state.refreshSession)
  const { authenticated: privyAuthenticated, logout: logoutPrivy } = usePrivy()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeEmail, setCodeEmail] = useState('')

  const { sendCode, loginWithCode } = useLoginWithEmail({
    onComplete: () => { void finishSignIn() },
    onError: () => setError('The email code could not be verified. Check the code and try again.'),
  })

  async function finishSignIn() {
    setLoading(true); setError('')
    try {
      const identityToken = await getIdentityToken()
      if (!identityToken) throw new Error('Privy did not return a sign-in token. Please try again.')
      const response = await fetch('/api/auth/privy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ intent, email: codeEmail, identityToken, profile: profile ? {
          name: profile.name.trim(), phone: phoneFromChipInput(profile.phone), referralCode: profile.referralCode?.trim().toUpperCase() || undefined,
        } : undefined }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to sign in with Privy.')
      if (!payload?.data?.user) throw new Error('MafitaPay could not load your account. Please try again.')
      acceptAuthenticatedUser(payload.data.user as SessionData['user'])
      router.replace('/dashboard')
      void refreshSession()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to sign in with Privy.') }
    finally { setLoading(false) }
  }

  async function requestEmailCode(targetEmail = profile?.email ?? email) {
    const normalizedEmail = targetEmail.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) { setError('Enter a valid email address first.'); return }
    setLoading(true); setError(''); setCodeEmail(normalizedEmail)
    try {
      if (privyAuthenticated) await logoutPrivy()
      await sendCode({ email: normalizedEmail })
      setCode(''); setCodeSent(true); onCodeSentChange(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to send an email code. Please try again.') }
    finally { setLoading(false) }
  }

  function startSignIn() {
    setError('')
    if (intent === 'register') {
      const validation = validateProfileFields({ name: profile?.name ?? '', email: profile?.email ?? '', phone: profile?.phone ?? '' })
      if (Object.keys(validation).length) { setError(Object.values(validation)[0] || 'Enter your account details first.'); return }
    }
    setCode(''); setCodeSent(false); onCodeSentChange(false); void requestEmailCode()
  }

  async function verifyEmailCode() {
    if (!code.trim()) { setError('Enter the code we sent to your email.'); return }
    setLoading(true); setError('')
    try { await loginWithCode({ code: code.trim() }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'That code could not be verified. Please try again.') }
    finally { setLoading(false) }
  }

  function changeEmail() { setError(''); setCode(''); setCodeSent(false); setCodeEmail(''); onCodeSentChange(false) }

  return <div className="flex flex-col gap-3">
    {!codeSent ? <Button type="button" variant="gold" size="xl" className="w-full" loading={loading} onClick={startSignIn}>{intent === 'register' ? 'Create account with email code' : 'Continue with email code'}</Button> : <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--coal)] p-4">
      <div className="text-[15px] font-semibold text-[var(--text)]">Check your email</div>
      <p className="text-[13.5px] text-[var(--text2)]">Enter the verification code sent to {codeEmail}.</p>
      <Input variant="auth" label="Email code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus value={code} onChange={event => setCode(event.target.value.replace(/\s/g, ''))} placeholder="Enter code" />
      <Button type="button" variant="gold" size="xl" className="w-full" loading={loading} onClick={verifyEmailCode}>Verify code</Button>
      <button type="button" className="inline-flex min-h-11 w-full items-center justify-center text-[14px] text-[var(--gold2)]" disabled={loading} onClick={() => { void requestEmailCode(codeEmail) }}>Send a new code</button>
      <button type="button" className="inline-flex min-h-11 w-full items-center justify-center text-[14px] text-[var(--muted)]" disabled={loading} onClick={changeEmail}>Change email</button>
    </div>}
    {error ? <div role="alert" className="text-[13.5px] text-[var(--danger-text)]">{error}</div> : null}
  </div>
}
