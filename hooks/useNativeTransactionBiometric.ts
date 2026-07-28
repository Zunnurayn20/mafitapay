'use client'

import { useEffect, useState } from 'react'
import {
  authenticateBiometric,
  BIOMETRIC_TRANSACTION_KEY,
  getBiometricAvailability,
  readBiometricSetting,
} from '@/lib/client/native-biometric'

export function useNativeTransactionBiometric() {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const availability = await getBiometricAvailability()
      if (cancelled) return
      setEnabled(availability.available && readBiometricSetting(BIOMETRIC_TRANSACTION_KEY, false))
    })()
    return () => {
      cancelled = true
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
