'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store'

export default function ForgotPasswordPage() {
  const { authResolved, isAuthenticated, theme } = useAppStore()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [resetLink, setResetLink] = useState('')
  const [deliverySummary, setDeliverySummary] = useState('')

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.push('/dashboard') }, [authResolved, isAuthenticated, router])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    setResetLink('')
    setDeliverySummary('')

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Unable to start password reset.')
      setMessage(payload.data?.message || 'Password reset instructions prepared.')
      if (typeof payload.data?.resetLink === 'string') setResetLink(payload.data.resetLink)
      if (Array.isArray(payload.data?.delivery?.attempts)) {
        const summary = payload.data.delivery.attempts
          .map((item: { channel: string; provider: string; delivered: boolean }) => `${item.channel}:${item.delivered ? 'sent' : 'skipped'} (${item.provider})`)
          .join(' · ')
        setDeliverySummary(summary)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start password reset.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden">
            <img src="/mafitapay-logo.jpg" alt="MafitaPay logo" className="h-20 w-20 object-contain" />
          </div>
          <div className="font-display text-3xl font-black text-[var(--text)]">MafitaPay</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-[var(--muted)]">Password Recovery</div>
        </div>

        <div className="border border-[var(--border)] bg-[var(--coal)]">
          <div className="ank-strip" />
          <div className="p-7">
            <div className="mb-1 font-display text-[22px] font-black text-[var(--text)]">Reset Password</div>
            <div className="mb-6 text-[12px] text-[var(--muted)]">Enter your email address to generate a reset link.</div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Email Address"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
              />

              {error && <div className="border border-[rgba(196,52,26,.2)] bg-[rgba(196,52,26,.08)] px-3 py-2 text-[11px] text-[var(--red2)]">{error}</div>}
              {message && <div className="border border-[var(--border)] bg-[var(--clay)] px-3 py-3 text-[11px] text-[var(--text2)]">{message}</div>}
              {resetLink && (
                <div className="border border-[rgba(202,165,96,.25)] bg-[rgba(202,165,96,.08)] px-3 py-3 text-[11px] text-[var(--text2)]">
                  <div className="font-bold text-[var(--gold2)]">Local fallback reset link</div>
                  <a className="mt-2 block break-all underline" href={resetLink}>{resetLink}</a>
                </div>
              )}
              {deliverySummary && (
                <div className="border border-[var(--border)] bg-[var(--clay)] px-3 py-3 text-[10px] text-[var(--muted)]">
                  Delivery: {deliverySummary}
                </div>
              )}

              <Button type="submit" loading={loading} className="mt-1 w-full py-3.5">Generate Reset Link</Button>
            </form>

            <div className="mt-5 text-center text-[12px] text-[var(--muted)]">
              Remembered your password?{' '}
              <span className="cursor-pointer font-bold text-[var(--gold2)]" onClick={() => router.push('/login')}>
                Back to sign in →
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
