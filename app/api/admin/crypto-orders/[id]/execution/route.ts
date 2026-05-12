import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getCryptoOrderById, insertAuditLog, updateCryptoOrderExecution } from '@/lib/server/data'

export async function PATCH(req: Request, ctx: RouteContext<'/api/admin/crypto-orders/[id]/execution'>) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { id } = await ctx.params
  const body = await req.json()
  const executionStatus = body.executionStatus === 'awaiting_swap'
    || body.executionStatus === 'broadcasted'
    || body.executionStatus === 'settled'
    || body.executionStatus === 'failed'
    ? body.executionStatus
    : null

  if (!executionStatus) {
    return NextResponse.json({ error: 'executionStatus must be awaiting_swap, broadcasted, settled, or failed.', success: false }, { status: 400 })
  }

  const order = await getCryptoOrderById(id)
  if (!order) {
    return NextResponse.json({ error: 'Crypto order not found.', success: false }, { status: 404 })
  }

  const updated = await updateCryptoOrderExecution({
    id: order.id,
    executionRail: order.executionRail ?? 'base_treasury',
    executionStatus,
    executionReference: typeof body.executionReference === 'string' && body.executionReference.trim() ? body.executionReference.trim() : undefined,
    destinationTxHash: typeof body.destinationTxHash === 'string' && body.destinationTxHash.trim() ? body.destinationTxHash.trim() : undefined,
  })

  await insertAuditLog({
    userId: order.userId,
    actorUserId: admin.id,
    action: `crypto_order.execution.${executionStatus}`,
    entityType: 'crypto_order',
    entityId: order.id,
    metadata: {
      executionReference: typeof body.executionReference === 'string' ? body.executionReference.trim() : undefined,
      destinationTxHash: typeof body.destinationTxHash === 'string' ? body.destinationTxHash.trim() : undefined,
      pairId: order.pairId,
      side: order.side,
    },
  })

  return NextResponse.json({ data: updated, success: true })
}
