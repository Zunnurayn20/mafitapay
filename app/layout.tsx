import type { Metadata, Viewport } from 'next'
import { AppBootstrap } from '@/components/app/AppBootstrap'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0c0907',
}

export const metadata: Metadata = {
  title: 'MafitaPay | Digital Finance',
  description: 'Secure NGN wallet, NGX stocks watchlist, crypto, and bills — built for Nigerians.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MafitaPay',
  },
  other: {
    'base:app_id': '6a10ca5b2f5dad1ef72e65a5',
    'mobile-web-app-capable': 'yes',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppBootstrap />
        <div id="app-root">{children}</div>
      </body>
    </html>
  )
}


