import { AlertCircle, DatabaseZap } from 'lucide-react'
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
import { listProviderEvents } from '@/lib/server/data'

export default async function AdminProviderEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>
}) {
  await requireAdminPageUser()
  const params = await searchParams
  const provider = (params.provider || 'all').trim().toLowerCase()

  const events = await listProviderEvents({
    provider: provider === 'all' ? undefined : provider,
    limit: 80,
  })

  return (
    <AdminPageCard
      title="Provider events"
      description="Webhook ledger for wallet funding and provider callbacks."
      actions={(
        <AdminGetForm action="/admin/provider-events">
          <AdminSelect name="provider" defaultValue={provider}>
            <option value="all">All providers</option>
            <option value="palmpay">PalmPay</option>
            <option value="flutterwave">Flutterwave</option>
          </AdminSelect>
          <AdminButton type="submit">Apply</AdminButton>
        </AdminGetForm>
      )}
    >
      {events.length === 0 ? <AdminEmpty label="No provider events found." /> : (
        <div className="divide-y divide-slate-200">
          {events.map(event => (
            <div key={event.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{event.provider}</div>
                  <div className="mt-1 text-xs text-slate-500">{event.reference || event.externalEventId || event.id}</div>
                </div>
                <AdminStatusPill status={event.status || (event.processedAt ? 'PROCESSED' : 'PENDING')} />
              </div>
              {event.failureReason ? (
                <div className="mt-3 flex gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                  <AlertCircle size={14} className="shrink-0" />
                  {event.failureReason}
                </div>
              ) : null}
              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                <DatabaseZap size={13} />
                {event.processedAt ? `Processed ${formatDate(event.processedAt)}` : 'Not processed yet'}
                {' / '}
                Created {formatDate(event.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminPageCard>
  )
}
