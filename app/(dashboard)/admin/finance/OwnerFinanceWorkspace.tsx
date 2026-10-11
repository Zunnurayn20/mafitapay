'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { AdminButton, AdminError, AdminInput, AdminSelect, AdminTable, AdminThead, formatDate, formatNaira } from '@/components/admin/AdminUi'

type Summary = {
  income: number
  expense: number
  incomeCount: number
  expenseCount: number
  recordedNet: number
  customerFees: number
  cryptoFeeRecovery: number
  successfulTransactions: number
}

type Entry = {
  id: string
  direction: 'income' | 'expense'
  category: string
  amountNgn: number
  description: string
  counterparty: string | null
  reference: string | null
  occurredAt: string
  createdAt: string
}

type Purchase = {
  id: string
  reference: string
  type: string
  description: string
  status: string
  createdAt: string
  saleNgn: number
  providerCostNgn: number | null
  spreadNgn: number | null
  costStatus: 'quoted' | 'estimate' | 'unknown'
  costBasis: string
  networkFeeRecoveryNgn: number
}

type AutomaticPurchases = {
  successfulCount: number
  saleNgn: number
  quotedCostNgn: number
  quotedSpreadNgn: number
  estimatedCostNgn: number
  estimatedSpreadNgn: number
  unknownCostCount: number
}

type CryptoDeposit = {
  id: string
  reference: string
  type: 'direct_deposit' | 'crypto_sell_order'
  description: string
  status: string
  createdAt: string
  symbol: string
  cryptoAmount: number | null
  customerCreditNgn: number
  marketRate: number | null
  marketValueNgn: number | null
  spreadNgn: number | null
  marketSnapshotSource: string | null
}

type AutomaticDeposits = {
  successfulCount: number
  customerCreditNgn: number
  marketValueNgn: number
  estimatedSpreadNgn: number
  missingMarketSnapshotCount: number
}

const categories = {
  income: [
    ['product_margin', 'Product margin'],
    ['service_fee', 'Service fee'],
    ['other_income', 'Other income'],
  ],
  expense: [
    ['provider_cost', 'Provider cost'],
    ['network_fee', 'Network fee'],
    ['hosting', 'Hosting'],
    ['operations', 'Operations'],
    ['marketing', 'Marketing'],
    ['payroll', 'Payroll'],
    ['other_expense', 'Other expense'],
  ],
} as const

