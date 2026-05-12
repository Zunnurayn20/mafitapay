import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { insertAuditLog, requeueProviderEvent } from '@/lib/server/data'

export async function PATCH(_req: Request, ctx: RouteContext<'/api/admin/provider-events/[eventId]/requeue'>) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { eventId } = await ctx.params
  const event = await requeueProviderEvent(eventId)
  if (!event) {
    return NextResponse.json({ error: 'Provider event not found.', success: false }, { status: 404 })
  }

  await insertAuditLog({
    actorUserId: admin.id,
    action: 'provider_event.requeued',
    entityType: 'provider_event',
    entityId: event.id,
    metadata: { externalEventId: event.externalEventId, reference: event.reference },
  })

  return NextResponse.json({ data: event, success: true })
}
