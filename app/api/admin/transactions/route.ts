import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getAnyTransactionById, listRecentTransactions } from '@/lib/server/data'
import { syncBardetechBill } from '@/lib/server/bardetech-bill-sync'
import { syncAsbdataBill } from '@/lib/server/asbdata-bill-sync'

export async function GET(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '40')
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, limitParam)) : 40

  return NextResponse.json({ data: await listRecentTransactions(limit), success: true })
}

export async function POST(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const body = await req.json().catch(() => null) as { action?: unknown; transactionId?: unknown; providerName?: unknown } | null
  if (body?.action !== 'check_bill_status') {
    return NextResponse.json({ error: 'Unsupported transaction action.', success: false }, { status: 400 })
  }
  const transactionId = typeof body.transactionId === 'string' ? body.transactionId.trim() : ''
  const providerName = body.providerName === 'asbdata' ? 'asbdata' : body.providerName === 'bardetech' ? 'bardetech' : null
  if (!transactionId || transactionId.length > 160 || !providerName) {
    return NextResponse.json({ error: 'A valid transaction ID and provider are required.', success: false }, { status: 400 })
  }

  const record = await getAnyTransactionById(transactionId)
  if (!record) return NextResponse.json({ error: 'Transaction not found.', success: false }, { status: 404 })
  if (record.transaction.status !== 'pending'
    || !['data', 'airtime'].includes(record.transaction.type)
    || record.transaction.metadata?.settlementKind !== 'provider_bill'
    || record.transaction.metadata?.providerName !== providerName) {
    return NextResponse.json({ error: 'This transaction is not an eligible pending data or airtime purchase for the selected provider.', success: false }, { status: 400 })
  }

  try {
    const data = providerName === 'asbdata'
      ? await syncAsbdataBill(record.transaction.reference, admin.id, { force: true })
      : await syncBardetechBill(record.transaction.reference, admin.id, { force: true })
    return NextResponse.json({ data, success: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to check the provider status right now.',
      success: false,
    }, { status: 502 })
  }
}
