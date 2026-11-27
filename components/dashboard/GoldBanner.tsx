'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

const SLIDES = [
  {
    href: '/downloads/mafitapay-android.apk',
    image: '/download-banner.jpg',
    alt: 'Download the MafitaPay app',
    label: 'Download the MafitaPay Android app',
  },
  {
    href: '/stocks',
    image: '/ngx-banner.jpg',
    alt: 'NGX stocks watchlist',
    label: 'Explore the NGX stocks watchlist',
  },
  {
    href: '/referrals',
    image: '/referral-banner.jpg',
    alt: 'Refer a friend and earn rewards',
    label: 'Explore referral rewards',
  },
  {
    href: '/crypto',
    image: '/crypo-banner.jpg',
    alt: 'Buy and sell crypto assets',
    label: 'Buy and sell crypto assets',
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
    >
      <div
        className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${activeSlide * 100}%)` }}
      >
        {SLIDES.map(({ href, image, alt, label }, index) => (
          <Link
            key={href}
            href={href}
            download={href.endsWith('.apk') ? 'MafitaPay.apk' : undefined}
            prefetch={false}
            aria-label={label}
            aria-hidden={activeSlide !== index}
            tabIndex={activeSlide === index ? 0 : -1}
            className="relative block aspect-[1280/450] min-w-full transition-transform active:scale-[0.995]"
          >
            <Image src={image} alt={alt} fill sizes="(max-width: 640px) 100vw, 1280px" className="object-cover" priority={index === 0} />
          </Link>
        ))}
      </div>

      <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-2 py-1" aria-label="Choose featured banner">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.href}
            type="button"
            aria-label={`Show banner: ${slide.label}`}
            aria-current={activeSlide === index ? 'true' : undefined}
            onClick={() => setActiveSlide(index)}
            className={`h-1.5 rounded-full transition-all ${activeSlide === index ? 'w-4 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/75'}`}
          />
        ))}
      </div>
    </section>
  )
}
