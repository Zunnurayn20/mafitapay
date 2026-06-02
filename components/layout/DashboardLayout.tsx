'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { canUseBiometrics } from '@/lib/client/biometric'
import { refreshCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { isAdminEmail } from '@/lib/admin-access'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { Ticker } from './Ticker'
import { MobileNav } from './MobileNav'
import { AdminShell } from './AdminShell'
import { Toast } from '@/components/ui/Toast'
import { ModalManager } from '@/components/modals/ModalManager'
import { KycRequiredModal } from '@/components/modals/KycRequiredModal'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { FullScreenAppLoading } from '@/components/ui/RouteLoading'

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/history': 'Transactions',
  '/p2p': 'P2P Market',
  '/crypto': 'Crypto',
  '/crypto/orders': 'Crypto Orders',
  '/bills': 'Bills & Airtime',
  '/referrals': 'Referrals',
  '/profile': 'Profile',
  '/kyc': 'KYC Verification',
  '/security': 'Security',
  '/admin': 'Admin',
}

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { authResolved, isAuthenticated, refreshSession, theme, user, wallet, securitySettings, kycSubmission, cryptoDepositAddresses } = useAppStore()
  const router = useRouter()
  const pathname = usePathname()
  const [biometricSupported, setBiometricSupported] = useState(false)
  const [biometricSupportResolved, setBiometricSupportResolved] = useState(false)
  const fundingProvisionKeyRef = useRef('')
  const cryptoDepositProvisionKeyRef = useRef('')
  const isAdminRoute = pathname.startsWith('/admin')
  const isAnalyticsRoute = pathname.startsWith('/analytics')
  const isAdminUser = Boolean(user?.isAdmin || isAdminEmail(user?.email))
  const requiresInitialKycSubmission = Boolean(
    isAuthenticated
    && user
    && user.accountStatus === 'active'
    && !kycSubmission
    && pathname !== '/kyc'
  )
  const title = pathname.startsWith('/admin')
    ? 'Admin'
    : TITLES[pathname] ?? 'Dashboard'

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    void (async () => {
      try {
        setBiometricSupported(await canUseBiometrics())
      } finally {
        setBiometricSupportResolved(true)
      }
    })()
  }, [])

  useEffect(() => {
    if (!authResolved) return
    if (!isAuthenticated) router.push('/login')
  }, [authResolved, isAuthenticated, router])

  useEffect(() => {
    if (!authResolved || !isAuthenticated || !biometricSupportResolved) return
    if (pathname === '/security') return
    if (user?.accountStatus === 'active' && !kycSubmission && pathname !== '/kyc') return

    const needsPin = securitySettings?.hasTransactionPin !== true
    if (needsPin) {
      router.replace('/security?setup=1')
    }
  }, [authResolved, biometricSupportResolved, isAuthenticated, kycSubmission, pathname, router, securitySettings, user?.accountStatus])

  useEffect(() => {
    if (!authResolved || !isAuthenticated) return
    void refreshCryptoAssets()
  }, [authResolved, isAuthenticated])

  useEffect(() => {
    if (!authResolved || !isAuthenticated) return

    const interval = setInterval(() => {
      void refreshCryptoAssets()
    }, 60_000)

    return () => {
      clearInterval(interval)
    }
  }, [authResolved, isAuthenticated])

  useEffect(() => {
    if (!authResolved || !isAuthenticated) return

    const refreshNow = () => {
      void refreshSession()
    }

    const interval = setInterval(refreshNow, 20_000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshNow()
    }
    const handleFocus = () => {
      refreshNow()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
    }
  }, [authResolved, isAuthenticated, refreshSession])

  useEffect(() => {
    if (!authResolved || !isAuthenticated || !user || user.accountStatus !== 'active') return
    if (!kycSubmission || (kycSubmission.documentType !== 'bvn' && kycSubmission.documentType !== 'nin')) return

    const permanentAccounts = wallet?.virtualAccounts.filter(item => item.isPermanent) ?? []
    const missingProviders = (['palmpay', 'flutterwave'] as const).filter(
      provider => !permanentAccounts.some(item => item.provider === provider)
    )
    if (!missingProviders.length) return

    const provisionKey = `${user.id}:${kycSubmission.id}:${missingProviders.join(',')}`
    if (fundingProvisionKeyRef.current === provisionKey) return
    fundingProvisionKeyRef.current = provisionKey

    let cancelled = false
    void (async () => {
      for (const provider of missingProviders) {
        try {
          const response = await fetch('/api/wallet/deposit/account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ provider }),
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            console.warn('[funding-account-provision] failed', {
              provider,
              status: response.status,
              error: payload?.error ?? null,
            })
          }
        } catch (error) {
          console.warn('[funding-account-provision] request_error', {
            provider,
            error: error instanceof Error ? error.message : 'Request failed',
          })
        }
      }

      if (!cancelled) {
        await refreshSession()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authResolved, isAuthenticated, kycSubmission, refreshSession, user, wallet?.virtualAccounts])

  useEffect(() => {
    if (!authResolved || !isAuthenticated || !user || user.accountStatus !== 'active') return
    if (cryptoDepositAddresses.length > 0) return

    const provisionKey = `${user.id}:crypto-deposit-addresses`
    if (cryptoDepositProvisionKeyRef.current === provisionKey) return
    cryptoDepositProvisionKeyRef.current = provisionKey

    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/crypto/deposit-addresses', {
          method: 'POST',
          credentials: 'include',
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          console.warn('[crypto-deposit-address-provision] failed', {
            status: response.status,
            error: payload?.error ?? null,
          })
          return
        }

        if (!cancelled) await refreshSession()
      } catch (error) {
        console.warn('[crypto-deposit-address-provision] request_error', {
          error: error instanceof Error ? error.message : 'Request failed',
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authResolved, cryptoDepositAddresses.length, isAuthenticated, refreshSession, user])

  useEffect(() => {
    if (!authResolved || !isAuthenticated) return

    const warmRoutes = [
      '/dashboard',
      '/history',
      '/crypto',
      '/crypto/orders',
      '/bills',
      '/p2p',
      '/kyc',
    ]

    if (isAdminUser) {
      warmRoutes.push('/admin', '/admin/operations/events', '/admin/health/providers')
    }

    const prefetch = () => {
      for (const href of warmRoutes) {
        router.prefetch(href)
      }
    }

    const browser = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    let idleCallback: number | null = null
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null

    if (typeof browser.requestIdleCallback === 'function') {
      idleCallback = browser.requestIdleCallback(prefetch, { timeout: 1200 })
    } else {
      timeoutHandle = globalThis.setTimeout(prefetch, 250)
    }

    return () => {
      if (timeoutHandle !== null) {
        globalThis.clearTimeout(timeoutHandle)
      }
      if (idleCallback !== null && typeof browser.cancelIdleCallback === 'function') {
        browser.cancelIdleCallback(idleCallback)
      }
    }
  }, [authResolved, isAuthenticated, isAdminUser, router])

  if (!authResolved) {
    return (
      <FullScreenAppLoading
        title="Restoring your session"
        detail="Loading wallet, account state, and recent activity."
      />
    )
  }

  if (!isAuthenticated) return null

  if ((isAdminRoute || isAnalyticsRoute) && !isAdminUser) {
    return (
      <FullScreenAppLoading
        title="Admin access restricted"
        detail="This account is signed in, but it is not configured as an admin account."
      />
    )
  }

  if (biometricSupportResolved && pathname !== '/security' && !requiresInitialKycSubmission) {
    const needsPin = securitySettings?.hasTransactionPin !== true
    if (needsPin) {
      return (
        <FullScreenAppLoading
          title="Completing security setup"
          detail="Redirecting you to transaction PIN setup."
        />
      )
    }
  }

  return (
    <ErrorBoundary>
      <div className="relative z-[1] min-h-screen">
        {isAdminRoute ? (
          <AdminShell>{children}</AdminShell>
        ) : (
          <>
            <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
              <div className="hidden lg:block">
                <Sidebar />
              </div>

              <div className="flex min-h-screen min-w-0 flex-col pb-20 lg:pb-0">
                <Topbar title={title} />
                <Ticker />
                <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
                  <div className="mx-auto w-full max-w-7xl">{children}</div>
                </main>
              </div>
            </div>

            <MobileNav />
          </>
        )}
        {requiresInitialKycSubmission ? <KycRequiredModal /> : null}
        <ModalManager />
        <Toast />
      </div>
    </ErrorBoundary>
  )
}
