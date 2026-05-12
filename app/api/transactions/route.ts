import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getTransactionsForUser } from '@/lib/server/data'

export async function GET(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const transactions = await getTransactionsForUser(user.id)
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const data = type ? transactions.filter(t => t.type === type) : transactions
  return NextResponse.json({ data, success: true, total: data.length })
}
