'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store'

export default function ResetPasswordPage() {
  const { authResolved, isAuthenticated, theme } = useAppStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.push('/dashboard') }, [authResolved, isAuthenticated, router])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    if (!token) {
      setError('This reset link is missing its token.')
      setLoading(false)
      return
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Password must be at least 8 characters and include both letters and numbers.')
      setLoading(false)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Unable to reset password.')
      setMessage(payload.data?.message || 'Password reset successful.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.')
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
          <div className="mt-1 text-[10px] uppercase tracking-widest text-[var(--muted)]">Set New Password</div>
        </div>

        <div className="border border-[var(--border)] bg-[var(--coal)]">
          <div className="ank-strip" />
          <div className="p-7">
            <div className="mb-1 font-display text-[22px] font-black text-[var(--text)]">Choose a New Password</div>
            <div className="mb-6 text-[12px] text-[var(--muted)]">Use at least 8 characters with both letters and numbers.</div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="New Password"
                type="password"
                placeholder="At least 8 chars with letters and numbers"
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
              <Input
                label="Confirm New Password"
                type="password"
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
              />

              {error && <div className="border border-[rgba(196,52,26,.2)] bg-[rgba(196,52,26,.08)] px-3 py-2 text-[11px] text-[var(--red2)]">{error}</div>}
              {message && <div className="border border-[var(--border)] bg-[var(--clay)] px-3 py-3 text-[11px] text-[var(--text2)]">{message}</div>}

              <Button type="submit" loading={loading} className="mt-1 w-full py-3.5">Reset Password</Button>
            </form>

            <div className="mt-5 text-center text-[12px] text-[var(--muted)]">
              Back to{' '}
              <span className="cursor-pointer font-bold text-[var(--gold2)]" onClick={() => router.push('/login')}>
                sign in →
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
