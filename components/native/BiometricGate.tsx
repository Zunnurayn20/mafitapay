'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Fingerprint, Loader2, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  authenticateBiometric,
  BIOMETRIC_UNLOCK_KEY,
  biometricUnavailableHint,
  clearBiometricSession,
  getBiometricAvailability,
  isBiometricSessionUnlocked,
  markBiometricSessionUnlocked,
  readBiometricSetting,
  writeBiometricSetting,
} from '@/lib/client/native-biometric'

type GateState = 'checking' | 'open' | 'locked' | 'unavailable'

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('checking')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const promptOnLock = useRef(true)

  const unlock = useCallback(async () => {
    setBusy(true)
    setError(null)
    const result = await authenticateBiometric({
      title: 'Unlock MafitaPay',
      subtitle: 'Use fingerprint or face to continue',
    })
    setBusy(false)
    if (result.verified) {
      markBiometricSessionUnlocked()
      setState('open')
      return true
    }
    if (!result.cancelled && result.message) {
      setError(result.message)
    }
    return false
  }, [])

  useEffect(() => {
    let cancelled = false
    let removeListener: (() => void) | undefined

    async function boot() {
      const enabled = readBiometricSetting(BIOMETRIC_UNLOCK_KEY, false)
      if (!enabled) {
        if (!cancelled) setState('open')
        return
      }

      if (isBiometricSessionUnlocked()) {
        if (!cancelled) setState('open')
        return
      }

      const availability = await getBiometricAvailability()
      if (cancelled) return

      if (!availability.available) {
        setHint(biometricUnavailableHint(availability.statusLabel))
        setState('unavailable')
        return
      }

      setState('locked')
      if (promptOnLock.current) {
        promptOnLock.current = false
        void unlock()
      }
    }

    void boot()

    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (!readBiometricSetting(BIOMETRIC_UNLOCK_KEY, false)) return

          // Backgrounding no longer locks the app. The unlocked flag lives in sessionStorage,
          // which the WebView discards when the process is killed -- so swiping the app away
          // still forces a fresh scan, while switching out to read an OTP or take a call does
          // not. Clearing it here was what made every resume re-prompt.
          if (!isActive) return

          if (isBiometricSessionUnlocked()) return
          setState(current => {
            if (current === 'unavailable' || current === 'checking') return current
            return 'locked'
          })
          promptOnLock.current = true
          void (async () => {
            const availability = await getBiometricAvailability()
            if (!availability.available) {
              setHint(biometricUnavailableHint(availability.statusLabel))
              setState('unavailable')
              return
            }
            if (promptOnLock.current) {
              promptOnLock.current = false
              void unlock()
            }
          })()
        })
        removeListener = () => {
          void handle.remove()
        }
      } catch {
        // Browser
      }
    })()

    return () => {
      cancelled = true
      removeListener?.()
    }
  }, [unlock])

  if (state === 'open') return <>{children}</>

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--page-bg)] px-6 text-[var(--muted)]">
        <Loader2 size={28} className="animate-spin text-[var(--gold2)]" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--page-bg)] px-6">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--coal)] p-6 text-center shadow-[0_18px_40px_rgba(0,0,0,.28)]">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(202,165,96,.24)] bg-[rgba(202,165,96,.12)]">
          {state === 'unavailable' ? (
            <LockKeyhole size={28} className="text-[var(--gold2)]" />
          ) : (
            <Fingerprint size={30} className="text-[var(--gold2)]" />
          )}
        </div>
        <h1 className="font-display text-xl font-extrabold text-[var(--text)]">
          {state === 'unavailable' ? 'Device lock unavailable' : 'Unlock app'}
        </h1>
        <p className="mt-2 mb-4 text-sm leading-relaxed text-[var(--text2)]">
          {state === 'unavailable'
            ? hint ||
              'Turn off biometric unlock in Security, or set up fingerprint/face unlock on this phone.'
            : 'Verify with your fingerprint or face to continue.'}
        </p>
        {error ? <p className="mb-4 text-xs text-[var(--red2)]">{error}</p> : null}
        {state === 'unavailable' ? (
          <Button
            className="w-full"
            onClick={() => {
              writeBiometricSetting(BIOMETRIC_UNLOCK_KEY, false)
              clearBiometricSession()
              setState('open')
            }}
          >
            Continue without biometrics
          </Button>
        ) : (
          <Button className="w-full" onClick={() => void unlock()} disabled={busy}>
            {busy ? 'Verifying...' : 'Unlock with fingerprint or face'}
          </Button>
        )}
      </div>
    </div>
  )
}
