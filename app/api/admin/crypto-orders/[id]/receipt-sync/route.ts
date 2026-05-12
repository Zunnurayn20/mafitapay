import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { syncBscReceiptForCryptoOrder } from '@/lib/server/bsc-receipt-sync'
import { syncBaseReceiptForCryptoOrder } from '@/lib/server/base-receipt-sync'
import { getCryptoOrderById } from '@/lib/server/data'
import { syncNearReceiptForCryptoOrder } from '@/lib/server/near-receipt-sync'
import { syncRoutedReceiptForCryptoOrder } from '@/lib/server/routed-receipt-sync'
import { syncSuiReceiptForCryptoOrder } from '@/lib/server/sui-receipt-sync'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const { id } = await ctx.params
  const order = await getCryptoOrderById(id)
  if (!order) {
    return NextResponse.json({ error: 'Crypto order not found.', success: false }, { status: 404 })
  }

  try {
    const result =
      order.executionRail === 'bsc_treasury'
        ? await syncBscReceiptForCryptoOrder(id, admin.id)
        : order.executionRail === 'routed_treasury'
          ? await syncRoutedReceiptForCryptoOrder(id, admin.id)
          : order.executionRail === 'sui_treasury'
            ? await syncSuiReceiptForCryptoOrder(id, admin.id, { forcePayoutRetry: true })
          : order.executionRail === 'near_intents'
            ? await syncNearReceiptForCryptoOrder(id, admin.id, { forcePayoutRetry: true })
        : await syncBaseReceiptForCryptoOrder(id, admin.id)
    return NextResponse.json({ data: result, success: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to sync execution receipt.',
      success: false,
    }, { status: 400 })
  }
}
