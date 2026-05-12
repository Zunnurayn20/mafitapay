import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getCryptoOrderById } from '@/lib/server/data'
import { syncNearReceiptForCryptoOrder } from '@/lib/server/near-receipt-sync'
import { syncBscReceiptForCryptoOrder } from '@/lib/server/bsc-receipt-sync'
import { syncBaseReceiptForCryptoOrder } from '@/lib/server/base-receipt-sync'
import { syncRoutedReceiptForCryptoOrder } from '@/lib/server/routed-receipt-sync'
import { syncSuiReceiptForCryptoOrder } from '@/lib/server/sui-receipt-sync'
import { syncTonReceiptForCryptoOrder } from '@/lib/server/ton-receipt-sync'

export async function POST(_req: Request, ctx: RouteContext<'/api/crypto/orders/[id]/sync'>) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const { id } = await ctx.params
  const order = await getCryptoOrderById(id)
  if (!order || order.userId !== user.id) {
    return NextResponse.json({ error: 'Crypto order not found.', success: false }, { status: 404 })
  }

  if ((order.executionRail === 'base_legacy' || order.executionRail === 'base_treasury') && order.status === 'pending') {
    try {
      const result = await syncBaseReceiptForCryptoOrder(order.id, user.id)
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      console.error('Base crypto order sync failed', {
        orderId: order.id,
        pairId: order.pairId,
        userId: user.id,
        error: error instanceof Error ? error.stack ?? error.message : error,
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync Base crypto order.',
        success: false,
      }, { status: 502 })
    }
  }

  if (order.executionRail === 'bsc_treasury' && order.status === 'pending') {
    try {
      const result = await syncBscReceiptForCryptoOrder(order.id, user.id)
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      console.error('BSC crypto order sync failed', {
        orderId: order.id,
        pairId: order.pairId,
        userId: user.id,
        error: error instanceof Error ? error.stack ?? error.message : error,
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync BSC crypto order.',
        success: false,
      }, { status: 502 })
    }
  }

  if (order.executionRail === 'routed_treasury' && order.status === 'pending') {
    try {
      const result = await syncRoutedReceiptForCryptoOrder(order.id, user.id)
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      console.error('Routed crypto order sync failed', {
        orderId: order.id,
        pairId: order.pairId,
        userId: user.id,
        error: error instanceof Error ? error.stack ?? error.message : error,
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync routed crypto order.',
        success: false,
      }, { status: 502 })
    }
  }

  if (order.executionRail === 'sui_treasury' && order.status === 'pending') {
    try {
      const result = await syncSuiReceiptForCryptoOrder(order.id, user.id, { forcePayoutRetry: true })
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      console.error('SUI crypto order sync failed', {
        orderId: order.id,
        pairId: order.pairId,
        userId: user.id,
        error: error instanceof Error ? error.stack ?? error.message : error,
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync SUI crypto order.',
        success: false,
      }, { status: 502 })
    }
  }

  if (order.executionRail === 'near_intents' && order.status === 'pending') {
    try {
      const result = await syncNearReceiptForCryptoOrder(order.id, user.id, { forcePayoutRetry: true })
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      console.error('NEAR crypto order sync failed', {
        orderId: order.id,
        pairId: order.pairId,
        userId: user.id,
        error: error instanceof Error ? error.stack ?? error.message : error,
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync NEAR crypto order.',
        success: false,
      }, { status: 502 })
    }
  }

  if (order.executionRail === 'ton_treasury' && order.status === 'pending') {
    try {
      const result = await syncTonReceiptForCryptoOrder(order.id, user.id)
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      console.error('TON crypto order sync failed', {
        orderId: order.id,
        pairId: order.pairId,
        userId: user.id,
        error: error instanceof Error ? error.stack ?? error.message : error,
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync TON crypto order.',
        success: false,
      }, { status: 502 })
    }
  }

  if (order.provider !== 'transak' || !order.providerReference) {
    return NextResponse.json({ error: 'This crypto order is not eligible for provider sync.', success: false }, { status: 400 })
  }

  return NextResponse.json({ error: 'Legacy Transak sync is not active in this environment.', success: false }, { status: 410 })
}
