import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getDisabledDataPlans, insertAuditLog, setDataPlanDisabled } from '@/lib/server/data'

const VENDORS = new Set(['amigo', 'asbdata', 'bardetech'])

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()
  return NextResponse.json({ success: true, data: await getDisabledDataPlans() })
}

export async function PATCH(request: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const vendor = typeof body.vendor === 'string' ? body.vendor.trim().toLowerCase() : ''
  const networkId = Number(body.networkId)
  const planId = typeof body.planId === 'string' ? body.planId.trim() : ''
  const disabled = body.disabled === true
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
  if (!VENDORS.has(vendor) || !Number.isInteger(networkId) || networkId <= 0 || !planId) {
    return NextResponse.json({ success: false, error: 'Vendor, network ID, and plan ID are required.' }, { status: 400 })
  }

  const plans = await setDataPlanDisabled({
    vendor: vendor as 'amigo' | 'asbdata' | 'bardetech',
    networkId,
    planId,
    disabled,
    reason,
    disabledBy: admin.email,
  })
  await insertAuditLog({
    actorUserId: admin.id,
    action: disabled ? 'data_plan.disabled' : 'data_plan.enabled',
    entityType: 'data_plan',
    entityId: `${vendor}:${networkId}:${planId}`,
    metadata: { vendor, networkId, planId, reason: reason || undefined },
  })
  return NextResponse.json({ success: true, data: plans })
}
