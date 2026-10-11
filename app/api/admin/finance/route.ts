import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { createOwnerFinanceEntry, getCryptoOrdersByTransactionIds, insertAuditLog, listOwnerFinanceEntries, listPurchaseTransactions, summarizeOwnerFinance, voidOwnerFinanceEntry } from '@/lib/server/data'
import { getActualNativeFee, getPlatformCryptoCost, getProviderFeeEstimate } from '@/lib/server/crypto-platform-cost'

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
  const purchaseRows = await listPurchaseTransactions(from, toExclusive)
  const cryptoOrders = await getCryptoOrdersByTransactionIds(purchaseRows
    .filter(({ transaction }) => transaction.type === 'crypto_buy')
    .map(({ transaction }) => transaction.id))
  const cryptoOrdersByTransaction = new Map(cryptoOrders.map(order => [order.transactionId, order]))
  const depositRows = purchaseRows.filter(({ transaction }) => {
    if (transaction.type !== 'crypto_sell') return false
    const metadata = transaction.metadata ?? {}
    return metadata.settlementFlow === 'direct_crypto_deposit' || metadata.settlementKind === 'crypto_sell_order'
  })
  const deposits = depositRows.map(({ transaction }) => {
    const metadata = transaction.metadata ?? {}
    const cryptoAmount = typeof metadata.amountCrypto === 'number'
      ? metadata.amountCrypto
      : typeof metadata.cryptoAmount === 'number' ? metadata.cryptoAmount : null
    const marketRate = typeof metadata.marketRate === 'number' && metadata.marketRate > 0 ? metadata.marketRate : null
    const marketValueNgn = cryptoAmount !== null && marketRate !== null
      ? Math.round(cryptoAmount * marketRate * 100) / 100
      : null
    const customerCreditNgn = Math.abs(transaction.amount)
    return {
      id: transaction.id,
      reference: transaction.reference,
      type: metadata.settlementFlow === 'direct_crypto_deposit' ? 'direct_deposit' : 'crypto_sell_order',
      description: transaction.description,
      status: transaction.status,
      createdAt: transaction.createdAt,
      symbol: typeof metadata.symbol === 'string' ? metadata.symbol : String(metadata.pairId ?? 'Crypto'),
      cryptoAmount,
      customerCreditNgn,
      marketRate,
      marketValueNgn,
      spreadNgn: marketValueNgn === null ? null : Math.round((marketValueNgn - customerCreditNgn) * 100) / 100,
      marketSnapshotSource: typeof metadata.marketSnapshotSource === 'string' ? metadata.marketSnapshotSource : null,
    }
  })
  const purchases = purchaseRows.filter(({ transaction }) => transaction.type !== 'crypto_sell').map(({ transaction }) => {
    const metadata = transaction.metadata ?? {}
    const recorded = metadata.purchaseEconomics && typeof metadata.purchaseEconomics === 'object'
      ? metadata.purchaseEconomics as Record<string, unknown>
      : null
    const legacyPlanCost = transaction.type !== 'crypto_buy'
      && typeof metadata.providerPlanId === 'string'
      && typeof metadata.providerBaseAmount === 'number'
      ? metadata.providerBaseAmount
      : null
    const legacyPlanSale = typeof metadata.amount === 'number' ? metadata.amount : null
    const saleNgn = typeof recorded?.saleNgn === 'number'
      ? recorded.saleNgn
      : legacyPlanSale ?? (transaction.type === 'crypto_buy' ? Math.max(0, Math.abs(transaction.amount) - transaction.fee) : Math.abs(transaction.amount))
    let providerCostNgn = typeof recorded?.providerCostNgn === 'number'
      ? recorded.providerCostNgn
      : legacyPlanCost
    let spreadNgn = typeof recorded?.spreadNgn === 'number'
      ? recorded.spreadNgn
      : providerCostNgn !== null ? saleNgn - providerCostNgn : null
    let costStatus: 'quoted' | 'estimate' | 'unknown' = recorded?.costStatus === 'quoted' || recorded?.costStatus === 'estimate'
      ? recorded.costStatus
      : legacyPlanCost !== null ? 'quoted' : 'unknown'
    let costBasis = typeof recorded?.costBasis === 'string'
      ? recorded.costBasis
      : legacyPlanCost !== null ? 'provider_plan_catalog' : 'provider_cost_not_reported'
    if (transaction.type === 'crypto_buy') {
      const order = cryptoOrdersByTransaction.get(transaction.id)
      const marketCost = order ? getPlatformCryptoCost(order) : null
      if (marketCost) {
        const providerFees = getProviderFeeEstimate(order!).reduce((sum, fee) => sum + (fee.amountNgn ?? 0), 0)
        const nativeFees = (getActualNativeFee(order!) ?? []).reduce((sum, fee) => sum + (fee.amountNgnEstimate ?? 0), 0)
        const delivered = order!.status !== 'failed' && order!.status !== 'expired'
        providerCostNgn = delivered ? marketCost.principalNgn + providerFees + nativeFees : 0
        spreadNgn = delivered ? saleNgn - providerCostNgn : null
        costStatus = 'estimate'
        costBasis = providerFees || nativeFees ? 'market_replacement_plus_reported_delivery_fees' : 'market_replacement_snapshot'
      }
    }
    return {
      id: transaction.id,
      reference: transaction.reference,
      type: transaction.type,
      description: transaction.description,
      status: transaction.status,
      createdAt: transaction.createdAt,
      saleNgn,
      providerCostNgn,
      spreadNgn,
      costStatus,
      costBasis,
      networkFeeRecoveryNgn: typeof recorded?.customerNetworkFeeRecoveryNgn === 'number'
        ? recorded.customerNetworkFeeRecoveryNgn
        : transaction.type === 'crypto_buy' ? transaction.fee : 0,
    }
  })
  const successfulPurchases = purchases.filter(purchase => purchase.status === 'success')
  const automaticPurchases = {
    successfulCount: successfulPurchases.length,
    saleNgn: successfulPurchases.reduce((sum, purchase) => sum + purchase.saleNgn, 0),
    quotedCostNgn: successfulPurchases.filter(purchase => purchase.costStatus === 'quoted').reduce((sum, purchase) => sum + (purchase.providerCostNgn ?? 0), 0),
    quotedSpreadNgn: successfulPurchases.filter(purchase => purchase.costStatus === 'quoted').reduce((sum, purchase) => sum + (purchase.spreadNgn ?? 0), 0),
    estimatedCostNgn: successfulPurchases.filter(purchase => purchase.costStatus === 'estimate').reduce((sum, purchase) => sum + (purchase.providerCostNgn ?? 0), 0),
    estimatedSpreadNgn: successfulPurchases.filter(purchase => purchase.costStatus === 'estimate').reduce((sum, purchase) => sum + (purchase.spreadNgn ?? 0), 0),
    unknownCostCount: successfulPurchases.filter(purchase => purchase.costStatus === 'unknown').length,
  }
  const successfulDeposits = deposits.filter(deposit => deposit.status === 'success')
  const automaticDeposits = {
    successfulCount: successfulDeposits.length,
    customerCreditNgn: successfulDeposits.reduce((sum, deposit) => sum + deposit.customerCreditNgn, 0),
    marketValueNgn: successfulDeposits.reduce((sum, deposit) => sum + (deposit.marketValueNgn ?? 0), 0),
    estimatedSpreadNgn: successfulDeposits.filter(deposit => deposit.spreadNgn !== null).reduce((sum, deposit) => sum + (deposit.spreadNgn ?? 0), 0),
    missingMarketSnapshotCount: successfulDeposits.filter(deposit => deposit.marketValueNgn === null).length,
  }
  return NextResponse.json({ success: true, data: { summary, entries, purchases, automaticPurchases, deposits, automaticDeposits } })
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
