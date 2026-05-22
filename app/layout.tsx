import type { Metadata } from 'next'
import { AppBootstrap } from '@/components/app/AppBootstrap'
import './globals.css'


export const metadata: Metadata = {
  title: 'MafitaPay | Digital Finance',
  description: 'Secure NGN wallet, P2P trading, crypto, and bills — built for Nigerians.',
  other: {
    'base:app_id': '6a10ca5b2f5dad1ef72e65a5',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppBootstrap />
        {children}
      </body>
    </html>
  )
}

