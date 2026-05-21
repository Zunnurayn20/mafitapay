'use client'
import { useAppStore } from '@/store'

export function Toast() {
  const { toast, clearToast } = useAppStore()
  if (!toast) return null

  const colors = {
    success: 'border-l-emerald-400 border-emerald-500 bg-emerald-500 text-white',
    error:   'border-l-red-300 border-red-500 bg-red-500 text-white',
    info:    'border-l-[var(--gold)] border-[var(--gold)] bg-[var(--gold)] text-[var(--ink)]',
  }
  const icons = { success: '✓', error: '✕', info: 'ℹ' }

  return (
    <div
      className={`fixed left-1/2 top-4 z-[600] flex w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 border border-[var(--border)] border-l-4 px-4 py-3 ${colors[toast.type]} animate-fade-up cursor-pointer sm:left-auto sm:right-6 sm:top-auto sm:bottom-6 sm:w-auto sm:translate-x-0 sm:px-5 sm:py-3.5`}
      onClick={clearToast}
    >
      <span className="text-[16px]">{icons[toast.type]}</span>
      <span className="text-[13px] font-semibold">{toast.message}</span>
    </div>
  )
}
