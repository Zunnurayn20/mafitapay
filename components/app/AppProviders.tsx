'use client'

import { PrivyProvider, usePrivy } from '@privy-io/react-auth'
import { useEffect, useRef, type ReactNode } from 'react'
import { useAppStore } from '@/store'
import { DeviceLoginOptIn } from '@/components/auth/DeviceLoginOptIn'

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()

function PrivySessionBridge({ children }: { children: ReactNode }) {
  const appAuthenticated = useAppStore(state => state.isAuthenticated)
  const { authenticated: privyAuthenticated, logout } = usePrivy()
  const wasAppAuthenticated = useRef(false)

  useEffect(() => {
    if (wasAppAuthenticated.current && !appAuthenticated && privyAuthenticated) {
      void logout()
    }
    wasAppAuthenticated.current = appAuthenticated
  }, [appAuthenticated, logout, privyAuthenticated])

  return children
}

export function AppProviders({ children }: { children: ReactNode }) {
  if (!privyAppId) return <>{children}<DeviceLoginOptIn /></>

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'dark',
          accentColor: '#caa560',
          landingHeader: 'Welcome to MafitaPay',
          loginMessage: 'Sign in or create your MafitaPay account with email.',
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'off' },
        },
      }}
    >
      <PrivySessionBridge>{children}<DeviceLoginOptIn /></PrivySessionBridge>
    </PrivyProvider>
  )
}
