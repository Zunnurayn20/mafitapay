import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react'
import {
  AdminPageCard,
  AdminStatusPill,
  AdminTable,
  AdminThead,
  formatDate,
  formatNaira,
} from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import {
  getAnyTransactionById,
  getLedgerEntriesForTransaction,
  getProviderEventsByReference,
  getUserById,
} from '@/lib/server/data'

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-[var(--clay)] px-3 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-[var(--text)]">{children}</div>
    </div>
  )
}

function safeMetadata(transaction: NonNullable<Awaited<ReturnType<typeof getAnyTransactionById>>>['transaction']) {
  const metadata = transaction.metadata ?? {}
  const allowed = [
    ['providerName', 'Provider'],
    ['providerReference', 'Provider reference'],
    ['network', 'Network'],
    ['assetSymbol', 'Asset'],
    ['chainName', 'Chain'],
    ['txHash', 'Blockchain reference'],
  ] as const

  return allowed.flatMap(([key, label]) => {
    const value = metadata[key]
    return typeof value === 'string' && value.trim() ? [{ key, label, value: value.trim() }] : []
  })
}

export default async function AdminTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminPageUser()
  const { id } = await params
  const record = await getAnyTransactionById(id)
  if (!record) notFound()

  const [customer, ledgerEntries] = await Promise.all([
    getUserById(record.userId),
    getLedgerEntriesForTransaction(record.userId, record.transaction.id),
  ])
  const metadata = safeMetadata(record.transaction)
  const references = [...new Set([
    record.transaction.reference,
    typeof record.transaction.metadata?.providerReference === 'string' ? record.transaction.metadata.providerReference : '',
    typeof record.transaction.metadata?.txRef === 'string' ? record.transaction.metadata.txRef : '',
  ].map(value => value.trim()).filter(Boolean))]
  const providerEvents = (await Promise.all(references.map(reference => getProviderEventsByReference(reference))))
    .flat()
    .filter((event, index, events) => events.findIndex(candidate => candidate.id === event.id) === index)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const transaction = record.transaction
  const isCredit = ['deposit', 'transfer_in', 'crypto_sell', 'referral_bonus', 'reward_bonus', 'admin_credit', 'p2p_deposit'].includes(transaction.type)

  return (
    <div className="space-y-4">
      <Link href="/admin/transactions" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--gold2)]">
        <ArrowLeft size={16} /> Transactions
      </Link>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--coal)] p-4 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.55)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-[var(--text)] sm:text-2xl">{transaction.description || transaction.type}</h2>
              <AdminStatusPill status={transaction.status} />
            </div>
            <p className="mt-1 break-all font-mono text-xs text-[var(--muted)]">{transaction.reference}</p>
          </div>
          <div className={`flex items-center gap-2 font-mono text-2xl font-bold ${isCredit ? 'text-[var(--green2)]' : 'text-[var(--text)]'}`}>
            {isCredit ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
            {isCredit ? '+' : '−'}{formatNaira(transaction.amount)}
          </div>
        </div>
        {transaction.status === 'failed' && transaction.metadata?.failureReason && typeof transaction.metadata.failureReason === 'string' ? (
          <div className="mt-4 rounded-lg border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] px-3 py-2 text-sm text-[var(--red2)]">
            {transaction.metadata.failureReason}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <AdminPageCard title="Transaction details">
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            <Detail label="Type">{transaction.type.replaceAll('_', ' ')}</Detail>
            <Detail label="Created">{formatDate(transaction.createdAt)}</Detail>
            <Detail label="Transaction ID"><span className="font-mono text-xs">{transaction.id}</span></Detail>
            <Detail label="Fee">{formatNaira(transaction.fee)}</Detail>
            <Detail label="Recipient">{transaction.recipient || '—'}</Detail>
            <Detail label="Narration">{transaction.narration || '—'}</Detail>
            {metadata.map(item => (
              <Detail key={item.key} label={item.label}>{item.value}</Detail>
            ))}
          </div>
        </AdminPageCard>

        <AdminPageCard title="Customer" actions={customer ? (
          <Link href={`/admin/users?q=${encodeURIComponent(record.userId)}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--gold2)] hover:underline">
            View user <ExternalLink size={14} />
          </Link>
        ) : undefined}>
          {customer ? (
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              <Detail label="Name">{customer.name}</Detail>
              <Detail label="Account status">{customer.accountStatus}</Detail>
              <Detail label="Email">{customer.email || '—'}</Detail>
              <Detail label="Phone">{customer.phone || '—'}</Detail>
              <Detail label="User ID"><span className="font-mono text-xs">{customer.id}</span></Detail>
              <Detail label="Joined">{formatDate(customer.createdAt)}</Detail>
            </div>
          ) : <div className="p-4 text-sm text-[var(--muted)]">Customer record is unavailable.</div>}
        </AdminPageCard>
      </div>

      <AdminPageCard title="Ledger entries" description="Balance postings recorded for this transaction.">
        {ledgerEntries.length === 0 ? (
          <div className="p-4 text-sm text-[var(--muted)]">No ledger entries are linked to this transaction.</div>
        ) : (
          <AdminTable>
            <AdminThead columns={['Asset', 'Account', 'Direction', 'Amount', 'Description', 'Date']} />
            <tbody className="divide-y divide-[var(--border)]">
              {ledgerEntries.map(entry => (
                <tr key={entry.id} className="hover:bg-[var(--clay)]">
                  <td className="px-4 py-3 text-sm font-semibold text-[var(--text)]">{entry.asset}</td>
                  <td className="px-4 py-3 text-sm capitalize text-[var(--text2)]">{entry.account}</td>
                  <td className={`px-4 py-3 text-sm font-semibold capitalize ${entry.direction === 'credit' ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>{entry.direction}</td>
                  <td className="px-4 py-3 font-mono text-sm text-[var(--text)]">{entry.asset === 'NGN' ? formatNaira(entry.amount) : entry.amount.toLocaleString('en-NG')}</td>
                  <td className="px-4 py-3 text-sm text-[var(--muted)]">{entry.description || '—'}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{formatDate(entry.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminPageCard>

      <AdminPageCard title="Provider events" description="Webhook events matched to this transaction reference.">
        {providerEvents.length === 0 ? (
          <div className="p-4 text-sm text-[var(--muted)]">No matching provider events.</div>
        ) : (
          <AdminTable>
            <AdminThead columns={['Provider', 'Reference', 'Event ID', 'Status', 'Retries', 'Failure', 'Date']} />
            <tbody className="divide-y divide-[var(--border)]">
              {providerEvents.map(event => (
                <tr key={event.id} className="hover:bg-[var(--clay)]">
                  <td className="px-4 py-3 text-sm font-semibold text-[var(--text)]">{event.provider}</td>
                  <td className="max-w-48 break-all px-4 py-3 font-mono text-xs text-[var(--text2)]">{event.reference}</td>
                  <td className="max-w-48 break-all px-4 py-3 font-mono text-xs text-[var(--muted)]">{event.externalEventId || '—'}</td>
                  <td className="px-4 py-3"><AdminStatusPill status={event.status} /></td>
                  <td className="px-4 py-3 text-sm text-[var(--text2)]">{event.retryCount ?? 0}</td>
                  <td className="max-w-64 px-4 py-3 text-xs text-[var(--red2)]">{event.failureReason || '—'}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{formatDate(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminPageCard>
    </div>
  )
}
