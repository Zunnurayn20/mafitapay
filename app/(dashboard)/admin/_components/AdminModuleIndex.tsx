'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

type AdminModuleIndexItem = {
  href: string
  label: string
  description: string
}

export function AdminModuleIndex({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: readonly AdminModuleIndexItem[]
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--coal)] px-4 py-4 sm:px-5">
        <h2 className="text-xl font-bold text-[var(--text)]">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{description}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--coal)]">
        <div className="divide-y divide-[var(--border)]">
          {items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--clay)]"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text)]">{item.label}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{item.description}</div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
