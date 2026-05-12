'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { refreshCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { Ticker } from './Ticker'
import { MobileNav } from './MobileNav'
import { AdminShell } from './AdminShell'
import { Toast } from '@/components/ui/Toast'
import { ModalManager } from '@/components/modals/ModalManager'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

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
  const { authResolved, isAuthenticated, theme } = useAppStore()
  const router = useRouter()
  const pathname = usePathname()
  const isAdminRoute = pathname.startsWith('/admin')
  const title = pathname.startsWith('/admin')
    ? 'Admin'
    : TITLES[pathname] ?? 'Dashboard'

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!authResolved) return
    if (!isAuthenticated) router.push('/login')
  }, [authResolved, isAuthenticated, router])

  useEffect(() => {
    if (!authResolved || !isAuthenticated) return
    void refreshCryptoAssets({ force: true, liveOnly: true })
  }, [authResolved, isAuthenticated])

  useEffect(() => {
    if (!authResolved || !isAuthenticated) return

    const interval = setInterval(() => {
      void refreshCryptoAssets()
    }, 30_000)

    return () => {
      clearInterval(interval)
    }
  }, [authResolved, isAuthenticated])

  if (!authResolved || !isAuthenticated) return null

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
        <ModalManager />
        <Toast />
      </div>
    </ErrorBoundary>
  )
}
