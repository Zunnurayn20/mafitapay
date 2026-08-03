import {
  AdminEmpty,
  AdminPageCard,
  AdminStatusPill,
  AdminTable,
  AdminThead,
  formatDate,
} from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { listUsers } from '@/lib/server/data'

export default async function AdminAdminsPage() {
  await requireAdminPageUser()
  const admins = (await listUsers()).filter(user => user.isAdmin)

  return (
    <AdminPageCard
      title="Admins"
      description="Accounts currently allowed into the admin control center."
    >
      {admins.length === 0 ? <AdminEmpty label="No admin accounts found." /> : (
        <AdminTable>
          <AdminThead columns={['Admin', 'Contact', 'Role', 'Joined']} />
          <tbody className="divide-y divide-slate-200">
            {admins.map(user => (
              <tr key={user.id} className="hover:bg-slate-50/80">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{user.name}</div>
                  <div className="text-xs text-slate-500">{user.id}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">
                  <div>{user.email || 'No email'}</div>
                  <div>{user.phone || 'No phone'}</div>
                </td>
                <td className="px-4 py-3">
                  <AdminStatusPill status="OWNER" />
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(user.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}
    </AdminPageCard>
  )
}
