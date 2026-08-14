'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Delete, Fingerprint, Landmark, Loader2, ReceiptText, ShoppingBag, XCircle } from 'lucide-react'
import { createBiometricApproval } from '@/lib/client/biometric'
import { authenticateBiometric, BIOMETRIC_TRANSACTION_KEY, getBiometricAvailability, readBiometricSetting } from '@/lib/client/native-biometric'
import { clearPendingConfirmation, loadPendingConfirmation, type PendingConfirmation } from '@/lib/client/transaction-confirmation'
import { formatNGN } from '@/lib/utils'
import { useAppStore } from '@/store'

type Phase = 'review' | 'processing' | 'success' | 'failed'

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-2 last:border-0">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <span className="break-all text-right text-[13px] font-medium text-[var(--text)]">{value}</span>
    </div>
  )
}

function NativePinPad({
  onPress,
  onBackspace,
  onBiometric,
  biometricBusy,
}: {
  onPress: (digit: string) => void
  onBackspace: () => void
  onBiometric?: () => void
  biometricBusy: boolean
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', onBiometric ? 'bio' : '', '0', 'back']
  return (
    <div className="grid grid-cols-3 gap-2.5 px-3">
      {keys.map((key, index) => {
        if (!key) return <div key={index} />
        if (key === 'bio') return <button key={key} type="button" onClick={onBiometric} disabled={biometricBusy} aria-label="Confirm with fingerprint or face" className="flex h-12 items-center justify-center rounded-2xl border border-[var(--gold)]/30 bg-[rgba(202,165,96,.12)] text-[var(--gold2)] active:scale-95 disabled:opacity-60"><Fingerprint size={22} className={biometricBusy ? 'animate-pulse' : ''} /></button>
        if (key === 'back') return <button key={key} type="button" onClick={onBackspace} aria-label="Backspace" className="flex h-12 items-center justify-center rounded-2xl text-[var(--muted)] active:bg-[var(--clay2)]"><Delete size={20} /></button>
        return <button key={key} type="button" onClick={() => onPress(key)} className="h-12 rounded-2xl border border-[var(--border)] bg-[var(--coal)] text-lg font-semibold text-[var(--text)] shadow-[0_4px_12px_rgba(0,0,0,.12)] transition active:scale-95 active:bg-[var(--clay2)]">{key}</button>
      })}
    </div>
  )
}

export default function ConfirmTransactionPage() {
  const router = useRouter()
  const refreshSession = useAppStore(state => state.refreshSession)
  const [payload, setPayload] = useState<PendingConfirmation | null>(null)
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<Phase>('review')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [error, setError] = useState('')
  const [reference, setReference] = useState('')
  const [nativeBiometric, setNativeBiometric] = useState(false)
  const [biometricBusy, setBiometricBusy] = useState(false)

  useEffect(() => {
    setPayload(loadPendingConfirmation())
    setReady(true)
    void getBiometricAvailability().then(result => setNativeBiometric(result.available && readBiometricSetting(BIOMETRIC_TRANSACTION_KEY, false)))
  }, [])

  useEffect(() => {
    if (phase !== 'processing') return
    const blockLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', blockLeave)
    return () => window.removeEventListener('beforeunload', blockLeave)
  }, [phase])

  async function submit(auth: Record<string, unknown>) {
    if (!payload || phase === 'processing') return
    setPinError(''); setError(''); setPhase('processing')
    try {
      const endpoint = payload.kind === 'bill' ? '/api/bills' : payload.kind === 'transfer' ? '/api/wallet/send' : payload.kind === 'withdrawal' ? '/api/wallet/withdraw' : '/api/crypto'
      const body = payload.kind === 'crypto_buy' ? { intent: 'execute', action: 'buy', ...payload.request, ...auth } : { ...payload.request, ...auth }
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      const result = await response.json()
      if (response.status === 401) {
        setPin(''); setPinError(result.error || 'Incorrect transaction PIN.'); setPhase('review'); return
      }
      if (!response.ok || result.success === false) throw new Error(result.error || 'Transaction failed.')
      const transaction = result.data?.transaction ?? result.transaction
      setReference(transaction?.reference || '')
      await refreshSession()
      clearPendingConfirmation()
      setPhase('success')
    } catch (cause) {
      setPin(''); setError(cause instanceof Error ? cause.message : 'Network error. Please try again.'); setPhase('failed')
    }
  }

  function press(digit: string) {
    if (phase !== 'review' || biometricBusy || pin.length >= 4) return
    const next = pin + digit
    setPin(next); setPinError('')
    if (next.length === 4) void submit({ transactionPin: next })
  }

  async function confirmNativeBiometric() {
    if (phase !== 'review' || biometricBusy) return
    setBiometricBusy(true); setPinError('')
    try {
      const result = await authenticateBiometric({ title: 'Confirm payment', subtitle: 'Use fingerprint or face instead of PIN' })
      if (result.verified) await submit({ confirmWithBiometric: true })
      else if (!result.cancelled) setPinError(result.message || 'Biometric verification failed.')
    } finally { setBiometricBusy(false) }
  }

  async function confirmPasskey() {
    try { const approval = await createBiometricApproval(); await submit({ biometricApprovalToken: approval.token }) }
    catch (cause) { setPinError(cause instanceof Error ? cause.message : 'Passkey confirmation failed.') }
  }

  if (!ready) return <main className="flex h-[100dvh] items-center justify-center bg-[var(--bg)] text-sm text-[var(--muted)]">Loading…</main>
  if (!payload) return <main className="flex h-[100dvh] items-center justify-center bg-[var(--bg)] px-5"><section className="w-full max-w-sm border border-[var(--border)] bg-[var(--coal)] p-7 text-center"><p className="text-sm text-[var(--text2)]">No transaction waiting for confirmation.</p><button onClick={() => router.push('/dashboard')} className="mt-6 text-xs font-bold text-[var(--gold2)]">Go to dashboard</button></section></main>

  const Icon = payload.kind === 'bill' ? ReceiptText : payload.kind === 'crypto_buy' ? ShoppingBag : Landmark
  const stateLabel = phase === 'processing' ? 'Processing' : phase === 'success' ? 'Successful' : 'Failed'
  const stateTitle = phase === 'processing' ? 'Please wait…' : payload.title
  const stateCopy = phase === 'processing' ? 'Do not close this page while we complete your transaction.' : phase === 'success' ? 'Your transaction was completed and your wallet has been updated.' : phase === 'failed' ? 'Nothing was completed successfully. You can try again.' : ''

  return (
    <main className="flex h-[100dvh] max-w-lg flex-col overflow-hidden bg-[var(--bg)] px-3 pb-5 pt-5 sm:mx-auto sm:px-4">
      <div className="shrink-0">
        {phase === 'review' ? <button type="button" onClick={() => { clearPendingConfirmation(); router.back() }} className="mb-5 flex items-center gap-1.5 text-xs text-[var(--muted)]"><ArrowLeft size={14} /> Cancel</button> : <div className="mb-5 h-5" />}
        {phase !== 'review' && <div className="mb-5">
          <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[var(--gold2)]">{stateLabel}</div>
          <h1 className="mt-1 text-[26px] font-black tracking-tight text-[var(--text)]">{stateTitle}</h1>
          {stateCopy && <p className="mt-1.5 text-sm text-[var(--muted)]">{stateCopy}</p>}
        </div>}
        <section className={`rounded-2xl border border-[var(--border)] bg-[var(--coal)] p-5 ${phase === 'review' ? 'mt-1' : ''}`}>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[rgba(202,165,96,.14)] text-[var(--gold2)]"><Icon size={19} /></div>
            <div className="min-w-0"><div className="truncate text-sm font-bold text-[var(--text)]">{payload.title}</div><div className="mt-0.5 text-2xl font-black tracking-tight text-[var(--gold2)]">{formatNGN(payload.amountNgn)}</div></div>
          </div>
          <div>{payload.details.map(detail => <DetailRow key={detail.label} {...detail} />)}{reference && <DetailRow label="Reference" value={reference} />}</div>
        </section>
      </div>

      {phase === 'review' && <section className="shrink-0 px-1 pt-5 text-center">
        <p className="text-[13px] font-semibold text-[var(--text)]">{nativeBiometric ? 'PIN or biometrics to confirm' : 'Enter PIN to confirm'}</p>
        <div className="my-4 flex justify-center gap-3.5">{[0, 1, 2, 3].map(index => <span key={index} className={`h-3 w-3 rounded-full transition-all ${index < pin.length ? 'scale-110 bg-[var(--gold)] shadow-[0_0_0_4px_rgba(202,165,96,.13)]' : 'bg-[var(--clay2)]'}`} />)}</div>
        {nativeBiometric && <p className="mb-2 text-[10px] text-[var(--muted)]">Enter your PIN, or tap the fingerprint icon.</p>}
        <NativePinPad onPress={press} onBackspace={() => { if (!biometricBusy) { setPin(pin.slice(0, -1)); setPinError('') } }} onBiometric={nativeBiometric ? () => void confirmNativeBiometric() : undefined} biometricBusy={biometricBusy} />
        <button onClick={() => void confirmPasskey()} className="mt-3 text-[10px] font-bold text-[var(--gold2)]">Use passkey instead</button>
        {pinError && <p className="mt-2 text-xs font-medium text-[var(--red2)]">{pinError}</p>}
      </section>}

      {phase === 'processing' && <section className="my-auto border border-[var(--border)] bg-[var(--coal)] p-8 text-center"><Loader2 size={36} className="mx-auto animate-spin text-[var(--gold)]" /><div className="mt-4 text-sm font-semibold text-[var(--text)]">Processing payment</div><p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">Stay on this screen. We’re confirming with the provider and updating your wallet.</p><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[var(--clay2)]"><div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--gold)]" /></div></section>}
      {phase === 'success' && <section className="my-auto border border-[var(--border)] bg-[var(--coal)] p-7 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50"><CheckCircle2 size={32} className="text-emerald-600" /></div><div className="mt-4 text-lg font-bold text-[var(--text)]">Transaction successful</div><p className="mt-1.5 text-xs text-[var(--muted)]">{formatNGN(payload.amountNgn)} · {payload.title}</p><button onClick={() => router.push('/history')} className="mt-6 w-full bg-[var(--gold)] py-3 text-xs font-bold text-white">View history</button><button onClick={() => router.push(payload.returnPath)} className="mt-2.5 w-full border border-[var(--border)] py-3 text-xs font-bold text-[var(--text)]">Done</button></section>}
      {phase === 'failed' && <section className="my-auto border border-[var(--border)] bg-[var(--coal)] p-7 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(239,68,68,.12)]"><XCircle size={32} className="text-[var(--red2)]" /></div><div className="mt-4 text-lg font-bold text-[var(--text)]">Transaction failed</div><p className="mt-1.5 text-xs font-medium text-[var(--red2)]">{error}</p><button onClick={() => { setPhase('review'); setPin(''); setError(''); setPinError('') }} className="mt-6 w-full bg-[var(--gold)] py-3 text-xs font-bold text-white">Try again</button><button onClick={() => { clearPendingConfirmation(); router.push(payload.returnPath) }} className="mt-2.5 w-full border border-[var(--border)] py-3 text-xs font-bold text-[var(--text)]">Cancel</button></section>}
    </main>
  )
}
