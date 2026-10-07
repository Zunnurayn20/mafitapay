'use client'

import { ReactNode, useEffect, useState } from 'react'
import { ArrowLeftRight, Receipt, ShieldCheck } from 'lucide-react'
import { isNativeApp } from '@/lib/client/native-app'

interface AuthSplitShellProps {
  children: ReactNode
  compactHeader?: ReactNode
}

const features = [
  {
    icon: ArrowLeftRight,
    title: 'Send & Receive Money',
  },
  {
    icon: ShieldCheck,
    title: 'Secure Wallet',
  },
  {
    icon: Receipt,
    title: 'Pay Bills',
  },
]

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=ng.mafitapay.app'
const APP_STORE_URL = process.env.NEXT_PUBLIC_IOS_APP_STORE_URL?.trim() || ''
const hasRealAppStoreUrl = /^https:\/\/apps\.apple\.com\/.+\/id[1-9]\d{5,}$/.test(APP_STORE_URL)

function FormCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-[rgba(202,165,96,.16)] bg-[var(--coal)] p-5 shadow-[0_24px_70px_rgba(0,0,0,.28)] sm:p-6">
      {children}
    </div>
  )
}

export function AuthSplitShell({ children, compactHeader }: AuthSplitShellProps) {
  const nativeApp = isNativeApp()
  const [compact, setCompact] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => setCompact(mq.matches || isNativeApp())
    const frame = window.requestAnimationFrame(apply)
    mq.addEventListener('change', apply)
    return () => { window.cancelAnimationFrame(frame); mq.removeEventListener('change', apply) }
  }, [])

  // Mobile + native app: full-bleed scrollable auth canvas
  if (compact || nativeApp) {
    return (
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-[var(--page-bg)]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] bg-[radial-gradient(120%_55%_at_50%_-8%,var(--auth-glow)_0%,transparent_66%)]" />
        <main className="relative mx-auto flex min-h-full w-full max-w-[440px] flex-col px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
          {compactHeader}
          {children}
        </main>
      </div>
    )
  }

  // Desktop web: marketing + form
  return (
    <div className="relative z-[1] min-h-screen overflow-hidden bg-[var(--page-bg)] px-4 py-6 lg:px-8 lg:py-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(202,165,96,.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(46,170,92,.12),transparent_28%),linear-gradient(135deg,rgba(140,107,49,.08),transparent_44%,rgba(202,165,96,.03))]" />
      <div
        className="absolute inset-0 opacity-45"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(202,165,96,.06) 0, rgba(202,165,96,.06) 2px, transparent 2px, transparent 24px), repeating-linear-gradient(-45deg, rgba(140,107,49,.05) 0, rgba(140,107,49,.05) 2px, transparent 2px, transparent 28px)',
        }}
      />

      <div className="relative mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-7xl items-center gap-14 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)]">
        <section className="relative pt-2">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden border border-[rgba(202,165,96,.2)] bg-[var(--coal)] shadow-[0_14px_34px_rgba(0,0,0,.18)]">
              <img src="/mafitapay-logo.png" alt="MafitaPay logo" className="h-16 w-16 object-contain" />
            </div>
            <div>
              <div className="font-display text-3xl font-black tracking-[0.14em] text-[var(--gold2)]">
                MAFITAPAY
              </div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                Digital finance for Nigerians
              </div>
            </div>
          </div>

          <div className="mt-10 max-w-2xl">
            <h1 className="font-display text-[2.8rem] font-black leading-[0.98] text-[var(--text)] lg:text-[4.5rem]">
              Money,
              <br />
              made simpler.
            </h1>
            <p className="mt-4 max-w-lg text-[14px] leading-6 text-[var(--text2)]">
              Send money, manage your wallet, and pay bills in one place.
            </p>
          </div>

          <div className="mt-7 flex flex-wrap gap-2">
            {features.map(item => {
              const Icon = item.icon
              return (
                <div
                  key={item.title}
                  className="inline-flex items-center gap-2 rounded-full border border-[rgba(202,165,96,.16)] bg-[var(--clay)] px-3.5 py-2.5"
                >
                  <Icon size={15} className="text-[var(--gold2)]" />
                  <span className="text-[11px] font-bold text-[var(--text)]">{item.title}</span>
                </div>
              )
            })}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Get MafitaPay on Google Play">
              <img src="/google-play.png" alt="Get it on Google Play" className="h-12 w-auto object-contain" />
            </a>
            {hasRealAppStoreUrl ? (<a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store"><img src="/app-store.png" alt="Download on the App Store" className="h-12 w-auto object-contain" /></a>) : null}
          </div>
        </section>

        <section className="relative flex justify-end">
          <FormCard>{children}</FormCard>
        </section>
      </div>
    </div>
  )
}
