import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { BILL_SERVICE_TYPES } from '@/lib/bill-config'
import { getBillTypeSettings, insertAuditLog, updateBillTypeSetting } from '@/lib/server/data'
import type { BillProvider } from '@/types'

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  return NextResponse.json({ data: await getBillTypeSettings(), success: true })
}

export async function PATCH(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', success: false }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A service type and enabled status are required.', success: false }, { status: 400 })
  }

  const input = body as Record<string, unknown>
  const type = typeof input.type === 'string' ? input.type : ''
  if (!BILL_SERVICE_TYPES.includes(type as BillProvider['type']) || typeof input.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Provide a supported service type and boolean enabled status.', success: false }, { status: 400 })
  }

  const setting = await updateBillTypeSetting({
    type: type as BillProvider['type'],
    enabled: input.enabled,
    updatedBy: admin.id,
  })
  await insertAuditLog({
    actorUserId: admin.id,
    action: setting.enabled ? 'bill_service_type.enabled' : 'bill_service_type.disabled',
    entityType: 'bill_service_type',
    entityId: setting.type,
    metadata: { type: setting.type, enabled: setting.enabled },
  })

  return NextResponse.json({ data: setting, success: true })
}
