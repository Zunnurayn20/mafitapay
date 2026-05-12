import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getCryptoOrderById } from '@/lib/server/data'
import { syncNearReceiptForCryptoOrder } from '@/lib/server/near-receipt-sync'
import { syncSuiReceiptForCryptoOrder } from '@/lib/server/sui-receipt-sync'
import { syncTonReceiptForCryptoOrder } from '@/lib/server/ton-receipt-sync'

export async function POST(_req: Request, ctx: RouteContext<'/api/admin/crypto-orders/[id]/sync'>) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { id } = await ctx.params
  const order = await getCryptoOrderById(id)
  if (!order) {
    return NextResponse.json({ error: 'Crypto order not found.', success: false }, { status: 404 })
  }
  if (order.executionRail === 'ton_treasury' && order.status === 'pending') {
    try {
      const result = await syncTonReceiptForCryptoOrder(order.id, admin.id)
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync TON crypto order.',
        success: false,
      }, { status: 502 })
    }
  }
  if (order.executionRail === 'near_intents' && order.status === 'pending') {
    try {
      const result = await syncNearReceiptForCryptoOrder(order.id, admin.id, { forcePayoutRetry: true })
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync NEAR crypto order.',
        success: false,
      }, { status: 502 })
    }
  }
  if (order.executionRail === 'sui_treasury' && order.status === 'pending') {
    try {
      const result = await syncSuiReceiptForCryptoOrder(order.id, admin.id, { forcePayoutRetry: true })
      return NextResponse.json({ data: result, success: true })
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Unable to sync SUI crypto order.',
        success: false,
      }, { status: 502 })
    }
  }
  if (order.provider !== 'transak' || !order.providerReference) {
    return NextResponse.json({ error: 'This crypto order is not eligible for provider sync.', success: false }, { status: 400 })
  }

  return NextResponse.json({ error: 'Legacy Transak sync is not active in this environment.', success: false }, { status: 410 })
}
