import { NextResponse } from 'next/server'
import { handleFlutterwaveWebhook } from '@/lib/server/flutterwave-webhook'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = req.headers.get('flutterwave-signature') ?? req.headers.get('verif-hash')
  if (process.env.MAFITAPAY_DEBUG_FLUTTERWAVE === '1') {
    console.log('[flutterwave-webhook] route.received', JSON.stringify({
      hasSignature: Boolean(signature),
      bodyLength: rawBody.length,
      // The v4 transfer callback arrives with no top-level `event` field, so the handler's
      // event-name branches all miss and it drops the delivery. Log the envelope keys (not the
      // values, which carry account details) so the real shape can be read off a live delivery
      // instead of guessed.
      bodyKeys: (() => {
        try {
          const parsed = JSON.parse(rawBody) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
          const top = Object.keys(parsed as Record<string, unknown>)
          const data = (parsed as Record<string, unknown>).data
          const dataKeys = data && typeof data === 'object' && !Array.isArray(data)
            ? Object.keys(data as Record<string, unknown>)
            : null
          return { top, dataKeys }
        } catch {
          return null
        }
      })(),
    }))
  }
  const result = await handleFlutterwaveWebhook({ rawBody, signature, source: 'public_webhook' })
  return NextResponse.json(result.body, { status: result.status })
}
