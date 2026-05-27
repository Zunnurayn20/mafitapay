'use client'

import { ReactNode } from 'react'
import { ArrowLeftRight, BadgeCheck, Receipt, ShieldCheck } from 'lucide-react'

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

export function AuthSplitShell({ children }: AuthSplitShellProps) {
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
      <div className="absolute left-[8%] top-[12%] hidden h-36 w-36 rotate-12 border border-[rgba(202,165,96,.18)] bg-[linear-gradient(135deg,rgba(202,165,96,.12),rgba(140,107,49,.02))] lg:block animate-float-soft" />
      <div className="absolute bottom-[14%] left-[10%] hidden h-24 w-24 rotate-45 border border-[rgba(46,170,92,.16)] bg-[linear-gradient(135deg,rgba(46,170,92,.12),rgba(12,9,7,.02))] lg:block animate-float-soft [animation-delay:1.2s]" />
      <div className="absolute right-[9%] top-[18%] hidden h-28 w-28 rounded-full border border-[rgba(202,165,96,.14)] bg-[radial-gradient(circle,rgba(202,165,96,.1),transparent_70%)] lg:block animate-soft-pulse" />
      <div className="absolute right-[12%] bottom-[16%] hidden h-20 w-20 rounded-full border border-[rgba(46,170,92,.14)] bg-[radial-gradient(circle,rgba(46,170,92,.12),transparent_70%)] lg:block animate-soft-pulse [animation-delay:.8s]" />

      <div className="relative mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-7xl items-center gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,.92fr)] lg:gap-14">
        <section className="relative pt-2">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden border border-[rgba(202,165,96,.2)] bg-[var(--coal)] shadow-[0_14px_34px_rgba(0,0,0,.18)]">
              <img
                src="/mafitapay-logo.png"
                alt="MafitaPay logo"
                className="h-16 w-16 object-contain"
              />
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
            <h1 className="font-display text-[2.8rem] font-black leading-[0.95] text-[var(--text)] sm:text-[3.6rem] lg:text-[4.7rem]">
              Your Money.
              <br />
              Your Way.
              <br />
              <span className="bg-[linear-gradient(90deg,var(--green2),#9df0be)] bg-clip-text text-transparent">
                Limitless Possibilities.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-[var(--text2)] sm:text-[16px]">
              Send, receive, save and grow your money with MafitaPay. Fast, secure, reliable and built for you.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {features.map(item => {
              const Icon = item.icon
              return (
                <div key={item.title} className="flex items-start gap-3 rounded-[1.4rem] border border-[rgba(202,165,96,.16)] bg-[var(--clay)] px-4 py-4 shadow-[0_16px_36px_rgba(0,0,0,.12)] backdrop-blur">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(202,165,96,.12)] text-[var(--gold2)] shadow-[inset_0_0_0_1px_rgba(202,165,96,.12)]">
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

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" aria-label="Get MafitaPay on Google Play" className="transition-transform hover:-translate-y-0.5">
              <img
                src="/google-play.png"
                alt="Get it on Google Play"
                className="h-12 w-auto object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,.18)]"
              />
            </button>
            <button type="button" aria-label="Download MafitaPay on the App Store" className="transition-transform hover:-translate-y-0.5">
              <img
                src="/app-store.png"
                alt="Download on the App Store"
                className="h-12 w-auto object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,.18)]"
              />
            </button>
          </div>
        </section>

        <section className="relative flex justify-center lg:justify-end">
          <div className="w-full max-w-[440px] rounded-[2rem] border border-[rgba(202,165,96,.16)] bg-[var(--coal)] p-5 shadow-[0_30px_80px_rgba(0,0,0,.28)] backdrop-blur sm:p-6 lg:p-7">
            {children}
          </div>
        </section>
      </div>
    </div>
  )
}
