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
    if (!isNativeApp() || !authResolved) return
    hideNativeSplashWhenReady()
  }, [authResolved])

  return null
}