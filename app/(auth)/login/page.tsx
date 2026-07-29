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
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  useEffect(() => {
    if (authResolved && isAuthenticated) router.push('/dashboard')
  }, [authResolved, isAuthenticated, router])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    if (!email.trim() || !pass) {
      setError('Email and password are required.')
      setLoading(false)
      return
    }
    try {
      await login(email.trim().toLowerCase(), pass)
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthSplitShell>
      <div className="mb-5 flex items-center gap-3">
        <img src="/mafitapay-logo.png" alt="" className="h-10 w-10 rounded-lg object-contain" />
        <div>
          <div className="font-display text-[20px] font-black text-[var(--text)]">Welcome Back</div>
          <div className="text-[11px] text-[var(--muted)]">Sign in to continue</div>
        </div>
      </div>

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <Input
          label="Email Address"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          placeholder="Enter password"
          value={pass}
          onChange={e => setPass(e.target.value)}
        />

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => router.push('/forgot-password')}
            className="text-[11px] font-bold text-[var(--gold2)]"
          >
            Forgot password?
          </button>
        </div>

        {error ? (
          <div className="border border-[rgba(196,52,26,.2)] bg-[rgba(196,52,26,.08)] px-3 py-2 text-[11px] text-[var(--red2)]">
            {error}
          </div>
        ) : null}

        <Button type="submit" loading={loading} className="w-full py-3.5">
          Sign In
        </Button>
      </form>

      <div className="mt-5 text-center text-[12px] text-[var(--muted)]">
        No account?{' '}
        <button
          type="button"
          className="font-bold text-[var(--gold2)]"
          onClick={() => router.push('/register')}
        >
          Create one free →
        </button>
      </div>
    </AuthSplitShell>
  )
}
