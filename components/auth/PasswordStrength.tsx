'use client'
import { Check, ShieldCheck } from 'lucide-react'
import { passwordChecks } from '@/lib/auth/validation'

export function scorePassword(password: string) {
  const checks = passwordChecks(password)
  const base = Number(checks.length) + Number(checks.letter) + Number(checks.number)
  const bonus = password.length >= 12 || (/[a-z]/.test(password) && /[A-Z]/.test(password)) || /[^A-Za-z0-9]/.test(password) ? 1 : 0
  return base === 3 ? 3 + bonus : base
}
const LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const

export function PasswordStrength({ password, id }: { password: string; id: string }) {
  const checks = passwordChecks(password)
  const score = scorePassword(password)
  const tone = score >= 3 ? 'var(--success-text)' : score === 2 ? 'var(--gold)' : 'var(--danger-text)'
  return <div id={id} className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--coal)] p-3.5" aria-live="polite">
    <div className="flex items-center justify-between text-[13.5px] font-medium text-[var(--text2)]"><span>Password strength</span><b className="flex items-center gap-1.5 font-bold" style={{ color: tone }}><ShieldCheck size={16} />{password ? LABELS[score] : '—'}</b></div>
    <div className="grid grid-cols-4 gap-[5px]" aria-hidden="true">{[0, 1, 2, 3].map(i => <i key={i} className="h-1.5 rounded" style={{ background: i < score ? tone : 'var(--clay)' }} />)}</div>
    <ul className="flex flex-wrap justify-between gap-1.5">{([['length', '8+ characters'], ['letter', 'A letter'], ['number', 'A number']] as const).map(([key, label]) => <li key={key} className="inline-flex items-center gap-[7px] text-[13.5px] font-semibold" style={{ color: checks[key] ? 'var(--success-text)' : 'var(--muted)' }}><span className="grid h-[18px] w-[18px] place-items-center rounded-full" style={{ background: checks[key] ? 'var(--green2)' : 'var(--clay)', color: '#0c1a10' }}>{checks[key] ? <Check size={12} strokeWidth={3.2} /> : null}</span>{label}<span className="sr-only">{checks[key] ? ' (met)' : ' (not met)'}</span></li>)}</ul>
  </div>
}
