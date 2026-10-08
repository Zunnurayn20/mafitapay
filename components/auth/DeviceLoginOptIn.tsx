'use client'

import { useEffect, useState } from 'react'
import { Fingerprint, ShieldCheck, X } from 'lucide-react'
import { canUseFingerprintLogin, enrollFingerprintLogin, DEVICE_LOGIN_ENROLL_EVENT, getDeviceLoginHint } from '@/lib/client/device-login'
import { Capacitor } from '@capacitor/core'
import { useAppStore } from '@/store'

const SKIP_UNTIL_KEY = 'mfp-device-login-opt-out-until'

export function DeviceLoginOptIn() {
  const isAuthenticated = useAppStore(state => state.isAuthenticated)
  const email = useAppStore(state => state.user?.email ?? '')
  const showToast = useAppStore(state => state.showToast)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    async function offer() {
      if (!isAuthenticated || Capacitor.getPlatform() !== 'android' || getDeviceLoginHint()) return
      try {
        if (Number(localStorage.getItem(SKIP_UNTIL_KEY) || 0) > Date.now()) return
      } catch { /* storage may be disabled */ }
      if (await canUseFingerprintLogin()) setOpen(true)
    }
    const handle = () => { void offer() }
    window.addEventListener(DEVICE_LOGIN_ENROLL_EVENT, handle)
    return () => window.removeEventListener(DEVICE_LOGIN_ENROLL_EVENT, handle)
  }, [isAuthenticated])

  function dismiss() {
    try { localStorage.setItem(SKIP_UNTIL_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000)) } catch { /* ignore */ }
    setOpen(false)
  }

  async function enable() {
    setBusy(true)
    try {
      await enrollFingerprintLogin(email)
      setOpen(false)
      showToast('Fingerprint sign-in is ready on this device.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not enable fingerprint sign-in.', 'error')
    } finally { setBusy(false) }
  }

  if (!open) return null
  return <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/65 p-4 sm:items-center" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="device-login-title" className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--coal)] p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--gold)]/30 bg-[var(--gold-tint)] text-[var(--gold2)]"><Fingerprint size={26} /></div>
        <button type="button" aria-label="Not now" onClick={dismiss} disabled={busy} className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--clay)]"><X size={19} /></button>
      </div>
      <h2 id="device-login-title" className="mt-5 font-display text-2xl font-bold text-[var(--text)]">Sign in faster next time?</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text2)]">Use your fingerprint to sign in to MafitaPay on this Android device. Your sign-in key stays protected by this device.</p>
      <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]"><ShieldCheck size={16} className="text-[var(--success-text)]" /> Only this device&apos;s strong biometrics can unlock the sign-in key.</div>
      <button type="button" onClick={() => void enable()} disabled={busy} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold)] px-5 text-base font-bold text-[var(--coal)] disabled:opacity-60">{busy ? 'Setting up…' : <><Fingerprint size={19} /> Turn on fingerprint sign-in</>}</button>
      <button type="button" onClick={dismiss} disabled={busy} className="mt-2 min-h-11 w-full rounded-xl text-sm font-semibold text-[var(--text2)] disabled:opacity-60">Not now</button>
    </section>
  </div>
}
