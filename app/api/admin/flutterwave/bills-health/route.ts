import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { listPendingBillTransactions, listProviderEvents, listRecentTransactions } from '@/lib/server/data'
import { isAmigoBillsEnabled } from '@/lib/server/amigo-bills'
import { isFlutterwaveBillsEnabled } from '@/lib/server/flutterwave-bills'

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const [pendingBills, flutterwaveProviderEvents, amigoProviderEvents, recentTransactions] = await Promise.all([
    listPendingBillTransactions(50),
    listProviderEvents({ provider: 'flutterwave_bills', limit: 20 }),
    listProviderEvents({ provider: 'amigo_data', limit: 20 }),
    listRecentTransactions(120),
  ])

  const recentBillTransactions = recentTransactions
    .filter(item =>
      item.transaction.metadata?.settlementKind === 'provider_bill'
      && (item.transaction.metadata?.providerName === 'flutterwave' || item.transaction.metadata?.providerName === 'amigo')
    )
    .slice(0, 12)
  const recentProviderEvents = [...amigoProviderEvents, ...flutterwaveProviderEvents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
  const providerFailures = recentProviderEvents
    .filter(item => item.status.toLowerCase().includes('failed') || Boolean(item.failureReason))
    .slice(0, 6)
  const recentAmigoData = recentBillTransactions
    .filter(item => item.transaction.metadata?.providerName === 'amigo' && item.transaction.type === 'data')
    .slice(0, 6)
  const recentFlutterwaveBills = recentBillTransactions
    .filter(item => item.transaction.metadata?.providerName === 'flutterwave')
    .slice(0, 6)

  return NextResponse.json({
    data: {
      configured: isFlutterwaveBillsEnabled() || isAmigoBillsEnabled(),
      rails: {
        dataPrimary: isAmigoBillsEnabled() ? 'amigo' : 'flutterwave',
        amigoConfigured: isAmigoBillsEnabled(),
        flutterwaveConfigured: isFlutterwaveBillsEnabled(),
      },
      pendingCount: pendingBills.length,
      pendingBills,
      recentFailures: recentBillTransactions.filter(item => item.transaction.status === 'failed').slice(0, 6),
      recentPending: recentBillTransactions.filter(item => item.transaction.status === 'pending').slice(0, 6),
      recentSuccess: recentBillTransactions.filter(item => item.transaction.status === 'success').slice(0, 6),
      recentAmigoData,
      recentFlutterwaveBills,
      providerFailures,
      recentProviderEvents,
    },
    success: true,
  })
}
