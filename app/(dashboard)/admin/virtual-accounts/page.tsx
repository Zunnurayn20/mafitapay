import {
  AdminEmpty,
  AdminPageCard,
  AdminStatusPill,
  AdminTable,
  AdminThead,
} from '@/components/admin/AdminUi'
import { listAdminWalletRows, requireAdminPageUser } from '@/lib/server/admin-queries'
import type { User, VirtualAccount } from '@/types'

export default async function AdminVirtualAccountsPage() {
  await requireAdminPageUser()
  const rows = await listAdminWalletRows(100)

  const accounts: Array<{ key: string; user: User; account: VirtualAccount }> = []
  for (const row of rows) {
    for (const [index, account] of (row.wallet?.virtualAccounts ?? []).entries()) {
      accounts.push({
        key: `${row.user.id}-${account.accountNumber}-${index}`,
        user: row.user,
        account,
      })
    }
  }

  return (
    <AdminPageCard
      title="Virtual accounts"
      description="Permanent funding accounts connected to customers."
    >
      {accounts.length === 0 ? <AdminEmpty label="No virtual accounts found." /> : (
        <AdminTable>
          <AdminThead columns={['Customer', 'Account', 'Provider', 'Status', 'Reference']} />
          <tbody className="divide-y divide-slate-200">
            {accounts.map(row => (
              <tr key={row.key} className="hover:bg-slate-50/80">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{row.user.name}</div>
                  <div className="text-xs text-slate-500">{row.user.phone || row.user.email || 'No contact'}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{row.account.accountNumber}</div>
                  <div className="text-xs text-slate-500">{row.account.bank} / {row.account.accountName}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{row.account.provider}</td>
                <td className="px-4 py-3">
                  <AdminStatusPill status={row.account.isPermanent ? 'ACTIVE' : 'TEMPORARY'} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{row.account.reference || '—'}</td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}
    </AdminPageCard>
  )
}
