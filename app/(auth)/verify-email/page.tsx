'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthSplitShell } from '@/components/auth/AuthSplitShell'
import { AuthBrandHeader, AuthTopNav } from '@/components/auth/AuthBrand'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/client/native-system-bars'

export default function VerifyEmailPage() {
  const { authResolved, isAuthenticated, refreshSession, theme } = useAppStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('Verifying your email address…')
  const [error, setError] = useState('')
  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.replace('/dashboard') }, [authResolved, isAuthenticated, router])

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

  return <AuthSplitShell compactHeader={<AuthBrandHeader />}><div className="flex min-h-full flex-col">
    <AuthTopNav onBack={() => router.push('/login')} />
    <div className="my-auto py-10 text-center">
      <h1 className="font-display text-[29px] md:text-[24px] font-bold text-[var(--text)]">Verify your email</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[var(--text2)]">{loading ? 'Confirming your email address now.' : message}</p>
      {error ? <div role="alert" className="mt-4 text-[13.5px] text-[var(--danger-text)]">{error}</div> : null}
      <Button variant="gold" size="xl" className="mt-7 w-full" loading={loading} disabled={loading} onClick={() => router.push('/login')}>Go to sign in</Button>
    </div>
  </div></AuthSplitShell>
}
