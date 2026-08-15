import { isNativeApp } from '@/lib/client/native-app'

/**
 * Fires a light impact for taps on primary controls (the bottom nav tabs today).
 *
 * Deliberately synchronous fire-and-forget rather than async: haptics are cosmetic, so a
 * device without a vibrator, a revoked permission, or a plugin missing on an unexpected
 * platform must never delay or block the interaction that triggered it. Callers can hand
 * this straight to onClick without awaiting. The plugin is imported lazily so the browser
 * bundle never pays for it, matching how native-push and clipboard load theirs.
 */
export function tapFeedback() {
  if (!isNativeApp()) return

  void (async () => {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
      await Haptics.impact({ style: ImpactStyle.Light })
    } catch {
      // ignore -- cosmetic only, and never worth surfacing to the user
    }
  })()
}
