import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/register']
const SESSION_COOKIE = 'mfp_session'
const LANDING_SEEN_COOKIE = 'mfp_seen_landing'
const DASHBOARD_PREFIXES = [
  '/dashboard',
  '/history',
  '/p2p',
  '/crypto',
  '/bills',
  '/referrals',
  '/profile',
  '/security',
  '/deposit',
  '/send',
  '/withdraw',
  '/admin',
  '/analytics',
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value)
  const hasSeenLanding = Boolean(request.cookies.get(LANDING_SEEN_COOKIE)?.value)

  if (pathname === '/') {
    if (!hasSession && hasSeenLanding) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const response = NextResponse.next()
    if (!hasSession && !hasSeenLanding) {
      response.cookies.set(LANDING_SEEN_COOKIE, '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      })
    }
    return response
  }

  if (DASHBOARD_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    if (!hasSession) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()

  return NextResponse.next()
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] }
