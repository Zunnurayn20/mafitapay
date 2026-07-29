import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/server/auth'
import { SplashScreen } from '@/components/auth/SplashScreen'

/**
 * App entry: brand splash (like online-data-sub), then route to dashboard or login.
 * Desktop marketing landing is skipped so mobile/native open cleanly into the product.
 */
export default async function Root() {
  const user = await getCurrentUser()
  const cookieStore = await cookies()
  const hasSeenLanding = Boolean(cookieStore.get('mfp_seen_landing')?.value)

  let nextPath = '/login'
  if (user) {
    nextPath = '/dashboard'
  } else if (!hasSeenLanding) {
    // First web visit can still go login after splash (proxy sets landing cookie).
    nextPath = '/login'
  }

  return <SplashScreen nextPath={nextPath} />
}
