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
      className={`fixed bottom-6 right-6 z-[600] flex items-center gap-3 px-5 py-3.5 border border-[var(--border)] border-l-4 ${colors[toast.type]} animate-fade-up min-w-72 max-w-sm cursor-pointer`}
      onClick={clearToast}
    >
      <span className="text-[16px]">{icons[toast.type]}</span>
      <span className="text-[13px] font-semibold text-[var(--text)]">{toast.message}</span>
    </div>
  )
}
