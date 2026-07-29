import { Capacitor } from '@capacitor/core'
import { isNativeApp } from '@/lib/client/native-app'

const MIN_SPLASH_MS = 1600
const MAX_SPLASH_MS = 5000

let initialized = false
let splashStartedAt = 0
let splashHidden = false

async function hideNativeSplash() {
  if (splashHidden || !isNativeApp()) return
  splashHidden = true

  const elapsed = Date.now() - splashStartedAt
  const remaining = Math.max(0, MIN_SPLASH_MS - elapsed)

  window.setTimeout(async () => {
    try {
      const { SplashScreen } = await import('@capacitor/splash-screen')
      await SplashScreen.hide({ fadeOutDuration: 320 })
    } catch {
      // ignore
    }
  }, remaining)
}

export async function initializeNativeShell() {
  if (initialized || !isNativeApp()) return
  initialized = true
  splashStartedAt = Date.now()

  document.documentElement.dataset.nativeApp = Capacitor.getPlatform()

  const [{ App }, { StatusBar, Style }, { Keyboard, KeyboardResize }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/keyboard'),
  ])

  if (Capacitor.getPlatform() === 'android') {
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined)
    await StatusBar.setBackgroundColor({ color: '#0c0907' }).catch(() => undefined)
  }

  await Keyboard.setResizeMode({ mode: KeyboardResize.Body }).catch(() => undefined)

  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back()
      return
    }
    void App.exitApp()
  })

  // Safety: never leave native splash forever if web route hangs
  window.setTimeout(() => {
    void hideNativeSplash()
  }, MAX_SPLASH_MS)
}

export function hideNativeSplashWhenReady() {
  void hideNativeSplash()
}
