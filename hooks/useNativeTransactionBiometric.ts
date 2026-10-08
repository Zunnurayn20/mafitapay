'use client'

import { useEffect, useState } from 'react'
import {
  authenticateBiometric,
  BIOMETRIC_SETTING_CHANGED_EVENT,
  BIOMETRIC_TRANSACTION_KEY,
  getBiometricAvailability,
  readBiometricSetting,
} from '@/lib/client/native-biometric'

export function useNativeTransactionBiometric() {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const syncSetting = () => {
      setEnabled(readBiometricSetting(BIOMETRIC_TRANSACTION_KEY, false))
    }
    const onSettingChanged = (event: Event) => {
      const changedKey = (event as CustomEvent<{ key?: string }>).detail?.key
      if (changedKey === BIOMETRIC_TRANSACTION_KEY) syncSetting()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === BIOMETRIC_TRANSACTION_KEY) syncSetting()
    }

    void (async () => {
      const availability = await getBiometricAvailability()
      if (cancelled) return
      setEnabled(availability.available && readBiometricSetting(BIOMETRIC_TRANSACTION_KEY, false))
    })()
    window.addEventListener(BIOMETRIC_SETTING_CHANGED_EVENT, onSettingChanged)
    window.addEventListener('storage', onStorage)
    return () => {
      cancelled = true
      window.removeEventListener(BIOMETRIC_SETTING_CHANGED_EVENT, onSettingChanged)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  async function confirmWithNativeBiometric(options?: {
    title?: string
    subtitle?: string
  }) {
    setBusy(true)
    try {
      const result = await authenticateBiometric({
        title: options?.title ?? 'Confirm transaction',
        subtitle: options?.subtitle ?? 'Use fingerprint or face instead of PIN',
      })
      return result
    } finally {
      setBusy(false)
    }
  }

  return {
    nativeTransactionBiometricEnabled: enabled,
    nativeBiometricBusy: busy,
    confirmWithNativeBiometric,
  }
}
