import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { archiveBeneficiary, deleteBeneficiary, getBeneficiaryById, restoreBeneficiary, setDefaultBeneficiary } from '@/lib/server/data'

export async function PATCH(req: Request, ctx: RouteContext<'/api/beneficiaries/[id]'>) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const { id } = await ctx.params
  const beneficiary = await getBeneficiaryById(user.id, id)
  if (!beneficiary) {
    return NextResponse.json({ error: 'Beneficiary not found.', success: false }, { status: 404 })
  }

  const body = await req.json()
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'set_default') {
    const updated = await setDefaultBeneficiary(user.id, id)
    return NextResponse.json({ data: updated, success: true })
  }

  if (action === 'archive') {
    const updated = await archiveBeneficiary(user.id, id)
    return NextResponse.json({ data: updated, success: true })
  }

  if (action === 'restore') {
    const updated = await restoreBeneficiary(user.id, id)
    return NextResponse.json({ data: updated, success: true })
  }

  if (action === 'delete') {
    const deleted = await deleteBeneficiary(user.id, id)
    return NextResponse.json({ data: { deleted }, success: true })
  }

  return NextResponse.json({ error: 'Unsupported beneficiary action.', success: false }, { status: 400 })
}
