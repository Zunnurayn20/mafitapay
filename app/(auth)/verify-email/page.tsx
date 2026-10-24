'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mail, RotateCcw } from 'lucide-react'
import { AuthSplitShell } from '@/components/auth/AuthSplitShell'
import { AuthBrandHeader, AuthTopNav } from '@/components/auth/AuthBrand'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EMAIL_RE } from '@/lib/auth/validation'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/client/native-system-bars'

export default function VerifyEmailPage() {
  const { authResolved, isAuthenticated, refreshSession, theme } = useAppStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('Verifying your email address…')
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [resendNotice, setResendNotice] = useState('')
  const [resendLink, setResendLink] = useState('')
  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.replace('/dashboard') }, [authResolved, isAuthenticated, router])
  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setTimeout(() => setResendSeconds(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])

  useEffect(() => {
    const token = searchParams.get('token')?.trim() || ''
    if (!token) { setLoading(false); setError('Verification token is missing.'); setMessage(''); return }
    let cancelled = false
    async function verify() {
      try {
        const response = await fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
        const payload = await response.json()
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Unable to verify email.')
        if (!cancelled) { setMessage(payload.data?.message || 'Email verified successfully.'); setError(''); await refreshSession(); router.replace('/dashboard') }
      } catch (caught) { if (!cancelled) { setError(caught instanceof Error ? caught.message : 'Unable to verify email.'); setMessage('') } }
      finally { if (!cancelled) setLoading(false) }
    }
    void verify()
    return () => { cancelled = true }
  }, [refreshSession, router, searchParams])

  async function resendVerification(event: React.FormEvent) {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalizedEmail) || resendSeconds > 0 || resendLoading) return

    setResendLoading(true)
    setResendNotice('')
    setResendLink('')
    try {
      const response = await fetch('/api/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      })
      const payload = await response.json().catch(() => null)
      const retryAfter = Number(payload?.data?.retryAfterSeconds ?? payload?.retryAfterSeconds ?? response.headers.get('Retry-After') ?? 45)
      if (response.status === 429) {
        setResendSeconds(Math.max(1, retryAfter))
        setResendNotice(payload?.error || 'Please wait before requesting another link.')
        return
      }
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Unable to request a new verification link.')

      setResendNotice(payload?.data?.message || "If an account is waiting for verification, we've sent a new link.")
      setResendLink(typeof payload?.data?.verificationLink === 'string' ? payload.data.verificationLink : '')
      setResendSeconds(Math.max(1, retryAfter))
    } catch (caught) {
      setResendNotice(caught instanceof Error ? caught.message : 'Unable to request a new verification link.')
    } finally {
      setResendLoading(false)
    }
  }

  return <AuthSplitShell compactHeader={<AuthBrandHeader />}><div className="flex min-h-full flex-col">
    <AuthTopNav onBack={() => router.push('/login')} />
    <div className="my-auto py-10 text-center">
      <h1 className="font-display text-[29px] md:text-[24px] font-bold text-[var(--text)]">Verify your email</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[var(--text2)]">{loading ? 'Confirming your email address now.' : message}</p>
      {error ? <div role="alert" className="mt-4 text-[13.5px] text-[var(--danger-text)]">{error}</div> : null}
      {!loading && error ? <div className="mt-6 text-left">
        <p className="text-[13px] leading-relaxed text-[var(--text2)]">Enter the email you registered with to request a fresh link. If your account is already verified, sign in instead.</p>
        <form onSubmit={resendVerification} className="mt-4 flex flex-col gap-4">
          <Input variant="auth" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" leadingIcon={<Mail size={20} />} value={email} onChange={event => setEmail(event.target.value)} />
          <Button type="submit" variant="outline" size="xl" className="w-full" disabled={!EMAIL_RE.test(email.trim()) || resendSeconds > 0 || resendLoading} loading={resendLoading}>
            <RotateCcw size={18} />
            {resendSeconds > 0 ? `Resend in ${Math.floor(resendSeconds / 60)}:${String(resendSeconds % 60).padStart(2, '0')}` : 'Resend verification email'}
          </Button>
        </form>
        {resendNotice ? <p role="status" aria-live="polite" className="mt-3 break-words text-[13px] text-[var(--text2)]">{resendNotice}</p> : null}
        {process.env.NODE_ENV !== 'production' && resendLink ? <a className="mt-2 block break-all text-left text-[13px] text-[var(--gold2)] underline" href={resendLink}>Open verification link</a> : null}
      </div> : null}
      <Button variant="gold" size="xl" className="mt-7 w-full" loading={loading} disabled={loading} onClick={() => router.push('/login')}>Go to sign in</Button>
    </div>
  </div></AuthSplitShell>
}
