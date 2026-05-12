import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getCryptoOrderByProviderReference } from '@/lib/server/data'
import { syncTransakOrderByPartnerReference } from '@/lib/server/transak-orders'

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const partnerOrderId = typeof body.partnerOrderId === 'string' ? body.partnerOrderId.trim() : ''
  if (!partnerOrderId) {
    return NextResponse.json({ error: 'partnerOrderId is required.', success: false }, { status: 400 })
  }

  const order = await getCryptoOrderByProviderReference(partnerOrderId)
  if (!order || order.userId !== user.id || order.provider !== 'transak') {
    return NextResponse.json({ error: 'Crypto order not found.', success: false }, { status: 404 })
  }

  try {
    const result = await syncTransakOrderByPartnerReference(partnerOrderId)
    return NextResponse.json({ data: result, success: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to sync Transak order.',
      success: false,
    }, { status: 502 })
  }
}
