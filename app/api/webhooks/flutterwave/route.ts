import { NextResponse } from 'next/server'
import { handleFlutterwaveWebhook } from '@/lib/server/flutterwave-webhook'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = req.headers.get('flutterwave-signature') ?? req.headers.get('verif-hash')
  const result = await handleFlutterwaveWebhook({ rawBody, signature, source: 'public_webhook' })
  return NextResponse.json(result.body, { status: result.status })
}
