import {
  AdminButton,
  AdminEmpty,
  AdminGetForm,
  AdminPageCard,
  AdminSelect,
  AdminStatusPill,
  formatDate,
} from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { listRecentNotifications } from '@/lib/server/data'

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ read?: string }>
}) {
  await requireAdminPageUser()
  const params = await searchParams
  const read = (params.read || 'ALL').trim().toUpperCase()

  let items = await listRecentNotifications(80)
  if (read === 'READ') items = items.filter(item => item.read)
  if (read === 'UNREAD') items = items.filter(item => !item.read)

  return (
    <AdminPageCard
      title="Notifications"
      description="Customer notification feed and read state."
      actions={(
        <AdminGetForm action="/admin/notifications">
          <AdminSelect name="read" defaultValue={read}>
            <option value="ALL">All</option>
            <option value="UNREAD">Unread</option>
            <option value="READ">Read</option>
          </AdminSelect>
          <AdminButton type="submit">Apply</AdminButton>
        </AdminGetForm>
      )}
    >
      {items.length === 0 ? <AdminEmpty label="No notifications found." /> : (
        <div className="divide-y divide-slate-200">
          {items.map(item => (
            <div key={item.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.userName || item.userId}
                    {' / '}
                    {item.userPhone || item.userEmail || 'No contact'}
                  </div>
                </div>
                <AdminStatusPill status={item.read ? 'READ' : 'UNREAD'} />
              </div>
              <p className="mt-3 text-sm text-slate-500">{item.message}</p>
              <div className="mt-2 text-[11px] text-slate-500">{formatDate(item.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </AdminPageCard>
  )
}
