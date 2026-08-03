import {
  AdminButton,
  AdminEmpty,
  AdminGetForm,
  AdminInput,
  AdminPageCard,
  AdminStatusPill,
  AdminTable,
  AdminThead,
  formatDate,
  formatNaira,
} from '@/components/admin/AdminUi'
import { listAdminWalletRows, requireAdminPageUser } from '@/lib/server/admin-queries'
import { listUsers } from '@/lib/server/data'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireAdminPageUser()
  const params = await searchParams
  const q = (params.q || '').trim().toLowerCase()

  const [users, wallets] = await Promise.all([
    listUsers(),
    listAdminWalletRows(100),
  ])
  const walletByUserId = new Map(wallets.map(row => [row.user.id, row.wallet]))

  const filtered = (q
    ? users.filter(user =>
        [user.name, user.email, user.phone, user.referralCode, user.id]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    : users
  ).slice(0, 50)

  return (
    <AdminPageCard
      title="Users"
      description="Search and inspect customer records."
      actions={(
        <AdminGetForm action="/admin/users">
          <AdminInput
            name="q"
            defaultValue={params.q || ''}
            placeholder="Search name, phone, email, referral"
            className="min-w-0 flex-1 sm:w-72"
          />
          <AdminButton type="submit">Search</AdminButton>
        </AdminGetForm>
      )}
    >
      {filtered.length === 0 ? <AdminEmpty label="No users matched." /> : (
        <AdminTable>
          <AdminThead columns={['User', 'Contact', 'Wallet', 'Status', 'Joined']} />
          <tbody className="divide-y divide-slate-200">
            {filtered.map(user => {
              const wallet = walletByUserId.get(user.id)
              return (
                <tr key={user.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{user.name}</div>
                    <div className="text-xs text-slate-500">{user.referralCode}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    <div>{user.phone || 'No phone'}</div>
                    <div>{user.email || 'No email'}</div>
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                    {formatNaira(wallet?.balance ?? 0)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <AdminStatusPill status={user.accountStatus} />
                      <AdminStatusPill status={user.kycStatus} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(user.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </AdminTable>
      )}
    </AdminPageCard>
  )
}
