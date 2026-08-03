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
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { listRecentTransactions, listUsers } from '@/lib/server/data'

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  await requireAdminPageUser()
  const params = await searchParams
  const status = (params.status || 'ALL').trim().toUpperCase()
  const q = (params.q || '').trim().toLowerCase()

  const [rows, users] = await Promise.all([
    listRecentTransactions(100),
    listUsers(),
  ])
  const userById = new Map(users.map(user => [user.id, user]))

  const filtered = rows.filter(row => {
    const txn = row.transaction
    if (status !== 'ALL' && txn.status.toUpperCase() !== status) return false
    if (!q) return true
    const user = userById.get(row.userId)
    return [
      txn.description,
      txn.reference,
      txn.type,
      txn.narration,
      user?.name,
      user?.phone,
      user?.email,
      row.userId,
    ].join(' ').toLowerCase().includes(q)
  }).slice(0, 80)

  return (
    <AdminPageCard
      title="Transactions"
      description="Browse customer credits, debits, purchases, and funding records."
      actions={(
        <AdminGetForm action="/admin/transactions">
          <AdminInput
            name="q"
            defaultValue={params.q || ''}
            placeholder="Search customer, reference, label"
            className="min-w-0 sm:w-72"
          />
          <AdminSelect name="status" defaultValue={status}>
            <option value="ALL">All status</option>
            <option value="PENDING">Pending</option>
            <option value="PROCESSING">Processing</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
          </AdminSelect>
          <AdminButton type="submit">Apply</AdminButton>
        </AdminGetForm>
      )}
    >
      {filtered.length === 0 ? <AdminEmpty label="No transactions matched." /> : (
        <AdminTable>
          <AdminThead columns={['Customer', 'Transaction', 'Amount', 'Status', 'Date']} />
          <tbody className="divide-y divide-slate-200">
            {filtered.map(row => {
              const user = userById.get(row.userId)
              const txn = row.transaction
              const isCredit = ['deposit', 'transfer_in', 'crypto_sell', 'referral_bonus', 'reward_bonus', 'admin_credit', 'p2p_deposit'].includes(txn.type)
              return (
                <tr key={txn.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{user?.name || row.userId}</div>
                    <div className="text-xs text-slate-500">{user?.phone || user?.email || 'No contact'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{txn.description || txn.type}</div>
                    <div className="text-xs text-slate-500">{txn.type} / {txn.reference}</div>
                  </td>
                  <td className={`px-4 py-3 font-mono font-semibold ${isCredit ? 'text-emerald-700' : 'text-red-700'}`}>
                    {isCredit ? '+' : '-'}{formatNaira(txn.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <AdminStatusPill status={txn.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(txn.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </AdminTable>
      )}
    </AdminPageCard>
  )
}
