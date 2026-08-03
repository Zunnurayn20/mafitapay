import {
  AdminButton,
  AdminEmpty,
  AdminGetForm,
  AdminInput,
  AdminPageCard,
  formatDate,
} from '@/components/admin/AdminUi'
import { loadAdminAuditLogs, requireAdminPageUser } from '@/lib/server/admin-queries'

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; target?: string }>
}) {
  await requireAdminPageUser()
  const params = await searchParams
  const action = (params.action || '').trim().toLowerCase()
  const target = (params.target || '').trim().toLowerCase()

  const logs = await loadAdminAuditLogs(100)
  const filtered = logs.filter(log => {
    if (action && !`${log.action}`.toLowerCase().includes(action)) return false
    if (target && !`${log.entityType} ${log.entityId}`.toLowerCase().includes(target)) return false
    return true
  }).slice(0, 100)

  return (
    <AdminPageCard
      title="Audit log"
      description="Immutable admin action history with request metadata."
      actions={(
        <AdminGetForm action="/admin/audit-log">
          <AdminInput name="action" defaultValue={params.action || ''} placeholder="Action" />
          <AdminInput name="target" defaultValue={params.target || ''} placeholder="Target type or ID" />
          <AdminButton type="submit">Filter</AdminButton>
        </AdminGetForm>
      )}
    >
      {filtered.length === 0 ? <AdminEmpty label="No audit entries matched." /> : (
        <div className="divide-y divide-slate-200">
          {filtered.map(log => (
            <details key={log.id} className="group p-4">
              <summary className="flex cursor-pointer flex-col gap-2 marker:hidden sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{log.action}</div>
                  <div className="text-xs text-slate-500">
                    {log.entityType}{log.entityId ? ` / ${log.entityId}` : ''}
                  </div>
                </div>
                <div className="text-xs text-slate-500">{formatDate(log.createdAt)}</div>
              </summary>
              <div className="mt-4 grid gap-3 text-xs lg:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="font-bold text-slate-900">Actor</div>
                  <div className="mt-1 text-slate-500">{log.actorUserId || 'system'}</div>
                  <div className="mt-2 text-slate-500">User: {log.userId || '—'}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="font-bold text-slate-900">Metadata</div>
                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-[11px] text-slate-500">
                    {JSON.stringify(log.metadata ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </AdminPageCard>
  )
}
