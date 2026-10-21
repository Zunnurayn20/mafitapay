import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getDisabledDataPlans, insertAuditLog, setDataPlanDisabled, setDataPlansDisabled } from '@/lib/server/data'

const VENDORS = new Set(['amigo', 'asbdata', 'bardetech', 'flutterwave'])

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

  if (Array.isArray(body.plans)) {
    if (typeof body.disabled !== 'boolean' || body.plans.length < 1 || body.plans.length > 2000) {
      return NextResponse.json({ success: false, error: 'Choose between 1 and 2,000 plans and provide an enabled status.' }, { status: 400 })
    }
    const plans = body.plans.map((value): { vendor: 'amigo' | 'asbdata' | 'bardetech' | 'flutterwave'; networkId: number; planId: string } | null => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const item = value as Record<string, unknown>
      const itemVendor = typeof item.vendor === 'string' ? item.vendor.trim().toLowerCase() : ''
      const itemNetworkId = Number(item.networkId)
      const itemPlanId = typeof item.planId === 'string' ? item.planId.trim() : ''
      if (!VENDORS.has(itemVendor) || !Number.isInteger(itemNetworkId) || itemNetworkId <= 0 || !itemPlanId || itemPlanId.length > 100) return null
      return { vendor: itemVendor as 'amigo' | 'asbdata' | 'bardetech' | 'flutterwave', networkId: itemNetworkId, planId: itemPlanId }
    })
    if (plans.some(plan => !plan)) {
      return NextResponse.json({ success: false, error: 'One or more plan selections are invalid.' }, { status: 400 })
    }
    const validPlans = plans as Array<{ vendor: 'amigo' | 'asbdata' | 'bardetech' | 'flutterwave'; networkId: number; planId: string }>
    const data = await setDataPlansDisabled({ plans: validPlans, disabled: body.disabled, reason, disabledBy: admin.email })
    await insertAuditLog({
      actorUserId: admin.id,
      action: body.disabled ? 'data_plan.bulk_disabled' : 'data_plan.bulk_enabled',
      entityType: 'data_plan_bulk',
      entityId: `${Date.now()}:${validPlans.length}`,
      metadata: { count: validPlans.length, plans: validPlans, reason: reason || undefined },
    })
    return NextResponse.json({ success: true, data })
  }

  if (!VENDORS.has(vendor) || !Number.isInteger(networkId) || networkId <= 0 || !planId) {
    return NextResponse.json({ success: false, error: 'Vendor, network ID, and plan ID are required.' }, { status: 400 })
  }

  const plans = await setDataPlanDisabled({
    vendor: vendor as 'amigo' | 'asbdata' | 'bardetech' | 'flutterwave',
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
