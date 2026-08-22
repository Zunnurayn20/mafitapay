'use client'
import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { applyTheme } from '@/lib/client/native-system-bars'

export function useTheme() {
  const { theme, toggleTheme } = useAppStore()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return { theme, toggleTheme, isDark: theme === 'dark' }
}
