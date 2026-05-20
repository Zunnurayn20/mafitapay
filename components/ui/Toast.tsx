'use client'
import { useAppStore } from '@/store'

export function Toast() {
  const { toast, clearToast } = useAppStore()
  if (!toast) return null

  const colors = {
    success: 'border-l-[var(--green)] bg-[rgba(46,170,92,.08)]',
    error:   'border-l-[var(--red2)] bg-[rgba(196,52,26,.08)]',
    info:    'border-l-[var(--gold2)] bg-[rgba(79,70,229,.08)]',
  }
  const icons = { success: '✓', error: '✕', info: 'ℹ' }

  return (
    <div
      className={`fixed left-1/2 top-4 z-[600] flex w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 border border-[var(--border)] border-l-4 px-4 py-3 ${colors[toast.type]} animate-fade-up cursor-pointer sm:left-auto sm:right-6 sm:top-auto sm:bottom-6 sm:w-auto sm:translate-x-0 sm:px-5 sm:py-3.5`}
      onClick={clearToast}
    >
      <span className="text-[16px]">{icons[toast.type]}</span>
      <span className="text-[13px] font-semibold text-[var(--text)]">{toast.message}</span>
    </div>
  )
}
