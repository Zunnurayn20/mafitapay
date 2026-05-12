import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { getCryptoOrderById } from '@/lib/server/data'

export async function PATCH(req: Request, ctx: RouteContext<'/api/admin/crypto-orders/[id]/status'>) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { id } = await ctx.params
  const body = await req.json()
  const status = body.status === 'fulfilled' || body.status === 'failed' || body.status === 'expired'
    ? body.status
    : null

  if (!status) {
    return NextResponse.json({ error: 'Status must be fulfilled, failed, or expired.', success: false }, { status: 400 })
  }

  const order = await getCryptoOrderById(id)
  if (!order) {
    return NextResponse.json({ error: 'Crypto order not found.', success: false }, { status: 404 })
  }
  if (order.status !== 'pending') {
    return NextResponse.json({ error: `Crypto order is already ${order.status}.`, success: false }, { status: 409 })
  }

  const settled = await settleCryptoOrderTerminalState({
    order,
    outcome: status === 'fulfilled' ? 'fulfilled' : 'failed',
    actorUserId: admin.id,
    source: 'admin',
    metadata: status === 'expired' ? { requestedStatus: 'expired' } : undefined,
  })

  return NextResponse.json({
    data: {
      order: settled.order,
      transaction: settled.transaction,
      wallet: settled.wallet,
    },
    success: true,
  })
}
