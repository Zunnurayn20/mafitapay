import { handlePalmPayWebhook } from '@/lib/server/palmpay-webhook'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const rawBody = await req.text()

  if (process.env.MAFITAPAY_DEBUG_PALMPAY === '1') {
    console.log('[palmpay-webhook] route.received', JSON.stringify({
      bodyLength: rawBody.length,
    }))
  }

  const result = await handlePalmPayWebhook(rawBody)
  return new Response(result.body, {
    status: result.status,
    headers: {
      'Content-Type': result.contentType,
    },
  })
}
