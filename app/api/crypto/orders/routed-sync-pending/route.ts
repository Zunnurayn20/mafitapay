import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { listCryptoOrdersByUser } from '@/lib/server/data'
import { syncRoutedReceiptForCryptoOrder } from '@/lib/server/routed-receipt-sync'

export async function POST() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const orders = (await listCryptoOrdersByUser(user.id, { status: 'pending', limit: 100 }))
    .filter(order =>
      order.side === 'buy'
      && order.executionRail === 'routed_treasury'
      && order.executionStatus === 'broadcasted'
      && typeof order.providerPayload?.sendingTxHash === 'string'
    )
    .slice(0, 10)

  const results = await Promise.allSettled(orders.map(order =>
    syncRoutedReceiptForCryptoOrder(order.id, user.id)
  ))

  return NextResponse.json({
    data: {
      checked: orders.length,
      settled: results.filter(result => result.status === 'fulfilled' && result.value.settled).length,
      pending: results.filter(result => result.status === 'fulfilled' && !result.value.settled).length,
      errors: results.filter(result => result.status === 'rejected').length,
    },
    success: true,
  })
}
