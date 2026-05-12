import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/register']
const SESSION_COOKIE = 'mfp_session'
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
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value)

  if (pathname === '/') {
    return NextResponse.next()
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
