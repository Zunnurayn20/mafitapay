'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store'
import { AuthSplitShell } from '@/components/auth/AuthSplitShell'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function LoginPage() {
  const { authResolved, login, isAuthenticated, theme } = useAppStore()
  const router = useRouter()
  const [email, setEmail]   = useState('')
  const [pass, setPass]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.push('/dashboard') }, [authResolved, isAuthenticated, router])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    if (!email.trim() || !pass) {
      setError('Email and password are required.')
      setLoading(false)
      return
    }
    try {
      await login(email.trim().toLowerCase(), pass)
      router.push('/dashboard')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to sign in.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthSplitShell>
      <div className="lg:hidden text-center mb-8">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden">
          <img
            src="/mafitapay-logo.jpg"
            alt="MafitaPay logo"
            className="h-20 w-20 object-contain"
          />
        </div>
        <div className="font-display font-black text-3xl text-[var(--text)]">MafitaPay</div>
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-widest mt-1">Digital Finance Platform</div>
      </div>

      <div className="bg-[var(--coal)] border border-[var(--border)]">
        <div className="ank-strip" />
        <div className="p-7">
          <div className="font-display font-black text-[22px] text-[var(--text)] mb-1">Welcome Back</div>
          <div className="text-[12px] text-[var(--muted)] mb-6">Sign in to your MafitaPay wallet</div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <Input label="Email Address" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} />
            <Input label="Password" type="password" placeholder="Enter password"
              value={pass} onChange={e => setPass(e.target.value)} />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => router.push('/forgot-password')}
                className="text-[11px] font-bold text-[var(--gold2)] transition-colors hover:text-[var(--text)]"
              >
                Forgot password?
              </button>
            </div>

            {error && <div className="text-[11px] text-[var(--red2)] bg-[rgba(196,52,26,.08)] border border-[rgba(196,52,26,.2)] px-3 py-2">{error}</div>}

            <Button type="submit" loading={loading} className="w-full py-3.5 mt-1">Sign In</Button>
          </form>

          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] px-3 py-3 text-[10px] text-[var(--muted)]">
            Password sign-in is the only active login method right now.
          </div>

          <div className="text-center mt-5 text-[12px] text-[var(--muted)]">
            No account?{' '}
            <span className="text-[var(--gold2)] font-bold cursor-pointer" onClick={() => router.push('/register')}>
              Create one free →
            </span>
          </div>
        </div>
      </div>

      <div className="text-center mt-4 text-[10px] text-[var(--muted2)] font-mono">v2.0 · Powered by MafitaPay</div>
    </AuthSplitShell>
  )
}
