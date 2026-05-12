import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { broadcastBaseTransaction } from '@/lib/server/base-executor'
import { getCryptoOrderById, insertAuditLog, updateCryptoOrderExecution } from '@/lib/server/data'
import { triggerCryptoOrderExecution } from '@/lib/server/crypto-order-execution'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const mode = body.mode === 'raw_call' || body.mode === 'zerox_swap' ? body.mode : 'delivery'

  const order = await getCryptoOrderById(id)
  if (!order) {
    return NextResponse.json({ error: 'Crypto order not found.', success: false }, { status: 404 })
  }
  if (order.executionRail !== 'base_legacy' && order.executionRail !== 'base_treasury' && order.executionRail !== 'bsc_treasury' && order.executionRail !== 'routed_treasury' && order.executionRail !== 'sui_treasury' && order.executionRail !== 'near_intents') {
    return NextResponse.json({ error: 'Only supported treasury orders can be broadcast from this route.', success: false }, { status: 400 })
  }
  if (order.executionStatus === 'broadcasted' || order.executionStatus === 'settled') {
    return NextResponse.json({ error: `Order execution is already ${order.executionStatus}.`, success: false }, { status: 409 })
  }
  if (order.status !== 'pending') {
    return NextResponse.json({ error: `Crypto order is already ${order.status}.`, success: false }, { status: 409 })
  }

  try {
    if (mode === 'raw_call') {
      const execution = await broadcastBaseTransaction({
        to: typeof body.to === 'string' ? body.to.trim() : '',
        data: typeof body.data === 'string' && body.data.trim() ? body.data.trim() : undefined,
        value: typeof body.value === 'string' || typeof body.value === 'number' ? body.value : undefined,
      })
      const updated = await updateCryptoOrderExecution({
        id: order.id,
        executionRail: order.executionRail ?? 'base_treasury',
        executionStatus: 'broadcasted',
        executionReference: typeof body.executionReference === 'string' && body.executionReference.trim()
          ? body.executionReference.trim()
          : `base_exec_${order.id}`,
        destinationTxHash: execution.hash,
      })

      await insertAuditLog({
        userId: order.userId,
        actorUserId: admin.id,
        action: 'crypto_order.execution.broadcasted.raw_call',
        entityType: 'crypto_order',
        entityId: order.id,
        metadata: {
          pairId: order.pairId,
          side: order.side,
          txHash: execution.hash,
          walletAddress: order.walletAddress,
        },
      })

      return NextResponse.json({
        data: {
          order: updated,
          execution,
        },
        success: true,
      })
    }

    const result = await triggerCryptoOrderExecution({
      order,
      actorUserId: admin.id,
      source: 'admin',
    })

    return NextResponse.json({
      data: {
        order: result.order,
        execution: result.execution,
      },
      success: true,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Treasury execution failed.',
      success: false,
    }, { status: 400 })
  }
}
