'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { canUseBiometrics } from '@/lib/client/biometric'
import { refreshBillCatalog, refreshCryptoAssets, refreshStocksMarket } from '@/lib/client/catalogs'
import { applyTheme } from '@/lib/client/native-system-bars'
import { useAppStore } from '@/store'
import { isAdminEmail } from '@/lib/admin-access'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { Ticker } from './Ticker'
import { MobileNav } from './MobileNav'

import { Toast } from '@/components/ui/Toast'
import { ModalManager } from '@/components/modals/ModalManager'
import { KycRequiredModal } from '@/components/modals/KycRequiredModal'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { BrandSplash } from '@/components/auth/SplashScreen'
import { FullScreenAppLoading } from '@/components/ui/RouteLoading'
import { BiometricGate } from '@/components/native/BiometricGate'

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/history': 'Transactions',
  '/stocks': 'Stocks',
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
  const { authResolved, isAuthenticated, refreshSession, showToast, theme, user, wallet, securitySettings, kycSubmission, cryptoDepositAddresses } = useAppStore()
  const hasPendingBankPayout = useAppStore(state => state.transactions.some(tx =>
    (tx.status === 'pending' || tx.status === 'processing')
    && (tx.metadata?.settlementKind === 'bank_transfer_out' || tx.metadata?.settlementKind === 'bank_payout')
  ))
  const hasPendingBillStatusCheck = useAppStore(state => state.transactions.some(tx =>
    tx.status === 'pending'
    && tx.metadata?.settlementKind === 'provider_bill'
    && (tx.metadata?.providerName === 'flutterwave' || tx.metadata?.providerName === 'bardetech' || tx.metadata?.providerName === 'asbdata')
  ))
  const hasPendingCryptoBuy = useAppStore(state => state.transactions.some(tx =>
    (tx.status === 'pending' || tx.status === 'processing')
    && tx.type === 'crypto_buy'
  ))
  const router = useRouter()
  const pathname = usePathname()
  const [biometricSupported, setBiometricSupported] = useState(false)
  const [biometricSupportResolved, setBiometricSupportResolved] = useState(false)
  const [initialSecuritySetupActive, setInitialSecuritySetupActive] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [pullStatus, setPullStatus] = useState<'idle' | 'pulling' | 'refreshing' | 'done' | 'error'>('idle')
  const pullStartRef = useRef<{ x: number; y: number } | null>(null)
  const pullDistanceRef = useRef(0)
  const pullRefreshingRef = useRef(false)
  const pullStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fundingProvisionKeyRef = useRef('')
  const cryptoDepositProvisionKeyRef = useRef('')
  const pendingPayoutSyncRef = useRef(false)
  const pendingBillSyncRef = useRef(false)
  const pendingCryptoSyncRef = useRef(false)
  pendingPayoutSyncRef.current = hasPendingBankPayout
  pendingBillSyncRef.current = hasPendingBillStatusCheck
  pendingCryptoSyncRef.current = hasPendingCryptoBuy
  const isAdminRoute = pathname.startsWith('/admin')
  const isAnalyticsRoute = pathname.startsWith('/analytics')
  /** Admin/analytics chrome comes from their server layouts — only pass children through the fixed viewport. */
  const useBareViewport = isAdminRoute || isAnalyticsRoute
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

  const handlePullStart = (event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1 || pullRefreshingRef.current || event.currentTarget.scrollTop > 0) {
      pullStartRef.current = null
      return
    }

    const touch = event.touches[0]
    pullStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const handlePullMove = (event: React.TouchEvent<HTMLElement>) => {
    const start = pullStartRef.current
    if (!start || event.touches.length !== 1 || event.currentTarget.scrollTop > 0) return

    const touch = event.touches[0]
    const deltaY = touch.clientY - start.y
    const deltaX = Math.abs(touch.clientX - start.x)
    if (deltaY <= 0 || deltaX > deltaY) return

    const distance = Math.min(96, deltaY * 0.55)
    pullDistanceRef.current = distance
    setPullDistance(distance)
    setPullStatus('pulling')
  }

  const finishPull = () => {
    pullStartRef.current = null
    const shouldRefresh = pullDistanceRef.current >= 68 && !pullRefreshingRef.current
    pullDistanceRef.current = 0
    setPullDistance(0)
    if (!shouldRefresh) {
      setPullStatus('idle')
      return
    }

    pullRefreshingRef.current = true
    setPullStatus('refreshing')
    if (pullStatusTimerRef.current) clearTimeout(pullStatusTimerRef.current)

    void (async () => {
      const syncs: Promise<unknown>[] = []
      if (pendingCryptoSyncRef.current) {
        syncs.push(fetch('/api/crypto/orders/routed-sync-pending', { method: 'POST', credentials: 'include' }).catch(() => null))
      }
      if (pendingPayoutSyncRef.current) {
        syncs.push(fetch('/api/wallet/payouts/sync', { method: 'POST', credentials: 'include' }).catch(() => null))
      }
      if (pendingBillSyncRef.current) {
        syncs.push(fetch('/api/wallet/bills/sync', { method: 'POST', credentials: 'include' }).catch(() => null))
      }
      await Promise.all(syncs)

      const refreshTasks: Promise<unknown>[] = [
        refreshSession(),
        refreshCryptoAssets({ force: true }),
      ]
      const isDashboard = pathname === '/dashboard'
      if (isDashboard || pathname.startsWith('/stocks')) refreshTasks.push(refreshStocksMarket())
      if (isDashboard || pathname.startsWith('/bills')) refreshTasks.push(refreshBillCatalog({ force: true }))

      const [sessionUpdated] = await Promise.all(refreshTasks)
      router.refresh()
      if (sessionUpdated === false) showToast('Could not refresh right now. Check your connection and try again.', 'error')
      setPullStatus(sessionUpdated === false ? 'error' : 'done')
      pullStatusTimerRef.current = setTimeout(() => setPullStatus('idle'), sessionUpdated === false ? 1800 : 900)
    })().catch(() => {
      showToast('Could not refresh right now. Check your connection and try again.', 'error')
      setPullStatus('error')
      pullStatusTimerRef.current = setTimeout(() => setPullStatus('idle'), 1800)
    }).finally(() => {
      pullRefreshingRef.current = false
    })
  }

  const cancelPull = () => {
    pullStartRef.current = null
    pullDistanceRef.current = 0
    setPullDistance(0)
    if (!pullRefreshingRef.current) setPullStatus('idle')
  }

  useEffect(() => () => {
    if (pullStatusTimerRef.current) clearTimeout(pullStatusTimerRef.current)
  }, [])

  useEffect(() => {
    applyTheme(theme)
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
    if (!authResolved || !isAuthenticated || !biometricSupportResolved || initialSecuritySetupActive) return
    if (pathname === '/security') return
    if (user?.accountStatus === 'active' && !kycSubmission && pathname !== '/kyc') return

    const needsPin = securitySettings?.hasTransactionPin !== true
    if (needsPin) {
      router.replace('/security?setup=1')
    }
  }, [authResolved, biometricSupportResolved, initialSecuritySetupActive, isAuthenticated, kycSubmission, pathname, router, securitySettings, user?.accountStatus])

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
      void (async () => {
        if (pendingCryptoSyncRef.current) {
          try {
            await fetch('/api/crypto/orders/routed-sync-pending', { method: 'POST', credentials: 'include' })
          } catch {
            // Keep showing the last known order status if the provider lookup is temporarily unavailable.
          }
        }
        if (pendingPayoutSyncRef.current) {
          try {
            await fetch('/api/wallet/payouts/sync', { method: 'POST', credentials: 'include' })
          } catch {
            // Session refresh still shows the last status stored for this payout.
          }
        }
        if (pendingBillSyncRef.current) {
          try {
            await fetch('/api/wallet/bills/sync', { method: 'POST', credentials: 'include' })
          } catch {
            // Keep showing the last known provider status when the lookup is temporarily unavailable.
          }
        }
        await refreshSession()
      })()
    }

    if (hasPendingCryptoBuy || hasPendingBankPayout || hasPendingBillStatusCheck) refreshNow()

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
  }, [authResolved, hasPendingBankPayout, hasPendingCryptoBuy, hasPendingBillStatusCheck, isAuthenticated, refreshSession])

  useEffect(() => {
    if (!authResolved || !isAuthenticated || !user || user.accountStatus !== 'active') return
    if (!kycSubmission || (kycSubmission.documentType !== 'bvn' && kycSubmission.documentType !== 'nin')) return
    if (kycSubmission.status === 'rejected') return

    const permanentAccounts = wallet?.virtualAccounts.filter(item => item.isPermanent) ?? []
    // PalmPay accounts remain user-requested; Flutterwave and BillStack are provisioned after BVN/NIN submission.
    const missingProviders = (['flutterwave', 'billstack'] as const).filter(
      provider => !permanentAccounts.some(item => item.provider === provider)
    )
    if (!missingProviders.length) return

    const provisionKey = `${user.id}:${kycSubmission.id}:${missingProviders.join(',')}`
    if (fundingProvisionKeyRef.current === provisionKey) return
    fundingProvisionKeyRef.current = provisionKey

    let cancelled = false
    void (async () => {
      const failedProviders: Array<(typeof missingProviders)[number]> = []
      for (const provider of missingProviders) {
        try {
          const response = await fetch('/api/wallet/deposit/account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ provider }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.success === false) {
            failedProviders.push(provider)
          }
        } catch {
          failedProviders.push(provider)
        }
      }

      if (!cancelled) {
        await refreshSession()
        if (failedProviders.length > 0) {
          const providerNames = failedProviders.map(provider => provider === 'billstack' ? 'BillStack' : 'Flutterwave')
          const providerList = providerNames.length > 1
            ? `${providerNames.slice(0, -1).join(', ')} and ${providerNames[providerNames.length - 1]}`
            : providerNames[0]
          showToast(`We couldn't create your ${providerList} funding account${providerNames.length > 1 ? 's' : ''} yet. Open Deposit Funds to retry.`, 'error')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authResolved, isAuthenticated, kycSubmission, refreshSession, showToast, user, wallet?.virtualAccounts])

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
      '/stocks',
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
    // Keep the same brand splash as app entry — do not show a second "restoring session" logo screen.
    return <BrandSplash />
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

  if (biometricSupportResolved && pathname !== '/security' && !requiresInitialKycSubmission && !initialSecuritySetupActive) {
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
      <BiometricGate>
        <div className="app-fixed-viewport relative z-[1]">
          {useBareViewport ? (
            children
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,1fr)]">
                <div className="hidden min-h-0 lg:block">
                  <Sidebar />
                </div>

                <div className="flex min-h-0 min-w-0 flex-col">
                  <Topbar title={title} />
                  <div className="fixed left-0 right-0 top-[var(--app-topbar-height)] z-30 lg:left-64">
                    <Ticker />
                  </div>
                  <main
                    className="app-scroll min-h-0 flex-1 px-4 pb-[calc(var(--app-mobile-nav-height)+0.75rem)] pt-[calc(var(--app-topbar-height)+var(--app-ticker-height)+1.5rem)] sm:px-6 lg:px-8 lg:pb-6"
                    onTouchStart={handlePullStart}
                    onTouchMove={handlePullMove}
                    onTouchEnd={finishPull}
                    onTouchCancel={cancelPull}
                  >
                    <div
                      role="status"
                      aria-live="polite"
                      className={`pointer-events-none absolute left-1/2 top-[calc(var(--app-topbar-height)+var(--app-ticker-height)+0.15rem)] z-20 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-xs text-[var(--text2)] shadow-lg transition-[opacity,transform] duration-150 ${pullStatus === 'idle' && pullDistance === 0 ? 'opacity-0' : 'opacity-100'}`}
                      style={{ transform: `translate(-50%, ${pullDistance > 0 ? Math.max(0, pullDistance - 24) : 28}px)` }}
                    >
                      <RefreshCw
                        size={14}
                        className={pullStatus === 'refreshing' ? 'animate-spin text-[var(--gold)]' : 'text-[var(--gold)]'}
                        style={{ transform: pullStatus === 'pulling' ? `rotate(${Math.min(180, pullDistance * 2)}deg)` : undefined }}
                      />
                      <span>
                        {pullStatus === 'refreshing' ? 'Refreshing…'
                          : pullStatus === 'done' ? 'Updated'
                            : pullStatus === 'error' ? 'Refresh failed'
                              : pullDistance >= 68 ? 'Release to refresh' : 'Pull to refresh'}
                      </span>
                    </div>
                    <div className="mx-auto w-full max-w-7xl">{children}</div>
                  </main>
                </div>
              </div>

              <MobileNav />
            </div>
          )}
          {requiresInitialKycSubmission || initialSecuritySetupActive ? (
            <KycRequiredModal onSecuritySetupChange={setInitialSecuritySetupActive} />
          ) : null}
          <ModalManager />
          <Toast />
        </div>
      </BiometricGate>
    </ErrorBoundary>
  )
}
