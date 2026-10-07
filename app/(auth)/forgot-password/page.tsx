'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail } from 'lucide-react'
import { AuthSplitShell } from '@/components/auth/AuthSplitShell'
import { AuthBrandHeader, AuthTopNav } from '@/components/auth/AuthBrand'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/client/native-system-bars'

export default function ForgotPasswordPage() {
  const { authResolved, isAuthenticated, theme } = useAppStore()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [resetLink, setResetLink] = useState('')
  const [deliverySummary, setDeliverySummary] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.replace('/dashboard') }, [authResolved, isAuthenticated, router])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setMessage(''); setResetLink(''); setDeliverySummary('')
    try {
      const response = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim().toLowerCase() }) })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Unable to start password reset.')
      setMessage(payload.data?.message || 'Password reset instructions prepared.')
      if (typeof payload.data?.resetLink === 'string') setResetLink(payload.data.resetLink)
      if (Array.isArray(payload.data?.delivery?.attempts)) setDeliverySummary(payload.data.delivery.attempts.map((item: { channel: string; provider: string; delivered: boolean }) => `${item.channel}:${item.delivered ? 'sent' : 'skipped'} (${item.provider})`).join(' · '))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to start password reset.') }
    finally { setLoading(false) }
  }

  return <AuthSplitShell compactHeader={<AuthBrandHeader />}><div className="flex min-h-full flex-col">
    <AuthTopNav onBack={() => router.push('/login')} />
    <div className="my-auto py-8">
      <h1 className="font-display text-[29px] md:text-[24px] font-bold text-[var(--text)]">Reset your password</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--text2)]">Enter your email address and we will send instructions to reset your password.</p>
      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
        <Input variant="auth" label="Email address" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" leadingIcon={<Mail size={20} />} value={email} onChange={event => setEmail(event.target.value)} onBlur={() => setTouched(true)} error={touched && !/^\S+@\S+\.\S+$/.test(email.trim()) ? (email.trim() ? "That email doesn't look right" : 'Enter your email address') : undefined} />
        {error ? <div role="alert" className="text-[13.5px] text-[var(--danger-text)]">{error}</div> : null}
        {message ? <div role="status" className="text-[13.5px] text-[var(--text2)]">{message}</div> : null}
        {process.env.NODE_ENV !== 'production' && resetLink ? <div className="break-all rounded-xl border border-dashed border-[var(--border)] p-3 text-[13px]"><b>Dev only — local reset link</b><a className="mt-2 block text-[var(--gold2)] underline" href={resetLink}>{resetLink}</a></div> : null}
        {process.env.NODE_ENV !== 'production' && deliverySummary ? <div className="text-[13px] text-[var(--muted)]">Delivery: {deliverySummary}</div> : null}
        <Button type="submit" variant="gold" size="xl" loading={loading} className="w-full">Send reset instructions</Button>
      </form>
    </div>
    <p className="mt-auto pt-5 text-center text-[15px] text-[var(--text2)]">Remembered your password? <button type="button" className="inline-flex min-h-11 items-center font-semibold text-[var(--gold2)]" onClick={() => router.push('/login')}>Sign in</button></p>
  </div></AuthSplitShell>
}
