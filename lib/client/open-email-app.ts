import { registerPlugin } from '@capacitor/core'
import { isAndroidApp, isNativeApp } from '@/lib/client/native-app'

const EmailApp = registerPlugin<{ open(): Promise<{ opened: boolean }> }>('EmailApp')
const WEBMAIL: Record<string, string> = {
  'gmail.com': 'https://mail.google.com/mail/u/0/#inbox',
  'googlemail.com': 'https://mail.google.com/mail/u/0/#inbox',
  'yahoo.com': 'https://mail.yahoo.com/',
  'outlook.com': 'https://outlook.live.com/mail/',
  'hotmail.com': 'https://outlook.live.com/mail/',
  'live.com': 'https://outlook.live.com/mail/',
  'icloud.com': 'https://www.icloud.com/mail',
}

export async function openEmailApp(email: string) {
  if (isNativeApp() && isAndroidApp()) {
    try { if ((await EmailApp.open()).opened) return } catch { /* use the system mail fallback */ }
    window.location.href = 'mailto:'
    return
  }
  if (/Android/i.test(navigator.userAgent)) {
    window.location.href = 'intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;end'
    return
  }
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.location.href = 'message://'
    return
  }
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  if (WEBMAIL[domain]) { window.open(WEBMAIL[domain], '_blank', 'noopener'); return }
  window.location.href = 'mailto:'
}
