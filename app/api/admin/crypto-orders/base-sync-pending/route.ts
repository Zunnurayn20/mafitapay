import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { syncBaseReceiptForCryptoOrder } from '@/lib/server/base-receipt-sync'
import { listCryptoOrders } from '@/lib/server/data'

export async function POST() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const orders = (await listCryptoOrders({ status: 'pending', limit: 100 }))
    .filter(item =>
      (item.executionRail === 'base_legacy' || item.executionRail === 'base_treasury')
      && item.executionStatus === 'broadcasted'
      && (
        item.destinationTxHash
        || (item.provider === '0x' && typeof item.providerPayload?.swapTxHash === 'string')
      )
    )

  const checks = await Promise.all(orders.map(async item => {
    try {
      const result = await syncBaseReceiptForCryptoOrder(item.id, admin.id)
      return {
        orderId: item.id,
        pairId: item.pairId,
        txHash: item.destinationTxHash,
        found: result.receipt.found,
        status: result.receipt.status,
        settled: result.settled,
      }
    } catch (error) {
      return {
        orderId: item.id,
        pairId: item.pairId,
        txHash: item.destinationTxHash,
        found: false,
        status: 'error',
        settled: false,
        error: error instanceof Error ? error.message : 'Unable to sync receipt.',
      }
    }
  }))

  return NextResponse.json({
    data: {
      total: orders.length,
      pending: checks.filter(item => item.status === 'pending').length,
      success: checks.filter(item => item.status === 'success').length,
      failed: checks.filter(item => item.status === 'reverted').length,
      settled: checks.filter(item => item.settled).length,
      checks,
    },
    success: true,
  })
}
