'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store'

export function AppBootstrap() {
  const bootstrap = useAppStore(state => state.bootstrap)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  return null
}
