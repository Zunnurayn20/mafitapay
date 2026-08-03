import {
  AdminEmpty,
  AdminPageCard,
  AdminTable,
  AdminThead,
  formatDate,
  formatNaira,
} from '@/components/admin/AdminUi'
import { listAdminWalletRows, requireAdminPageUser } from '@/lib/server/admin-queries'

export default async function AdminWalletsPage() {
  await requireAdminPageUser()
  const rows = await listAdminWalletRows(100)
  const total = rows.reduce((sum, row) => sum + (row.wallet?.balance ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
          <div className="absolute inset-x-0 top-0 h-1 bg-emerald-600" />
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Listed wallet liability</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{formatNaira(total)}</div>
          <p className="mt-1 text-xs text-slate-500">Top {rows.length} wallets by most recent users.</p>
        </div>
      </div>

      <AdminPageCard title="Wallets" description="Customer balances before adjustment controls.">
        {rows.length === 0 ? <AdminEmpty label="No wallets found." /> : (
          <AdminTable>
            <AdminThead columns={['Customer', 'Balance', 'Locked', 'Accounts', 'Joined']} />
            <tbody className="divide-y divide-slate-200">
              {rows.map(row => (
                <tr key={row.user.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{row.user.name}</div>
                    <div className="text-xs text-slate-500">{row.user.phone || row.user.email || 'No contact'}</div>
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                    {formatNaira(row.wallet?.balance ?? 0)}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-500">
                    {formatNaira(row.wallet?.lockedBalance ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {row.wallet?.virtualAccounts?.length ?? 0} VA
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(row.user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminPageCard>
    </div>
  )
}
