import {
  AdminEmpty,
  AdminPageCard,
  AdminStatusPill,
  AdminTable,
  AdminThead,
  formatDate,
  formatNaira,
} from '@/components/admin/AdminUi'
import { listAdminWalletRows, requireAdminPageUser } from '@/lib/server/admin-queries'
import { listRecentTransactions } from '@/lib/server/data'
import { AdjustmentForm } from './AdjustmentForm'

export default async function AdminAdjustmentsPage() {
  await requireAdminPageUser()
  const [rows, txns] = await Promise.all([
    listAdminWalletRows(100),
    listRecentTransactions(100),
  ])

  const userById = new Map(rows.map(row => [row.user.id, row.user]))
  const adjustments = txns
    .filter(row => row.transaction.type === 'admin_credit' || row.transaction.type === 'admin_debit')
    .slice(0, 40)

  return (
    <div className="space-y-4">
      <AdminPageCard
        title="Adjustments"
        description="Manual wallet credit and debit with an audit reason."
      >
        {rows.length === 0 ? <AdminEmpty label="No wallets available." /> : <AdjustmentForm rows={rows} />}
      </AdminPageCard>

      <AdminPageCard title="Recent adjustments" description="Latest admin_credit and admin_debit transactions.">
        {adjustments.length === 0 ? <AdminEmpty label="No adjustments yet." /> : (
          <AdminTable>
            <AdminThead columns={['Customer', 'Type', 'Amount', 'Reason', 'Status', 'Date']} />
            <tbody className="divide-y divide-slate-200">
              {adjustments.map(row => {
                const user = userById.get(row.userId)
                const txn = row.transaction
                return (
                  <tr key={txn.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{user?.name || row.userId}</div>
                      <div className="text-xs text-slate-500">{user?.email || 'No email'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-700">{txn.type}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">{formatNaira(txn.amount)}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{txn.narration || txn.description}</td>
                    <td className="px-4 py-3"><AdminStatusPill status={txn.status} /></td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(txn.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </AdminTable>
        )}
      </AdminPageCard>
    </div>
  )
}
