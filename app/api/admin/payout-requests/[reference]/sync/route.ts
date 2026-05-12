import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { syncFlutterwavePayout } from '@/lib/server/payout-sync'

export async function POST(_req: Request, ctx: RouteContext<'/api/admin/payout-requests/[reference]/sync'>) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { reference } = await ctx.params
  try {
    const result = await syncFlutterwavePayout(reference, admin.id)
    return NextResponse.json({ data: result, success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payout sync failed.'
    const status = message.includes('not found') ? 404 : message.includes('no provider reference') ? 400 : 500
    return NextResponse.json({ error: message, success: false }, { status })
  }
}
