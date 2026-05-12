import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { resolvePendingTransaction } from '@/lib/server/data'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: Request, context: RouteContext) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const { id } = await context.params
  const { status } = await req.json()

  if (status !== 'success' && status !== 'failed') {
    return NextResponse.json({ error: 'Status must be success or failed.', success: false }, { status: 400 })
  }

  const result = await resolvePendingTransaction(user.id, id, status)
  if (!result) {
    return NextResponse.json({ error: 'Transaction not found.', success: false }, { status: 404 })
  }

  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: status === 'success' ? 'Pending transaction settled' : 'Pending transaction failed',
    message:
      status === 'success'
        ? `${result.transaction.description} has been marked successful.`
        : `${result.transaction.description} failed and any locked funds were released.`,
    type: status === 'success' ? 'success' : 'error',
  }))

  return NextResponse.json({ data: result, success: true })
}
