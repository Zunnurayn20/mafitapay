'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react'
import { supportContact } from '@/lib/support-contact'

export default function DeleteAccountPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const mailto = useMemo(() => {
    const subject = 'MafitaPay account and data deletion request'
    const body = [
      'Hello MafitaPay Support,',
      '',
      'I am requesting deletion of my MafitaPay account and associated personal data.',
      `Account email: ${email.trim() || '[enter the email on your MafitaPay account]'}`,
      '',
      'Please tell me what identity verification is needed to process this request.',
      '',
      'I understand that MafitaPay may retain transaction, KYC, security, fraud-prevention, or other records where required by law or legitimate regulatory obligations. Please delete or de-identify other associated data when the request is completed.',
      '',
      'Thank you.',
    ].join('\n')
    return `mailto:${supportContact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }, [email])

  return (
    <main className="min-h-screen bg-[var(--char)] px-4 py-10 text-[var(--text)] sm:py-16">
      <section className="mx-auto w-full max-w-xl border border-[var(--border)] bg-[var(--clay)] p-5 sm:p-8">
        <a href="/login" className="mb-8 inline-flex items-center gap-2 text-sm text-[var(--text2)] hover:text-[var(--text)]">
          <ArrowLeft size={16} /> Back to MafitaPay
        </a>

        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(202,165,96,.12)] text-[var(--gold2)]">
          <ShieldCheck size={22} />
        </div>
        <h1 className="text-2xl font-semibold">Request account deletion</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text2)]">
          Use this page to ask MafitaPay to close your account and delete associated personal data. We may ask you to verify account ownership before acting on the request.
        </p>

        <label htmlFor="account-email" className="mt-7 block text-sm font-medium">Email used for your MafitaPay account</label>
        <input
          id="account-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={event => { setEmail(event.target.value); setSubmitted(false) }}
          placeholder="you@example.com"
          className="mt-2 w-full border border-[var(--border)] bg-[var(--char)] px-3 py-3 text-base text-[var(--text)] outline-none focus:border-[var(--gold2)]"
        />

        <a
          href={mailto}
          onClick={() => setSubmitted(true)}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
        >
          <Mail size={17} /> Email deletion request
        </a>
        {submitted ? (
          <p role="status" className="mt-3 text-sm text-[var(--green2)]">
            Your email app should open with the request addressed to MafitaPay Support. Send that message to submit your request.
          </p>
        ) : null}

        <div className="mt-7 border-t border-[var(--border)] pt-5 text-xs leading-5 text-[var(--muted)]">
          Financial and identity records may need to be retained for legal, regulatory, security, or fraud-prevention reasons. If retention applies, MafitaPay will explain it when responding. For help, contact{' '}
          <a className="text-[var(--gold2)] underline" href={`mailto:${supportContact.email}`}>{supportContact.email}</a>.
        </div>
      </section>
    </main>
  )
}
