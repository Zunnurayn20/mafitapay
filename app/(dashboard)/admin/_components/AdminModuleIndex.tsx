import Link from 'next/link'

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
    <div className="space-y-6">
      <section className="border border-[var(--border)] bg-[var(--clay)] p-5">
        <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">{title}</div>
        <div className="mt-2 text-[16px] font-black text-[var(--text)]">{title} Management</div>
        <div className="mt-2 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
          {description}
        </div>
      </section>

      <section className="overflow-hidden border border-[var(--border)] bg-[var(--coal)]">
        <div className="grid grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] border-b border-[var(--border)] bg-[rgba(255,255,255,.02)] px-4 py-3 text-[9px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">
          <div>Submodule</div>
          <div>Description</div>
          <div>Action</div>
        </div>
        <div>
          {items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="grid grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--border)] px-4 py-4 transition-colors last:border-b-0 hover:bg-[rgba(255,255,255,.03)]"
            >
              <div className="text-[12px] font-bold text-[var(--text)]">{item.label}</div>
              <div className="text-[11px] leading-relaxed text-[var(--muted)]">{item.description}</div>
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Open</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
