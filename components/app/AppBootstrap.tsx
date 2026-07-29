'use client'

import { useEffect } from 'react'
import { hideNativeSplashWhenReady, initializeNativeShell } from '@/lib/client/native-shell'
import { isNativeApp } from '@/lib/client/native-app'
import { useAppStore } from '@/store'

export function AppBootstrap() {
  const bootstrap = useAppStore(state => state.bootstrap)
  const authResolved = useAppStore(state => state.authResolved)

  useEffect(() => {
    void initializeNativeShell()
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    // Hide native splash once app JS is up (brand web splash may still show briefly)
    if (typeof window === 'undefined') return
    const t = window.setTimeout(() => {
      hideNativeSplashWhenReady()
    }, isNativeApp() ? 400 : 0)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!isNativeApp() || !authResolved) return
    hideNativeSplashWhenReady()
  }, [authResolved])

  return null
}
