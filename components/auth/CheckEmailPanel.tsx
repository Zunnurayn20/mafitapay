'use client'
import { useEffect, useState } from 'react'
import { Check, Info, Mail, RotateCcw } from 'lucide-react'
import { AuthTopNav } from '@/components/auth/AuthBrand'
import { Button } from '@/components/ui/Button'
import { openEmailApp } from '@/lib/client/open-email-app'

export function CheckEmailPanel({ email, verificationLink, onBack }: { email: string; verificationLink?: string; onBack: () => void }) {
  const [seconds, setSeconds] = useState(45)
  const [loading, setLoading] = useState(false)
  const [devLink, setDevLink] = useState(verificationLink ?? '')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (seconds <= 0) return
    const timer = window.setTimeout(() => setSeconds(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])

  async function resend() {
    if (seconds > 0 || loading) return
    setLoading(true); setNotice('')
    try {
      const response = await fetch('/api/auth/verify-email/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const payload = await response.json().catch(() => null)
      const wait = Number(payload?.data?.retryAfterSeconds ?? payload?.retryAfterSeconds ?? response.headers.get('Retry-After') ?? 45)
      if (response.status === 429) { setSeconds(Math.max(1, wait)); throw new Error(payload?.error || 'Please wait before requesting another link.') }
      if (!response.ok) throw new Error(payload?.error || 'Unable to resend the verification link.')
      setDevLink(typeof payload?.data?.verificationLink === 'string' ? payload.data.verificationLink : '')
      setNotice('If your account is waiting for verification, a new link has been sent. Earlier links are no longer valid.')
      setSeconds(Math.max(1, wait))
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Unable to resend the verification link.') }
    finally { setLoading(false) }
  }

  return <div className="flex min-h-full flex-col">
    <AuthTopNav onBack={onBack} />
    <div className="my-auto py-8 text-center">
      <div className="relative mx-auto grid h-[132px] w-[132px] place-items-center">
        <div aria-hidden="true" className="absolute inset-0 rounded-full border border-[var(--success-ring)] bg-[var(--success-ring)]" />
        <div className="relative grid h-[100px] w-[100px] place-items-center rounded-full bg-[linear-gradient(160deg,var(--green2),var(--ngn))] text-[var(--char)] shadow-[0_14px_34px_var(--success-ring)]"><Check size={50} strokeWidth={3} /></div>
        <span className="absolute bottom-0 right-0 grid h-[42px] w-[42px] place-items-center rounded-[14px] border border-[var(--gold)] bg-[var(--clay)] text-[var(--gold2)]"><Mail size={22} /></span>
      </div>
      <h1 className="mt-8 font-display text-[32px] font-bold text-[var(--text)]">Check your inbox</h1>
      <p className="mt-4 text-[15px] text-[var(--text2)]">We sent a link to</p>
      <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--coal)] px-4 py-2 text-[15px] font-semibold text-[var(--text)]"><Mail size={16} className="shrink-0 text-[var(--gold)]" /><span className="break-all">{email}</span></div>
      <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">Tap the link in the email to verify your address and finish opening your wallet.</p>
    </div>
    <div className="flex items-start gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--coal)] p-3.5 text-left text-[13.5px] leading-relaxed text-[var(--text2)]"><Info size={18} className="mt-0.5 shrink-0 text-[var(--gold)]" /><span>Can&apos;t find it? Check your spam or promotions folder.</span></div>
    <div className="mt-4 flex flex-col gap-3">
      <Button type="button" variant="gold" size="xl" className="w-full" onClick={() => { void openEmailApp(email) }}><Mail size={20} />Open email app</Button>
      <Button type="button" variant="outline" size="xl" className="w-full" disabled={seconds > 0 || loading} loading={loading} onClick={() => { void resend() }}><RotateCcw size={20} />Resend link {seconds > 0 ? <span className="tabular-nums text-[var(--muted)]">(in 0:{String(seconds).padStart(2, '0')})</span> : null}</Button>
    </div>
    <div role="status" aria-live="polite" className="mt-3 min-h-5 text-[13px] text-[var(--text2)]">{notice}</div>
    {process.env.NODE_ENV !== 'production' && devLink ? <div className="mt-3 border border-dashed border-[var(--border)] p-3 text-left text-[13px]"><b>Dev only</b><a className="mt-1 block break-all text-[var(--gold2)] underline" href={devLink}>Open verification link</a></div> : null}
  </div>
}
