'use client'

import { ReactNode, useEffect, useState } from 'react'
import { ArrowLeftRight, BadgeCheck, Receipt, ShieldCheck } from 'lucide-react'
import { isNativeApp } from '@/lib/client/native-app'

interface AuthSplitShellProps {
  children: ReactNode
}

const features = [
  {
    icon: ArrowLeftRight,
    title: 'Send & Receive Money',
    description: 'Instant transfers to anyone, anytime.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure Wallet',
    description: 'Your funds are protected with bank-level security.',
  },
  {
    icon: Receipt,
    title: 'Pay Bills',
    description: 'Top up airtime, data and pay bills seamlessly.',
  },
  {
    icon: BadgeCheck,
    title: 'Trusted & Reliable',
    description: 'Join thousands of users who trust MafitaPay every day.',
  },
]

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=ng.mafitapay.app'
const APP_STORE_URL = 'https://apps.apple.com/app/mafitapay/id0000000000'

function FormCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-[rgba(202,165,96,.16)] bg-[var(--coal)] p-5 shadow-[0_24px_70px_rgba(0,0,0,.28)] sm:p-6">
      {children}
    </div>
  )
}

export function AuthSplitShell({ children }: AuthSplitShellProps) {
  const [nativeApp, setNativeApp] = useState(false)
  const [compact, setCompact] = useState(true)

  useEffect(() => {
    setNativeApp(isNativeApp())
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => setCompact(mq.matches || isNativeApp())
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Mobile + native app: form card only
  if (compact || nativeApp) {
    return (
      <div className="relative z-[1] flex min-h-screen items-center justify-center bg-[var(--page-bg)] px-4 py-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(202,165,96,.1),transparent_42%)]" />
        <div className="relative w-full max-w-[400px]">
          <FormCard>{children}</FormCard>
        </div>
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
            <h1 className="font-display text-[2.8rem] font-black leading-[0.95] text-[var(--text)] lg:text-[4.7rem]">
              Your Money.
              <br />
              Your Way.
              <br />
              <span className="bg-[linear-gradient(90deg,var(--green2),#9df0be)] bg-clip-text text-transparent">
                Limitless Possibilities.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-[var(--text2)]">
              Send, receive, save and grow your money with MafitaPay. Fast, secure, reliable and built for you.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {features.map(item => {
              const Icon = item.icon
              return (
                <div
                  key={item.title}
                  className="flex items-start gap-3 rounded-[1.4rem] border border-[rgba(202,165,96,.16)] bg-[var(--clay)] px-4 py-4 shadow-[0_16px_36px_rgba(0,0,0,.12)]"
                >
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(202,165,96,.12)] text-[var(--gold2)]">
                    <Icon size={18} />
                  </span>
                  <div>
                    <div className="text-[13px] font-bold text-[var(--text)]">{item.title}</div>
                    <div className="mt-1 text-[12px] leading-6 text-[var(--text2)]">{item.description}</div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Get MafitaPay on Google Play">
              <img src="/google-play.png" alt="Get it on Google Play" className="h-12 w-auto object-contain" />
            </a>
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store">
              <img src="/app-store.png" alt="Download on the App Store" className="h-12 w-auto object-contain" />
            </a>
          </div>
        </section>

        <section className="relative flex justify-end">
          <FormCard>{children}</FormCard>
        </section>
      </div>
    </div>
  )
}
