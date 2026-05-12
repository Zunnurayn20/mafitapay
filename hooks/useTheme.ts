'use client'
import { useEffect } from 'react'
import { useAppStore } from '@/store'

export function useTheme() {
  const { theme, toggleTheme } = useAppStore()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return { theme, toggleTheme, isDark: theme === 'dark' }
}
