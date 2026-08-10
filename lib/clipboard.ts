import { isNativeApp } from '@/lib/client/native-app'

export type ClipboardReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'unavailable' }

/**
 * Reads trimmed clipboard text. Inside the Android WebView the async Clipboard API has no read
 * path (writeText works, readText does not), so the native Capacitor plugin is preferred there.
 * The web API is a fallback for the browser build; absence or rejection in both reports
 * 'unavailable' so callers can offer long-press paste instead of failing silently.
 */
export async function readClipboardText(): Promise<ClipboardReadResult> {
  if (typeof navigator === 'undefined') {
    return { ok: false, reason: 'unavailable' }
  }

  // Native shell first: @capacitor/clipboard reads through Android/iOS APIs rather than the
  // WebView's, which blocks clipboard reads. Imported lazily so the browser bundle never pays
  // for the plugin, matching how native-push loads its plugin.
  if (isNativeApp()) {
    try {
      const { Clipboard } = await import('@capacitor/clipboard')
      const { value } = await Clipboard.read()
      // Guard the bridge result rather than trusting the declared type: an image on the
      // clipboard resolves with a non-string value on some Android versions.
      const trimmed = typeof value === 'string' ? value.trim() : ''
      return trimmed ? { ok: true, text: trimmed } : { ok: false, reason: 'empty' }
    } catch {
      // Fall through to the web API below rather than reporting unavailable outright -- a
      // failure here can be an import error on an unexpected platform, not a blocked read.
    }
  }

  if (typeof navigator.clipboard?.readText !== 'function') {
    return { ok: false, reason: 'unavailable' }
  }

  try {
    const text = await navigator.clipboard.readText()
    const trimmed = text.trim()
    return trimmed ? { ok: true, text: trimmed } : { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
