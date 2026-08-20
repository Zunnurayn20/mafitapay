import Link from 'next/link'
import {
  AdminButton,
  AdminEmpty,
  AdminGetForm,
  AdminInput,
  AdminPageCard,
  AdminSelect,
  AdminStatusPill,
  AdminTable,
  AdminThead,
  formatDate,
  formatNaira,
} from '@/components/admin/AdminUi'
import { loadAdminTransactionBoard, requireAdminPageUser } from '@/lib/server/admin-queries'

function summaryHref(status: string, q: string) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (q) params.set('q', q)
  const query = params.toString()
  return query ? `/admin/transactions?${query}` : '/admin/transactions'
}

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  await requireAdminPageUser()
  const params = await searchParams
  const status = (params.status || 'ALL').trim().toUpperCase()
  const q = (params.q || '').trim().toLowerCase()

  const board = await loadAdminTransactionBoard()

  const filtered = board.rows.filter(row => {
    if (status === 'ATTENTION' && !row.needsAttention) return false
    if (status === 'FAILED' && row.status !== 'failed') return false
    if (status === 'PENDING' && row.status !== 'pending' && row.status !== 'processing') return false
    if (status === 'SUCCESS' && row.status !== 'success') return false
    if (!q) return true
    return [
      row.customerName,
      row.customerContact,
      row.description,
      row.reference,
      row.type,
      row.provider,
      row.failureReason,
      row.userId,
    ].join(' ').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href={summaryHref('ATTENTION', params.q || '')} className="rounded-lg border border-[var(--border)] bg-[var(--coal)] p-4 hover:border-[var(--gold2)]">
          <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Needs attention</div>
          <div className={`mt-2 text-2xl font-bold ${board.counts.attention > 0 ? 'text-[var(--red2)]' : 'text-[var(--green2)]'}`}>
            {board.counts.attention}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">Failed, stale pending, or unmatched provider errors</div>
        </Link>
        <Link href={summaryHref('FAILED', params.q || '')} className="rounded-lg border border-[var(--border)] bg-[var(--coal)] p-4 hover:border-[var(--gold2)]">
          <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Failed</div>
          <div className={`mt-2 text-2xl font-bold ${board.counts.failed > 0 ? 'text-[var(--red2)]' : 'text-[var(--text)]'}`}>
            {board.counts.failed}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">Customer txns and unmatched provider failures</div>
        </Link>
        <Link href={summaryHref('PENDING', params.q || '')} className="rounded-lg border border-[var(--border)] bg-[var(--coal)] p-4 hover:border-[var(--gold2)]">
          <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Pending</div>
          <div className={`mt-2 text-2xl font-bold ${board.counts.pending > 0 ? 'text-[var(--gold2)]' : 'text-[var(--text)]'}`}>
            {board.counts.pending}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">Still waiting on a provider or settlement</div>
        </Link>
      </div>

      <AdminPageCard
        title="Transactions"
        description="Customer money movement with provider status. Failed and unmatched provider events show here so a user failure is visible without opening Events."
        actions={(
          <AdminGetForm action="/admin/transactions">
            <AdminInput
              name="q"
              defaultValue={params.q || ''}
              placeholder="Search customer, reference, provider"
              className="min-w-0 sm:w-72"
            />
            <AdminSelect name="status" defaultValue={status}>
              <option value="ALL">All</option>
              <option value="ATTENTION">Needs attention</option>
              <option value="PENDING">Pending</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
            </AdminSelect>
            <AdminButton type="submit">Apply</AdminButton>
          </AdminGetForm>
        )}
      >
        {filtered.length === 0 ? <AdminEmpty label="No transactions matched." /> : (
          <AdminTable>
            <AdminThead columns={['Customer', 'Transaction', 'Provider', 'Amount', 'Status', 'Date']} />
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map(row => (
                <tr key={row.id} className={row.needsAttention ? 'bg-[rgba(196,52,26,.06)]' : 'hover:bg-[var(--clay)]'}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[var(--text)]">{row.customerName}</div>
                    <div className="text-xs text-[var(--muted)]">{row.customerContact}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text)]">{row.description}</div>
                    <div className="text-xs text-[var(--muted)]">{row.type} / {row.reference}</div>
                    {row.failureReason ? <div className="mt-1 text-xs text-[var(--red2)]">{row.failureReason}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text2)]">{row.provider || '—'}</td>
                  <td className={`px-4 py-3 font-mono font-semibold ${row.amount == null ? 'text-[var(--muted)]' : row.isCredit ? 'text-emerald-700' : 'text-red-700'}`}>
                    {row.amount == null ? '—' : `${row.isCredit ? '+' : ''}${formatNaira(row.amount)}`}
                  </td>
                  <td className="px-4 py-3">
                    <AdminStatusPill status={row.status} />
                    {row.kind === 'provider_only' ? (
                      <div className="mt-1 text-[9px] font-bold uppercase tracking-[.7px] text-[var(--gold2)]">No wallet txn</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminPageCard>
    </div>
  )
}
