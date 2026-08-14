'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Fingerprint, Loader2, XCircle } from 'lucide-react'
import { createBiometricApproval } from '@/lib/client/biometric'
import { authenticateBiometric, BIOMETRIC_TRANSACTION_KEY, getBiometricAvailability, readBiometricSetting } from '@/lib/client/native-biometric'
import { clearPendingConfirmation, loadPendingConfirmation, type PendingConfirmation } from '@/lib/client/transaction-confirmation'
import { formatNGN } from '@/lib/utils'
import { useAppStore } from '@/store'

type Phase = 'review' | 'processing' | 'success' | 'failed'

export default function ConfirmTransactionPage() {
  const router = useRouter()
  const refreshSession = useAppStore(state => state.refreshSession)
  const [payload, setPayload] = useState<PendingConfirmation | null>(null)
  const [phase, setPhase] = useState<Phase>('review')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [reference, setReference] = useState('')
  const [nativeBiometric, setNativeBiometric] = useState(false)
  const [biometricBusy, setBiometricBusy] = useState(false)

  useEffect(() => {
    setPayload(loadPendingConfirmation())
    void getBiometricAvailability().then(result => setNativeBiometric(result.available && readBiometricSetting(BIOMETRIC_TRANSACTION_KEY, false)))
  }, [])

  async function submit(auth: Record<string, unknown>) {
    if (!payload || phase === 'processing') return
    setPhase('processing'); setError('')
    try {
      const endpoint = payload.kind === 'bill' ? '/api/bills' : payload.kind === 'transfer' ? '/api/wallet/send' : payload.kind === 'withdrawal' ? '/api/wallet/withdraw' : '/api/crypto'
      const body = payload.kind === 'crypto_buy'
        ? { intent: 'execute', action: 'buy', ...payload.request, ...auth }
        : { ...payload.request, ...auth }
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok || result.success === false) throw new Error(result.error || 'Transaction failed.')
      const transaction = result.data?.transaction ?? result.transaction
      setReference(transaction?.reference || '')
      await refreshSession()
      clearPendingConfirmation()
      setPhase('success')
    } catch (cause) {
      setPin(''); setError(cause instanceof Error ? cause.message : 'Transaction failed.'); setPhase('failed')
    }
  }

  function press(digit: string) {
    if (phase !== 'review' || biometricBusy || pin.length >= 4) return
    const next = pin + digit; setPin(next); setError('')
    if (next.length === 4) void submit({ transactionPin: next })
  }

  async function confirmNativeBiometric() {
    if (biometricBusy) return
    setBiometricBusy(true); setError('')
    try {
      const result = await authenticateBiometric({ title: 'Confirm transaction', subtitle: 'Use fingerprint or face instead of PIN' })
      if (result.verified) await submit({ confirmWithBiometric: true })
      else if (!result.cancelled) setError(result.message || 'Biometric verification failed.')
    } finally { setBiometricBusy(false) }
  }

  async function confirmPasskey() {
    try { const approval = await createBiometricApproval(); await submit({ biometricApprovalToken: approval.token }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Biometric approval failed.') }
  }

  if (!payload) return <main className="mx-auto min-h-screen max-w-md px-5 py-10"><div className="border border-[var(--border)] bg-[var(--coal)] p-7 text-center"><p className="text-sm text-[var(--text2)]">No transaction waiting for confirmation.</p><button onClick={() => router.push('/dashboard')} className="mt-5 text-xs font-bold text-[var(--gold2)]">Go to dashboard</button></div></main>

  return <main className="mx-auto min-h-screen max-w-md px-5 py-6 pb-16">
    {phase === 'review' ? <button onClick={() => { clearPendingConfirmation(); router.back() }} className="mb-5 flex items-center gap-1.5 text-xs text-[var(--muted)]"><ArrowLeft size={14} /> Cancel</button> : <div className="mb-5 h-5" />}
    <section className="mb-5 border border-[var(--border)] bg-[var(--coal)] p-5">
      <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[var(--gold)]">{phase === 'review' ? 'Review transaction' : phase}</div>
      <h1 className="mt-1 font-display text-2xl font-black text-[var(--text)]">{payload.title}</h1>
      <div className="mt-1 font-display text-3xl font-black text-[var(--gold2)]">{formatNGN(payload.amountNgn)}</div>
      <div className="mt-5 border-y border-[var(--border)]">{payload.details.map(detail => <div key={detail.label} className="flex justify-between gap-4 border-b border-[var(--border)] py-2.5 text-sm last:border-0"><span className="text-[var(--muted)]">{detail.label}</span><span className="break-all text-right font-medium text-[var(--text)]">{detail.value}</span></div>)}{reference && <div className="flex justify-between gap-4 py-2.5 text-sm"><span className="text-[var(--muted)]">Reference</span><span className="font-mono text-[var(--gold2)]">{reference}</span></div>}</div>
    </section>
    {phase === 'review' && <section className="border border-[var(--border)] bg-[var(--clay)] p-5 text-center"><p className="text-sm font-semibold text-[var(--text)]">{nativeBiometric ? 'PIN or biometrics to confirm' : 'Enter PIN to confirm'}</p><div className="my-5 flex justify-center gap-3">{[0,1,2,3].map(index => <span key={index} className={`h-3 w-3 rounded-full border border-[var(--gold)] ${index < pin.length ? 'bg-[var(--gold)]' : ''}`} />)}</div><div className="grid grid-cols-3 gap-2">{['1','2','3','4','5','6','7','8','9'].map(digit => <button key={digit} onClick={() => press(digit)} className="h-14 border border-[var(--border)] bg-[var(--coal)] text-xl font-semibold text-[var(--text)]">{digit}</button>)}{nativeBiometric ? <button onClick={() => void confirmNativeBiometric()} className="flex h-14 items-center justify-center border border-[var(--gold)] text-[var(--gold2)]"><Fingerprint /></button> : <span />}<button onClick={() => press('0')} className="h-14 border border-[var(--border)] bg-[var(--coal)] text-xl font-semibold text-[var(--text)]">0</button><button onClick={() => setPin(pin.slice(0,-1))} className="h-14 text-xs font-bold text-[var(--muted)]">Delete</button></div><button onClick={() => void confirmPasskey()} className="mt-4 text-xs font-bold text-[var(--gold2)]">Use passkey instead</button>{error && <p className="mt-3 text-xs text-[var(--red2)]">{error}</p>}</section>}
    {phase === 'processing' && <section className="border border-[var(--border)] bg-[var(--coal)] p-10 text-center"><Loader2 className="mx-auto animate-spin text-[var(--gold)]" size={36}/><p className="mt-4 text-sm font-semibold text-[var(--text)]">Processing transaction</p><p className="mt-2 text-xs text-[var(--muted)]">Do not close this page while we confirm your payment.</p></section>}
    {phase === 'success' && <section className="border border-[var(--border)] bg-[var(--coal)] p-8 text-center"><CheckCircle2 className="mx-auto text-[var(--green2)]" size={42}/><h2 className="mt-4 font-display text-xl font-black text-[var(--text)]">Transaction successful</h2><button onClick={() => router.push('/history')} className="mt-6 w-full bg-[var(--gold)] py-3 text-xs font-bold text-white">View history</button><button onClick={() => router.push(payload.returnPath)} className="mt-3 text-xs font-bold text-[var(--gold2)]">Done</button></section>}
    {phase === 'failed' && <section className="border border-[var(--border)] bg-[var(--coal)] p-8 text-center"><XCircle className="mx-auto text-[var(--red2)]" size={42}/><h2 className="mt-4 font-display text-xl font-black text-[var(--text)]">Transaction failed</h2><p className="mt-2 text-xs text-[var(--red2)]">{error}</p><button onClick={() => { setPhase('review'); setError('') }} className="mt-6 w-full bg-[var(--gold)] py-3 text-xs font-bold text-white">Try again</button></section>}
  </main>
}
