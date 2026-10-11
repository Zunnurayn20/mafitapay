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
  pairId: string
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
  sweepStatus: string | null
  sweepCostCaptureIncomplete: boolean
  sweepCosts: Array<{
    kind: string
    operation: string | null
    symbol: string | null
    amountCrypto: number | null
    amountNgnEstimate: number | null
    payer: string | null
    includedInTopup: boolean
  }>
  actualSweepCostNgnEstimate: number | null
  conversionFeeCosts: Array<Record<string, unknown>>
  conversionGasCosts: Array<Record<string, unknown>>
  conversionUsdcEstimate: string | null
  treasuryBatchConversions: Array<Record<string, unknown>>
}

type AutomaticDeposits = {
  successfulCount: number
  customerCreditNgn: number
  marketValueNgn: number
  estimatedSpreadNgn: number
  missingMarketSnapshotCount: number
  actualSweepCostNgnEstimate: number
  sweepCostMissingCount: number
  spreadAfterCapturedSweepCostNgn: number
  contributionCount: number
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
  const [activeTab, setActiveTab] = useState<'purchases' | 'deposits' | 'records'>('purchases')
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
        Crypto-buy network-fee recovery: <strong className="text-[var(--text)]">{formatNaira(summary?.cryptoFeeRecovery ?? 0)}</strong>. It is shown separately because it may be passed through to delivery.
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)]" role="tablist" aria-label="Finance records">
        {([
          ['purchases', 'Purchases', payload?.purchases.length ?? 0],
          ['deposits', 'Crypto deposits', payload?.deposits.length ?? 0],
          ['records', 'Manual records', payload?.entries.length ?? 0],
        ] as const).map(([tab, label, count]) => (
          <button
            key={tab}
            id={`finance-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`finance-panel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${activeTab === tab ? 'border-[var(--gold)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text2)]'}`}
          >
            {label}<span className={`rounded-full px-2 py-0.5 text-[10px] ${activeTab === tab ? 'bg-[var(--clay)] text-[var(--text)]' : 'bg-[var(--coal)] text-[var(--muted)]'}`}>{count}</span>
          </button>
        ))}
      </div>

      <section id="finance-panel-purchases" role="tabpanel" aria-labelledby="finance-tab-purchases" tabIndex={0} hidden={activeTab !== 'purchases'} className="space-y-3">
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

      <section id="finance-panel-deposits" role="tabpanel" aria-labelledby="finance-tab-deposits" tabIndex={0} hidden={activeTab !== 'deposits'} className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-[var(--text)]">Crypto deposits and sell orders</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Spread is the market value of crypto received minus the NGN credited. EVM sweep costs use transaction receipts and saved native-asset rates. Shared treasury conversion costs are allocated by deposit amount; LI.FI route fees remain quote estimates.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Successful deposits" value={String(payload?.automaticDeposits.successfulCount ?? 0)} detail="Direct credits and completed sell orders" />
          <Metric label="Customer NGN credited" value={formatNaira(payload?.automaticDeposits.customerCreditNgn ?? 0)} detail="Successful deposits in this period" />
          <Metric label="Received crypto value" value={formatNaira(payload?.automaticDeposits.marketValueNgn ?? 0)} detail="Saved market snapshot estimate" tone="text-[var(--gold2)]" />
          <Metric label="Estimated deposit spread" value={formatNaira(payload?.automaticDeposits.estimatedSpreadNgn ?? 0)} detail={`${payload?.automaticDeposits.missingMarketSnapshotCount ?? 0} records lack a saved rate`} tone="text-[var(--green2)]" />
          <Metric label="Tracked sweep cost" value={formatNaira(payload?.automaticDeposits.actualSweepCostNgnEstimate ?? 0)} detail={`${payload?.automaticDeposits.sweepCostMissingCount ?? 0} swept records lack a complete NGN cost`} tone="text-[var(--gold2)]" />
          <Metric label="Spread less tracked sweep cost" value={formatNaira(payload?.automaticDeposits.spreadAfterCapturedSweepCostNgn ?? 0)} detail={`Across ${payload?.automaticDeposits.contributionCount ?? 0} records; shared batch fees are allocated`} tone="text-[var(--green2)]" />
        </div>
        {!payload?.deposits.length ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-5 text-center text-sm text-[var(--muted)]">No crypto deposits or sell orders found in this date range.</div>
        ) : (
          <AdminTable>
            <AdminThead columns={['Deposit / sell', 'Status', 'Crypto received', 'Customer credited', 'Market value (est.)', 'Spread (est.)', 'Sweep / route costs', '']} />
            <tbody className="divide-y divide-[var(--border)]">
              {payload.deposits.map(deposit => (
                <tr key={deposit.id} className="hover:bg-[var(--clay)]">
                  <td className="px-4 py-3"><div className="font-semibold text-[var(--text)]">{deposit.description}</div><div className="text-xs capitalize text-[var(--muted)]">{deposit.type.replaceAll('_', ' ')} · {deposit.reference} · {formatDate(deposit.createdAt)}</div></td>
                  <td className="px-4 py-3 text-xs font-semibold capitalize text-[var(--text2)]">{deposit.status}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-[var(--text)]">{deposit.cryptoAmount === null ? '—' : `${deposit.cryptoAmount.toLocaleString(undefined, { maximumFractionDigits: 10 })} ${deposit.symbol}`}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-[var(--text2)]">{formatNaira(deposit.customerCreditNgn)}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-[var(--text2)]">{deposit.marketValueNgn === null ? 'Not captured' : formatNaira(deposit.marketValueNgn)}</td>
                  <td className={`px-4 py-3 whitespace-nowrap font-mono text-sm ${deposit.spreadNgn === null ? 'text-[var(--muted)]' : 'text-[var(--green2)]'}`}>{deposit.spreadNgn === null ? '—' : `${formatNaira(deposit.spreadNgn)} est.`}{deposit.marketSnapshotSource ? <div className="text-[10px] capitalize text-[var(--muted)]">{deposit.marketSnapshotSource} market</div> : null}</td>
                  <td className="min-w-56 px-4 py-3 text-xs text-[var(--text2)]">
                    {deposit.sweepCosts.length ? deposit.sweepCosts.map((cost, index) => (
                      <div key={`${cost.kind}-${cost.operation}-${index}`} className="mb-1 last:mb-0">
                        <span className="capitalize">{cost.kind.replaceAll('_', ' ')}</span>: {cost.amountCrypto === null ? '—' : `${cost.amountCrypto.toLocaleString(undefined, { maximumFractionDigits: 10 })} ${cost.symbol ?? ''}`}
                        {cost.amountNgnEstimate !== null ? <span className="text-[var(--muted)]"> · ≈{formatNaira(cost.amountNgnEstimate)}</span> : null}
                        {cost.includedInTopup ? <span className="text-[var(--muted)]"> · covered by top-up</span> : null}
                      </div>
                    )) : <span className="text-[var(--muted)]">{deposit.sweepStatus === 'swept' ? 'Receipt cost unavailable' : `Sweep ${deposit.sweepStatus ?? 'not recorded'}`}</span>}
                    {deposit.sweepCostCaptureIncomplete ? <div className="text-[var(--muted)]">Some receipt costs are still unavailable.</div> : null}
                    {deposit.conversionFeeCosts.length || deposit.conversionGasCosts.length ? <div className="mt-1 border-t border-[var(--border)] pt-1 text-[var(--gold2)]">LI.FI quote estimates{deposit.conversionUsdcEstimate ? <span> · {deposit.conversionUsdcEstimate} USDC target</span> : null}</div> : null}
                    {[...deposit.conversionFeeCosts, ...deposit.conversionGasCosts].slice(0, 4).map((fee, index) => {
                      const usd = typeof fee.amountUSD === 'string' ? fee.amountUSD : null
                      const token = fee.token && typeof fee.token === 'object' && 'symbol' in fee.token ? String(fee.token.symbol) : ''
                      const label = typeof fee.name === 'string' ? fee.name : typeof fee.type === 'string' ? fee.type : 'Route fee'
                      return <div key={`route-fee-${index}`} className="text-[var(--muted)]">{label}: {usd ? `$${usd}` : 'amount not reported'}{token ? ` (${token})` : ''}</div>
                    })}
                    {deposit.treasuryBatchConversions.map((batch, index) => {
                      const quote = batch.quote && typeof batch.quote === 'object' ? batch.quote as Record<string, unknown> : null
                      const feeCosts = Array.isArray(quote?.feeCosts) ? quote.feeCosts as Array<Record<string, unknown>> : []
                      const gasCosts = Array.isArray(quote?.gasCosts) ? quote.gasCosts as Array<Record<string, unknown>> : []
                      return <div key={`batch-${String(batch.txHash)}-${index}`} className="mt-1 border-t border-[var(--border)] pt-1 text-[var(--gold2)]">Shared treasury conversion: {typeof batch.allocatedTargetUsdcAmount === 'string' ? `≈${batch.allocatedTargetUsdcAmount} USDC allocated` : 'allocation recorded'}{batch.allocationBasis === 'pro_rata_customer_deposit_amount' ? <div className="text-[10px] text-[var(--muted)]">Allocated by customer deposit amount</div> : null}{[...feeCosts, ...gasCosts].slice(0, 3).map((fee, feeIndex) => <div key={`batch-fee-${feeIndex}`} className="text-[var(--muted)]">Quote fee: {typeof fee.amountUSD === 'string' ? `$${fee.amountUSD}` : 'amount not reported'}{fee.token && typeof fee.token === 'object' && 'symbol' in fee.token ? ` (${String(fee.token.symbol)})` : ''}</div>)}</div>
                    })}
                    {(deposit.pairId.endsWith('_BSC') || deposit.pairId.endsWith('_POLYGON')) && deposit.sweepStatus === 'swept' && !deposit.treasuryBatchConversions.length ? <div className="mt-1 text-[var(--muted)]">No treasury batch conversion has been allocated yet.</div> : null}
                  </td>
                  <td className="px-4 py-3 text-right"><Link href={`/admin/transactions/${encodeURIComponent(deposit.id)}`} className="text-xs font-semibold text-[var(--gold2)] hover:underline">Details</Link></td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </section>

      <section id="finance-panel-records" role="tabpanel" aria-labelledby="finance-tab-records" tabIndex={0} hidden={activeTab !== 'records'} className="space-y-5">
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
      </section>
    </div>
  )
}
