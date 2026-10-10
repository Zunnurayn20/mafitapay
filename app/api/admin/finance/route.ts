import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { createOwnerFinanceEntry, insertAuditLog, listOwnerFinanceEntries, summarizeOwnerFinance, voidOwnerFinanceEntry } from '@/lib/server/data'

const CATEGORIES = {
  income: ['product_margin', 'service_fee', 'other_income'],
  expense: ['provider_cost', 'network_fee', 'hosting', 'operations', 'marketing', 'payroll', 'other_expense'],
} as const

function parseDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

export async function GET(request: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const url = new URL(request.url)
  const fromDate = parseDate(url.searchParams.get('from'))
  const toDate = parseDate(url.searchParams.get('to'))
  if (!fromDate || !toDate || fromDate > toDate) {
    return NextResponse.json({ success: false, error: 'Choose a valid date range.' }, { status: 400 })
  }
  const from = fromDate.toISOString()
  const toExclusive = new Date(toDate.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const [summary, entries] = await Promise.all([
    summarizeOwnerFinance(from, toExclusive),
    listOwnerFinanceEntries(from, toExclusive),
  ])
  return NextResponse.json({ success: true, data: { summary, entries } })
}

export async function POST(request: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body.' }, { status: 400 })
  }

  const direction = body.direction
  const category = typeof body.category === 'string' ? body.category : ''
  const amountNgn = Number(body.amountNgn)
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const date = parseDate(typeof body.date === 'string' ? body.date : null)
  if ((direction !== 'income' && direction !== 'expense') || !CATEGORIES[direction].includes(category as never)) {
    return NextResponse.json({ success: false, error: 'Choose a valid type and category.' }, { status: 400 })
  }
  if (!Number.isFinite(amountNgn) || amountNgn <= 0 || amountNgn > 999_999_999_999.99) {
    return NextResponse.json({ success: false, error: 'Enter a valid amount.' }, { status: 400 })
  }
  if (!description || description.length > 200 || !date) {
    return NextResponse.json({ success: false, error: 'Add a description and a valid date.' }, { status: 400 })
  }
  const counterparty = typeof body.counterparty === 'string' ? body.counterparty.trim().slice(0, 120) : ''
  const reference = typeof body.reference === 'string' ? body.reference.trim().slice(0, 120) : ''
  const occurredAt = new Date(`${body.date as string}T12:00:00.000Z`).toISOString()
  const id = await createOwnerFinanceEntry({
    direction,
    category,
    amountNgn: Math.round(amountNgn * 100) / 100,
    description,
    counterparty: counterparty || undefined,
    reference: reference || undefined,
    occurredAt,
    recordedBy: admin.id,
  })
  await insertAuditLog({
    actorUserId: admin.id,
    action: 'owner_finance.entry_created',
    entityType: 'owner_finance_entry',
    entityId: id,
    metadata: { direction, category, amountNgn, occurredAt },
  })
  return NextResponse.json({ success: true, id }, { status: 201 })
}

export async function DELETE(request: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body.' }, { status: 400 })
  }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!id || !reason || reason.length > 200) {
    return NextResponse.json({ success: false, error: 'Provide the entry and a short correction reason.' }, { status: 400 })
  }
  const voided = await voidOwnerFinanceEntry(id, admin.id, reason)
  if (!voided) return NextResponse.json({ success: false, error: 'Entry not found or already voided.' }, { status: 404 })
  await insertAuditLog({
    actorUserId: admin.id,
    action: 'owner_finance.entry_voided',
    entityType: 'owner_finance_entry',
    entityId: id,
    metadata: { reason },
  })
  return NextResponse.json({ success: true })
}
