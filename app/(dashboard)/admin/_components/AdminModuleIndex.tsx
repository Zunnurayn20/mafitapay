'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

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
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visibleItems = useMemo(() => {
    if (!normalizedQuery) return items
    return items.filter(item => `${item.label} ${item.description} ${item.href}`.toLowerCase().includes(normalizedQuery))
  }, [items, normalizedQuery])

  return (
    <div className="space-y-5">
      <section className="border border-[var(--border)] bg-[var(--clay)] p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.45fr)] lg:items-center">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">{title}</div>
            <div className="mt-1 text-[16px] font-black text-[var(--text)]">{title} Management</div>
            <div className="mt-2 max-w-4xl text-[11px] leading-relaxed text-[var(--muted)]">
              {description}
            </div>
          </div>
          <div>
            <label className="relative block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={`Search ${title.toLowerCase()} tools...`}
                className="w-full border border-[var(--border)] bg-[var(--coal)] py-2.5 pl-9 pr-3 text-[11px] font-semibold text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--gold)]"
              />
            </label>
            {normalizedQuery && (
              <button type="button" onClick={() => setQuery('')} className="mt-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">
                Clear search
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {visibleItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex min-h-36 flex-col justify-between border border-[var(--border)] bg-[var(--coal)] p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--gold2)] hover:bg-[rgba(255,255,255,.03)]"
          >
            <div>
              <div className="flex items-start justify-between gap-4">
                <div className="text-[13px] font-black text-[var(--text)]">{item.label}</div>
                <div className="shrink-0 text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)] group-hover:text-[var(--green2)]">Open</div>
              </div>
              <div className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">{item.description}</div>
            </div>
            <div className="mt-5 h-px bg-[linear-gradient(90deg,var(--gold),transparent)] opacity-60" />
          </Link>
        ))}
      </section>
      {visibleItems.length === 0 && (
        <section className="border border-dashed border-[var(--border)] bg-[var(--coal)] p-8 text-center">
          <div className="text-[12px] font-black text-[var(--text)]">No {title.toLowerCase()} tools matched.</div>
          <button type="button" onClick={() => setQuery('')} className="mt-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">
            Clear search
          </button>
        </section>
      )}
    </div>
  )
}
