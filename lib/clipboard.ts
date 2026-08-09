export type ClipboardReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'unavailable' }

/**
 * Reads trimmed clipboard text. Unlike writeText, readText is missing entirely in the
 * Android WebView that wraps this app and on non-HTTPS origins, and is gated behind a
 * pref in Firefox -- so absence is reported as 'unavailable' rather than thrown, letting
 * callers offer long-press paste instead of failing silently.
 */
export async function readClipboardText(): Promise<ClipboardReadResult> {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.readText !== 'function') {
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
