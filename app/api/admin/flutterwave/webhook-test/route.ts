import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { insertAuditLog } from '@/lib/server/data'
import { handleFlutterwaveWebhook } from '@/lib/server/flutterwave-webhook'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const body = await req.json().catch(() => null)
  const payloadInput = isRecord(body) ? body.payload : null
  const rawPayload = typeof payloadInput === 'string'
    ? payloadInput
    : payloadInput && isRecord(payloadInput)
      ? JSON.stringify(payloadInput)
      : ''

  if (!rawPayload) {
    return NextResponse.json({ error: 'payload is required.', success: false }, { status: 400 })
  }

  const result = await handleFlutterwaveWebhook({
    rawBody: rawPayload,
    skipSignatureVerification: true,
    source: 'admin_test',
  })

  let reference = ''
  let eventType = ''
  try {
    const parsed = JSON.parse(rawPayload) as unknown
    if (isRecord(parsed)) {
      eventType = typeof parsed.event === 'string' ? parsed.event.trim() : ''
      const data = isRecord(parsed.data) ? parsed.data : {}
      reference = typeof data.reference === 'string'
        ? data.reference.trim()
        : typeof data.tx_ref === 'string'
          ? data.tx_ref.trim()
          : ''
    }
  } catch {
    // no-op
  }

  await insertAuditLog({
    actorUserId: admin.id,
    action: 'flutterwave.webhook_test',
    entityType: 'provider_event',
    entityId: reference || eventType || 'manual_test',
    metadata: {
      reference: reference || null,
      eventType: eventType || null,
      status: result.status,
      success: result.body.success ?? false,
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
