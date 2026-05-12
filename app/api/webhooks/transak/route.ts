import { NextResponse } from 'next/server'
import { handleTransakWebhookPayload } from '@/lib/server/transak-orders'

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid webhook payload.', success: false }, { status: 400 })
  }

  const result = await handleTransakWebhookPayload(payload)
  return NextResponse.json(result.body, { status: result.status })
}
