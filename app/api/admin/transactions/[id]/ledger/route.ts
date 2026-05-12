import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { listRecentTransactions, getLedgerEntriesForTransaction } from '@/lib/server/data'

export async function GET(_req: Request, ctx: RouteContext<'/api/admin/transactions/[id]/ledger'>) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const { id } = await ctx.params
  const transactions = await listRecentTransactions(200)
  const match = transactions.find(item => item.transaction.id === id)

  if (!match) {
    return NextResponse.json({ error: 'Transaction not found.', success: false }, { status: 404 })
  }

  const ledgerEntries = await getLedgerEntriesForTransaction(match.userId, id)
  return NextResponse.json({ data: { userId: match.userId, transaction: match.transaction, ledgerEntries }, success: true })
}
