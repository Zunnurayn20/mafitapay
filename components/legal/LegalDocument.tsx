import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

export function LegalDocument({
  title,
  updatedAt,
  children,
}: {
  title: string
  updatedAt: string
  children: ReactNode
}) {
  return (
    <main className="app-scroll flex-1 bg-[var(--char)] px-4 py-8 text-[var(--text)] sm:py-12">
      <article className="mx-auto w-full max-w-3xl border border-[var(--border)] bg-[var(--clay)] px-5 py-6 sm:px-9 sm:py-9">
        <header className="border-b border-[var(--border)] pb-6">
          <Link href="/register" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text2)] hover:text-[var(--text)]">
            <ArrowLeft size={16} /> Back to MafitaPay
          </Link>
          <div className="mt-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(202,165,96,.12)] text-[var(--gold2)]">
              <ShieldCheck size={20} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[1.2px] text-[var(--gold2)]">MafitaPay</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">Last updated {updatedAt}</p>
            </div>
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">{title}</h1>
        </header>

        <div className="legal-content mt-7 space-y-7 text-sm leading-7 text-[var(--text2)]">
          {children}
        </div>

        <footer className="mt-9 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--border)] pt-5 text-sm">
          <Link href="/privacy" className="text-[var(--gold2)] underline underline-offset-2">Privacy Policy</Link>
          <Link href="/terms" className="text-[var(--gold2)] underline underline-offset-2">Terms of Service</Link>
          <Link href="/delete-account" className="text-[var(--gold2)] underline underline-offset-2">Request account deletion</Link>
          <a href="mailto:support@mafitapay.com" className="text-[var(--gold2)] underline underline-offset-2">Contact support</a>
        </footer>
      </article>
    </main>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-[var(--text)]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
