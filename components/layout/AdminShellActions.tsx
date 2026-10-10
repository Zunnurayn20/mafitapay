'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, LogOut } from 'lucide-react'
import { useAppStore } from '@/store'

export function AdminShellActions() {
  const router = useRouter()
  const logout = useAppStore(state => state.logout)

  async function handleLogout() {
    await logout()
    router.push('/login')
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      <Link
        href="/dashboard"
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--clay)] px-3 text-sm font-semibold text-[var(--text)] transition-colors hover:border-[var(--gold2)] hover:bg-[var(--clay2)] sm:w-fit"
      >
        <ArrowLeft size={16} />
        Customer app
      </Link>
      <button
        type="button"
        onClick={() => void handleLogout()}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-3 text-sm font-semibold text-[var(--muted)] transition-colors hover:border-[var(--border2)] hover:bg-[var(--clay)] hover:text-[var(--text)] sm:w-fit"
      >
        <LogOut size={16} />
        Sign out
      </button>
    </div>
  )
}
