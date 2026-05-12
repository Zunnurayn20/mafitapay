import { NextResponse } from 'next/server'
import { processSettlementEvent } from '@/lib/server/settlements'

export const runtime = 'nodejs'

function isAuthorized(request: Request) {
  const expected = process.env.MAFITAPAY_WEBHOOK_SECRET
  if (!expected) return false

  const provided = request.headers.get('x-mafitapay-webhook-secret')
  return provided === expected
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized webhook request.', success: false }, { status: 401 })
  }

  const body = await req.json()
  const provider = typeof body.provider === 'string' ? body.provider.trim() : 'internal'
  const externalEventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  const providerReference = typeof body.providerReference === 'string' ? body.providerReference.trim() : undefined
  const failureReason = typeof body.failureReason === 'string' ? body.failureReason.trim() : undefined
  const status = body.status === 'success' ? 'success' : body.status === 'failed' ? 'failed' : null

  if (!externalEventId || !reference || !status) {
    return NextResponse.json({ error: 'eventId, reference, and valid status are required.', success: false }, { status: 400 })
  }

  try {
    const processed = await processSettlementEvent({
      provider,
      externalEventId,
      reference,
      status,
      providerReference,
      providerStatus: status,
      failureReason,
      payload: body,
    })

    if (processed.duplicate) {
      return NextResponse.json({ data: { duplicate: true, event: processed.event }, success: true })
    }

    return NextResponse.json({ data: processed.result, success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Pending transaction not found.', success: false }, { status: 404 })
  }
}
