import { registerPlugin } from '@capacitor/core'
import { isAndroidApp } from '@/lib/client/native-app'
import type { Theme } from '@/types'

interface SystemBarsPlugin {
  setNavigationBarAppearance(options: { lightTheme: boolean }): Promise<void>
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

/** Status bar backdrop for pre-Android-15 devices, which still paint one. Matches --page-bg. */
const STATUS_BAR_BACKGROUND: Record<Theme, string> = {
  dark: '#0c0907',
  light: '#f4ede2',
}

/**
 * Tell the shell which palette is on screen.
 *
 * The navigation bar is transparent with no contrast scrim, so back / home / recents are drawn
 * straight onto our page. Left alone, Android colours them from its own DayNight resolution —
 * the device setting — which goes the wrong way whenever the in-app theme disagrees with it.
 * The status bar goes through the official plugin; only the navigation bar needs ours.
 */
export function syncNativeSystemBars(theme: Theme) {
  if (!isAndroidApp()) return

  const lightTheme = theme === 'light'

  void SystemBars.setNavigationBarAppearance({ lightTheme }).catch(() => undefined)

  void (async () => {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      // Style is named for the background it sits on: Light means dark icons for a light page.
      await StatusBar.setStyle({ style: lightTheme ? Style.Light : Style.Dark })
      await StatusBar.setBackgroundColor({ color: STATUS_BAR_BACKGROUND[theme] })
    } catch {
      // API 35+ ignores the status bar background; the style call above is what still lands.
    }
  })()
}

/**
 * The one way to put a theme on screen. Keeps the CSS attribute and the native bars in step;
 * they used to be set from eight separate places, and only the CSS half was ever updated.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  syncNativeSystemBars(theme)
}
