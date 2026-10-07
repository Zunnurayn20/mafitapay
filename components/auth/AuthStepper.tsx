export function AuthStepper({ step, label, progress }: { step: 1 | 2; label: string; progress: number }) {
  const fill = (index: number) => index < step - 1 ? 1 : index === step - 1 ? progress : 0
  return <div className="mt-3.5 flex flex-col gap-[9px]" aria-label={`Step ${step} of 2: ${label}`}>
    <div className="flex items-baseline justify-between text-[13.5px]"><b className="font-bold tracking-[.3px] text-[var(--gold2)]">Step {step} of 2</b><span className="font-medium text-[var(--muted)]">{label}</span></div>
    <div className="grid grid-cols-2 gap-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={2} aria-valuenow={step - 1 + progress} aria-label={`Step ${step} of 2`}>
      {[0, 1].map(index => <i key={index} className="relative block h-1.5 overflow-hidden rounded bg-[var(--clay)]"><span className="absolute inset-y-0 left-0 rounded bg-[linear-gradient(90deg,var(--btn-gold-to),var(--gold2))] transition-[width] duration-300" style={{ width: `${Math.round(fill(index) * 100)}%` }} /></i>)}
    </div>
  </div>
}
