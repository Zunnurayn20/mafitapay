'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const SPLASH_MS = 1900

/** Same brand splash UI used on entry and while auth is restoring. */
export function BrandSplash() {
  return (
    <div className="splash-screen" data-testid="screen-splash">
      <div className="splash-logo-wrap">
        <div className="splash-ring" />
        <div className="splash-ring" />
        <div className="splash-mark" aria-hidden>
          <img src="/mafitapay-logo.png" alt="" />
        </div>
      </div>

      <div className="splash-title">
        <span className="text-[var(--gold2)]">Mafita</span>
        <span className="text-[var(--green2)]">Pay</span>
      </div>
      <p className="splash-tagline">Wallet · Bills · Crypto · Stocks</p>
    </div>
  )
}

/**
 * Brand splash (same pattern as online-data-sub): logo + tagline, then route on.
 * nextPath is resolved on the server from the session cookie.
 */
export function SplashScreen({ nextPath }: { nextPath: string }) {
  const router = useRouter()

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace(nextPath)
    }, SPLASH_MS)
    return () => clearTimeout(t)
  }, [router, nextPath])

  return <BrandSplash />
}
