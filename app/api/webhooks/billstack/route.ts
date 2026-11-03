import { NextResponse } from 'next/server'
import { handleBillStackWebhook } from '@/lib/server/billstack-webhook'
import { isBillStackEnabled, verifyBillStackWebhookSignature } from '@/lib/server/billstack'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  if (!isBillStackEnabled()) {
    return NextResponse.json({ status: false, message: 'BillStack webhook is not configured.' }, { status: 503 })
  }

  const rawBody = await req.text()
  const timestamp = req.headers.get('x-wiaxy-timestamp')
  const signature = req.headers.get('x-wiaxy-signature-256')
  if (!verifyBillStackWebhookSignature({ rawBody, timestamp, signature })) {
    return NextResponse.json({ status: false, message: 'Invalid webhook signature.' }, { status: 401 })
  }

  try {
    const result = await handleBillStackWebhook(rawBody)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('[billstack-webhook] handler failed', error instanceof Error ? error.message : 'Unknown handler error')
    return NextResponse.json({ status: false, message: 'Unable to process the BillStack payment. Please retry.' }, { status: 503 })
  }
}
