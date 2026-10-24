'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Gift, Smartphone, TrendingUp } from 'lucide-react'

const SLIDES = [
  {
    href: '/downloads/mafitapay-android.apk',
    eyebrow: 'MafitaPay for Android',
    title: 'Download the Android app',
    Icon: Smartphone,
    iconLabel: 'Android app',
  },
  {
    href: '/stocks',
    eyebrow: 'Stocks · watch',
    title: 'NGX markets — watch only',
    Icon: TrendingUp,
    iconLabel: 'Stocks',
  },
  {
    href: '/referrals',
    eyebrow: 'Invite friends',
    title: 'Share your code and earn rewards',
    Icon: Gift,
    iconLabel: 'Referral rewards',
  },
] as const

export function GoldBanner() {
  const [activeSlide, setActiveSlide] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const timer = window.setInterval(() => {
      setActiveSlide(current => (current + 1) % SLIDES.length)
    }, 6000)

    return () => window.clearInterval(timer)
  }, [paused])

  return (
    <section
      aria-label="Featured"
      aria-roledescription="carousel"
      className="relative overflow-hidden rounded-2xl border border-[#2a2418] shadow-[0_4px_18px_-8px_rgba(0,0,0,0.35)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false)
      }}
      style={{
        background:
          'linear-gradient(135deg, #050403 0%, #1a140c 28%, #3d2e18 50%, #1a140c 72%, #050403 100%)',
      }}
    >
      <div
        className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${activeSlide * 100}%)` }}
      >
        {SLIDES.map(({ href, eyebrow, title, Icon, iconLabel }, index) => (
          <Link
            key={href}
            href={href}
            download={href.endsWith('.apk') ? 'MafitaPay.apk' : undefined}
            prefetch={false}
            aria-label={`${iconLabel}: ${title}`}
            aria-hidden={activeSlide !== index}
            tabIndex={activeSlide === index ? 0 : -1}
            className="flex min-h-[84px] min-w-full items-center justify-between gap-3 px-4 py-3.5 transition-transform active:scale-[0.99] sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#4a3a22] bg-[#0c0907]">
                <Icon size={18} className="text-white" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75">
                  {eyebrow}
                </div>
                <div className="mt-0.5 line-clamp-2 font-display text-[13px] font-bold leading-tight text-white sm:text-sm">
                  {title}
                </div>
              </div>
            </div>
            <ChevronRight size={18} className="shrink-0 text-white" />
          </Link>
        ))}
      </div>

      <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5" aria-label="Choose featured banner">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.href}
            type="button"
            aria-label={`Show ${slide.iconLabel} banner`}
            aria-current={activeSlide === index ? 'true' : undefined}
            onClick={() => setActiveSlide(index)}
            className={`h-1.5 rounded-full transition-all ${activeSlide === index ? 'w-4 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/75'}`}
          />
        ))}
      </div>
    </section>
  )
}
