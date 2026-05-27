'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store'

export default function VerifyEmailPage() {
  const { authResolved, isAuthenticated, refreshSession, theme } = useAppStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('Verifying your email address...')
  const [error, setError] = useState('')

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.push('/dashboard') }, [authResolved, isAuthenticated, router])

  useEffect(() => {
    const token = searchParams.get('token')?.trim() || ''
    if (!token) {
      setLoading(false)
      setError('Verification token is missing.')
      setMessage('')
      return
    }

    let cancelled = false
    async function verify() {
      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Unable to verify email.')
        }
        if (!cancelled) {
          setMessage(payload.data?.message || 'Email verified successfully. Continue your account setup.')
          setError('')
          await refreshSession()
          router.replace('/dashboard')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to verify email.')
          setMessage('')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void verify()
    return () => {
      cancelled = true
    }
  }, [refreshSession, router, searchParams])

  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden">
            <img src="/mafitapay-logo.png" alt="MafitaPay logo" className="h-20 w-20 object-contain" />
          </div>
          <div className="font-display text-3xl font-black text-[var(--text)]">MafitaPay</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-[var(--muted)]">Email Verification</div>
        </div>

        <div className="border border-[var(--border)] bg-[var(--coal)]">
          <div className="ank-strip" />
          <div className="p-7">
            <div className="mb-1 font-display text-[22px] font-black text-[var(--text)]">Verify Email</div>
            <div className="mb-6 text-[12px] text-[var(--muted)]">
              {loading ? 'Confirming your email address now.' : 'Your verification status is below.'}
            </div>

            {message ? <div className="border border-[var(--border)] bg-[var(--clay)] px-3 py-3 text-[11px] text-[var(--text2)]">{message}</div> : null}
            {error ? <div className="border border-[rgba(196,52,26,.2)] bg-[rgba(196,52,26,.08)] px-3 py-2 text-[11px] text-[var(--red2)]">{error}</div> : null}

            <Button className="mt-5 w-full py-3.5" onClick={() => router.push('/login')}>
              Go to sign in
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
