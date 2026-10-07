'use client'
import { cn } from '@/lib/utils'

export function SegmentedControl({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string; icon?: React.ReactNode }[] }) {
  return <div className="grid grid-cols-2 gap-1 rounded-[14px] border border-[var(--border)] bg-[var(--coal)] p-1" role="tablist">
    {options.map(option => <button key={option.value} type="button" role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)} className={cn('flex h-11 items-center justify-center gap-2 rounded-[10px] text-[14.5px] font-semibold', value === option.value ? 'bg-[var(--clay2)] text-[var(--gold2)] shadow-[inset_0_0_0_1px_var(--gold)]' : 'text-[var(--muted)]')}>
      {option.icon}{option.label}
    </button>)}
  </div>
}