function todayInNigeria() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function categoryLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function Metric({ label, value, detail, tone = 'text-[var(--text)]' }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--clay)] p-4">
      <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{label}</div>
      <div className={`mt-2 text-2xl font-black ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">{detail}</div>
    </div>
  )
}

export function OwnerFinanceWorkspace() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [direction, setDirection] = useState<'income' | 'expense'>('expense')
  const [payload, setPayload] = useState<{ summary: Summary; entries: Entry[]; purchases: Purchase[]; automaticPurchases: AutomaticPurchases; deposits: CryptoDeposit[]; automaticDeposits: AutomaticDeposits } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const today = todayInNigeria()
    setFrom(`${today.slice(0, 8)}01`)
    setTo(today)
  }, [])

  async function load() {
    if (!from || !to) return
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ from, to })
      const response = await fetch(`/api/admin/finance?${query}`, { credentials: 'include', cache: 'no-store' })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) throw new Error(result?.error || 'Could not load finance records.')
      setPayload(result.data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load finance records.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [from, to])

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/admin/finance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction,
          category: String(form.get('category') || ''),
          amountNgn: Number(form.get('amountNgn')),
          description: String(form.get('description') || ''),
          counterparty: String(form.get('counterparty') || ''),
          reference: String(form.get('reference') || ''),
          date: String(form.get('date') || ''),
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) throw new Error(result?.error || 'Could not save the record.')
      event.currentTarget.reset()
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the record.')
    } finally {
      setSaving(false)
    }
  }

  async function voidEntry(id: string) {
    const reason = window.prompt('Why are you voiding this record? The action will be retained in the audit log.')
    if (!reason?.trim()) return
    setError('')
    try {
      const response = await fetch('/api/admin/finance', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, reason }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) throw new Error(result?.error || 'Could not void this record.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not void this record.')
    }
  }

  const summary = payload?.summary
  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-[var(--muted)]">From<AdminInput aria-label="From date" type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-1 block" /></label>
        <label className="text-xs font-semibold text-[var(--muted)]">To<AdminInput aria-label="To date" type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-1 block" /></label>
        <AdminButton type="button" variant="secondary" disabled={loading || !from || !to} onClick={() => void load()}>{loading ? 'Loading…' : 'Refresh'}</AdminButton>
      </div>

      {error ? <AdminError message={error} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Recorded income" value={formatNaira(summary?.income ?? 0)} detail={`${summary?.incomeCount ?? 0} entries`} tone="text-[var(--green2)]" />
        <Metric label="Recorded expenses" value={formatNaira(summary?.expense ?? 0)} detail={`${summary?.expenseCount ?? 0} entries`} tone="text-[var(--red2)]" />
        <Metric label="Recorded net" value={formatNaira(summary?.recordedNet ?? 0)} detail="Income less entered expenses" tone={(summary?.recordedNet ?? 0) >= 0 ? 'text-[var(--green2)]' : 'text-[var(--red2)]'} />
        <Metric label="Tracked customer fees" value={formatNaira(summary?.customerFees ?? 0)} detail={`${summary?.successfulTransactions ?? 0} successful transactions; excludes crypto-buy fee recovery`} tone="text-[var(--gold2)]" />
      </section>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--clay)] p-3 text-xs leading-relaxed text-[var(--muted)]">
        Crypto-buy customer network-fee recovery in this period: <strong className="text-[var(--text)]">{formatNaira(summary?.cryptoFeeRecovery ?? 0)}</strong>. It is separate because it may be passed through to delivery. Product purchase spreads below are recorded automatically when the app has cost data. Manual income is for revenue not already represented by a purchase spread or tracked customer fee.
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-[var(--text)]">Automatically tracked purchases</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Successful customer purchases in the selected period. Vendor catalog costs are quoted costs; crypto values use a market replacement estimate.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Customer purchase value" value={formatNaira(payload?.automaticPurchases.saleNgn ?? 0)} detail={`${payload?.automaticPurchases.successfulCount ?? 0} successful purchases`} />
          <Metric label="Vendor quoted spread" value={formatNaira(payload?.automaticPurchases.quotedSpreadNgn ?? 0)} detail={`Quoted purchase costs ${formatNaira(payload?.automaticPurchases.quotedCostNgn ?? 0)}`} tone="text-[var(--green2)]" />
          <Metric label="Estimated crypto spread" value={formatNaira(payload?.automaticPurchases.estimatedSpreadNgn ?? 0)} detail={`Replacement cost ${formatNaira(payload?.automaticPurchases.estimatedCostNgn ?? 0)}`} tone="text-[var(--gold2)]" />
          <Metric label="Cost not reported" value={String(payload?.automaticPurchases.unknownCostCount ?? 0)} detail="Successful purchases missing provider cost" tone="text-[var(--red2)]" />
        </div>
        {!payload?.purchases.length ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-5 text-center text-sm text-[var(--muted)]">No purchases found in this date range.</div>
        ) : (
          <AdminTable>
            <AdminThead columns={['Purchase', 'Status', 'Customer price', 'Our cost', 'Spread', 'Cost source', '']} />
            <tbody className="divide-y divide-[var(--border)]">
              {payload.purchases.map(purchase => (
                <tr key={purchase.id} className="hover:bg-[var(--clay)]">
                  <td className="px-4 py-3"><div className="font-semibold text-[var(--text)]">{purchase.description}</div><div className="text-xs text-[var(--muted)]">{purchase.type.replaceAll('_', ' ')} · {purchase.reference} · {formatDate(purchase.createdAt)}</div></td>
                  <td className="px-4 py-3 text-xs font-semibold capitalize text-[var(--text2)]">{purchase.status}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-[var(--text)]">{formatNaira(purchase.saleNgn)}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-[var(--text2)]">{purchase.providerCostNgn === null ? 'Not reported' : formatNaira(purchase.providerCostNgn)}</td>
                  <td className={`px-4 py-3 whitespace-nowrap font-mono text-sm ${purchase.spreadNgn === null ? 'text-[var(--muted)]' : 'text-[var(--green2)]'}`}>{purchase.spreadNgn === null ? '—' : formatNaira(purchase.spreadNgn)}{purchase.costStatus === 'estimate' ? ' est.' : ''}</td>
                  <td className="px-4 py-3 text-xs capitalize text-[var(--muted)]">{purchase.costBasis.replaceAll('_', ' ')}{purchase.networkFeeRecoveryNgn > 0 ? <div>Network recovery {formatNaira(purchase.networkFeeRecoveryNgn)}</div> : null}</td>
                  <td className="px-4 py-3 text-right"><Link href={`/admin/transactions/${encodeURIComponent(purchase.id)}`} className="text-xs font-semibold text-[var(--gold2)] hover:underline">Details</Link></td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-[var(--text)]">Crypto deposits and sell orders</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Estimated spread is the market value of crypto received minus the NGN credited. It is a pricing estimate, not realized profit; inventory and delivery costs are not included. Older records may not have a saved market snapshot.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Successful deposits" value={String(payload?.automaticDeposits.successfulCount ?? 0)} detail="Direct credits and completed sell orders" />
          <Metric label="Customer NGN credited" value={formatNaira(payload?.automaticDeposits.customerCreditNgn ?? 0)} detail="Successful deposits in this period" />
          <Metric label="Received crypto value" value={formatNaira(payload?.automaticDeposits.marketValueNgn ?? 0)} detail="Saved market snapshot estimate" tone="text-[var(--gold2)]" />
          <Metric label="Estimated deposit spread" value={formatNaira(payload?.automaticDeposits.estimatedSpreadNgn ?? 0)} detail={`${payload?.automaticDeposits.missingMarketSnapshotCount ?? 0} successful records lack a saved rate`} tone="text-[var(--green2)]" />
        </div>
        {!payload?.deposits.length ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-5 text-center text-sm text-[var(--muted)]">No crypto deposits or sell orders found in this date range.</div>
        ) : (
          <AdminTable>
            <AdminThead columns={['Deposit / sell', 'Status', 'Crypto received', 'Customer credited', 'Market value (est.)', 'Spread (est.)', '']} />
            <tbody className="divide-y divide-[var(--border)]">
              {payload.deposits.map(deposit => (
                <tr key={deposit.id} className="hover:bg-[var(--clay)]">
                  <td className="px-4 py-3"><div className="font-semibold text-[var(--text)]">{deposit.description}</div><div className="text-xs capitalize text-[var(--muted)]">{deposit.type.replaceAll('_', ' ')} · {deposit.reference} · {formatDate(deposit.createdAt)}</div></td>
                  <td className="px-4 py-3 text-xs font-semibold capitalize text-[var(--text2)]">{deposit.status}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-[var(--text)]">{deposit.cryptoAmount === null ? '—' : `${deposit.cryptoAmount.toLocaleString(undefined, { maximumFractionDigits: 10 })} ${deposit.symbol}`}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-[var(--text2)]">{formatNaira(deposit.customerCreditNgn)}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-[var(--text2)]">{deposit.marketValueNgn === null ? 'Not captured' : formatNaira(deposit.marketValueNgn)}</td>
                  <td className={`px-4 py-3 whitespace-nowrap font-mono text-sm ${deposit.spreadNgn === null ? 'text-[var(--muted)]' : 'text-[var(--green2)]'}`}>{deposit.spreadNgn === null ? '—' : `${formatNaira(deposit.spreadNgn)} est.`}{deposit.marketSnapshotSource ? <div className="text-[10px] capitalize text-[var(--muted)]">{deposit.marketSnapshotSource} market</div> : null}</td>
                  <td className="px-4 py-3 text-right"><Link href={`/admin/transactions/${encodeURIComponent(deposit.id)}`} className="text-xs font-semibold text-[var(--gold2)] hover:underline">Details</Link></td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </section>

      <form onSubmit={saveEntry} className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--clay)] p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="sm:col-span-2 xl:col-span-4 text-sm font-bold text-[var(--text)]">Add a finance record</div>
        <label className="text-xs font-semibold text-[var(--muted)]">Type<AdminSelect value={direction} onChange={event => setDirection(event.target.value as 'income' | 'expense')} className="mt-1 block w-full"><option value="expense">Expense</option><option value="income">Income</option></AdminSelect></label>
        <label className="text-xs font-semibold text-[var(--muted)]">Category<AdminSelect name="category" required className="mt-1 block w-full">{categories[direction].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AdminSelect></label>
        <label className="text-xs font-semibold text-[var(--muted)]">Amount (NGN)<AdminInput name="amountNgn" type="number" min="0.01" step="0.01" required className="mt-1 block w-full" /></label>
        <label className="text-xs font-semibold text-[var(--muted)]">Date<AdminInput name="date" type="date" defaultValue={todayInNigeria()} required className="mt-1 block w-full" /></label>
        <label className="text-xs font-semibold text-[var(--muted)] sm:col-span-2">Description<AdminInput name="description" maxLength={200} required placeholder="Cloud hosting bill" className="mt-1 block w-full" /></label>
        <label className="text-xs font-semibold text-[var(--muted)]">Vendor / source<AdminInput name="counterparty" maxLength={120} placeholder="Provider or customer" className="mt-1 block w-full" /></label>
        <label className="text-xs font-semibold text-[var(--muted)]">Reference<AdminInput name="reference" maxLength={120} placeholder="Invoice or transfer reference" className="mt-1 block w-full" /></label>
        <div className="sm:col-span-2 xl:col-span-4"><AdminButton type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record entry'}</AdminButton></div>
      </form>

      <div>
        <div className="mb-2 text-sm font-bold text-[var(--text)]">Entries in selected period</div>
        {!payload?.entries.length ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">{loading ? 'Loading records…' : 'No finance entries recorded for these dates.'}</div>
        ) : (
          <AdminTable>
            <AdminThead columns={['Type', 'Category / description', 'Vendor / reference', 'Date', 'Amount', '']} />
            <tbody className="divide-y divide-[var(--border)]">
              {payload.entries.map(entry => (
                <tr key={entry.id} className="hover:bg-[var(--clay)]">
                  <td className="px-4 py-3 text-xs font-bold uppercase text-[var(--text2)]">{entry.direction}</td>
                  <td className="px-4 py-3"><div className="font-semibold text-[var(--text)]">{entry.description}</div><div className="text-xs text-[var(--muted)]">{categoryLabel(entry.category)}</div></td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{entry.counterparty || '—'}{entry.reference ? <div>{entry.reference}</div> : null}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{formatDate(entry.occurredAt)}</td>
                  <td className={`px-4 py-3 whitespace-nowrap font-semibold ${entry.direction === 'income' ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>{formatNaira(entry.amountNgn)}</td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => void voidEntry(entry.id)} className="text-xs font-semibold text-[var(--muted)] underline decoration-[var(--border)] underline-offset-2 hover:text-[var(--red2)]">Void</button></td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </div>
    </div>
  )
}
