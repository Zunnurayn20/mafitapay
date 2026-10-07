'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check } from 'lucide-react'
import { AuthSplitShell } from '@/components/auth/AuthSplitShell'
import { AuthBrandHeader, AuthTopNav } from '@/components/auth/AuthBrand'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { PasswordStrength } from '@/components/auth/PasswordStrength'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/client/native-system-bars'
import { isPasswordValid } from '@/lib/auth/validation'

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
  const [touched, setTouched] = useState(false)
  const match = !!confirmPassword && password === confirmPassword

  useEffect(() => { applyTheme(theme) }, [theme])
  useEffect(() => { if (authResolved && isAuthenticated) router.replace('/dashboard') }, [authResolved, isAuthenticated, router])
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setMessage(''); setTouched(true)
    if (!token) { setError('This reset link is missing its token.'); setLoading(false); return }
    if (!isPasswordValid(password)) { setError('Use at least 8 characters with a letter and a number.'); setLoading(false); return }
    if (!match) { setError("Passwords don't match."); setLoading(false); return }
    try {
      const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
      const payload = await response.json()
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Unable to reset password.')
      setMessage(payload.data?.message || 'Password reset successful.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to reset password.') }
    finally { setLoading(false) }
  }

  return <AuthSplitShell compactHeader={<AuthBrandHeader />}><div className="flex min-h-full flex-col">
    <AuthTopNav onBack={() => router.push('/login')} />
    <div className="my-auto py-8">
      <h1 className="font-display text-[29px] md:text-[24px] font-bold text-[var(--text)]">Choose a new password</h1>
      <p className="mt-3 text-[15px] text-[var(--text2)]">Use at least 8 characters with both letters and numbers.</p>
      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
        <PasswordInput label="New password" autoComplete="new-password" placeholder="Create a password" value={password} onChange={event => setPassword(event.target.value)} onBlur={() => setTouched(true)} aria-describedby="reset-strength" error={touched && !isPasswordValid(password) ? 'Use at least 8 characters with a letter and a number.' : undefined} />
        <PasswordStrength id="reset-strength" password={password} />
        <PasswordInput label="Confirm new password" autoComplete="new-password" placeholder="Repeat new password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} status={match ? 'success' : 'default'} statusIcon={match ? <Check size={20} className="text-[var(--success-text)]" /> : undefined} hint={match ? 'Passwords match' : undefined} hintTone="success" error={touched && !match ? "Passwords don't match" : undefined} />
        {error ? <div role="alert" className="text-[13.5px] text-[var(--danger-text)]">{error}</div> : null}
        {message ? <div role="status" className="text-[13.5px] text-[var(--success-text)]">{message}</div> : null}
        <Button type="submit" variant="gold" size="xl" loading={loading} className="w-full">Reset password</Button>
      </form>
    </div>
  </div></AuthSplitShell>
}
