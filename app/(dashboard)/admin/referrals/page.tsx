import {
  AdminEmpty,
  AdminPageCard,
  AdminTable,
  AdminThead,
  formatDate,
} from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { listUsers } from '@/lib/server/data'

export default async function AdminReferralsPage() {
  await requireAdminPageUser()
  const users = await listUsers()
  const userById = new Map(users.map(user => [user.id, user]))
  const referrals = users
    .filter(user => Boolean(user.referredByUserId || user.referredByReferralCode))
    .slice(0, 80)

  return (
    <AdminPageCard
      title="Referrals"
      description="Referral relationships recorded on customer accounts."
    >
      {referrals.length === 0 ? <AdminEmpty label="No referrals found." /> : (
        <AdminTable>
          <AdminThead columns={['Referrer', 'Referred user', 'Code', 'Joined']} />
          <tbody className="divide-y divide-slate-200">
            {referrals.map(user => {
              const referrer = user.referredByUserId ? userById.get(user.referredByUserId) : undefined
              return (
                <tr key={user.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">
                      {referrer?.name || user.referredByUserId || 'Unknown'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {referrer?.referralCode || user.referredByReferralCode || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{user.name}</div>
                    <div className="text-xs text-slate-500">{user.phone || user.email || 'No contact'}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-700">{user.referralCode}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(user.referredAt || user.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </AdminTable>
      )}
    </AdminPageCard>
  )
}
