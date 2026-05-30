import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireAdminUser, unauthorized } from '@/lib/server/auth'
import { applyWalletMutation, getUserById, getWalletByUserId, insertAuditLog, listUsers, sanitizeUser } from '@/lib/server/data'
import type { Transaction } from '@/types'

function normalizeAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN
}

export async function GET(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '25')
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, limitParam)) : 25
  const users = (await listUsers()).slice(0, limit)
  const rows = await Promise.all(users.map(async user => ({
    user,
    wallet: await getWalletByUserId(user.id),
  })))

  return NextResponse.json({ data: rows, success: true })
}

export async function PATCH(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const body = await req.json()
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const direction = body.direction === 'debit' ? 'debit' : body.direction === 'credit' ? 'credit' : null
  const amount = normalizeAmount(body.amount)
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (!userId || !direction || !Number.isFinite(amount) || amount <= 0 || !reason) {
    return NextResponse.json({ error: 'userId, direction, positive amount, and reason are required.', success: false }, { status: 400 })
  }

  const targetUser = await getUserById(userId)
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found.', success: false }, { status: 404 })
  }

  const now = new Date().toISOString()
  const reference = `admin_wallet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const transaction: Transaction = {
    id: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: direction === 'credit' ? 'admin_credit' : 'admin_debit',
    status: 'success',
    amount,
    fee: 0,
    description: direction === 'credit' ? 'Admin wallet credit' : 'Admin wallet debit',
    reference,
    narration: reason,
    createdAt: now,
    icon: direction === 'credit' ? '➕' : '➖',
    metadata: {
      source: 'admin_wallet_adjustment',
      adminUserId: admin.id,
      adminEmail: admin.email,
      reason,
    },
  }

  try {
    const result = await applyWalletMutation({
      userId,
      balanceDelta: direction === 'credit' ? amount : -amount,
      minimumAvailableBalance: direction === 'debit' ? amount : undefined,
      transaction,
    })

    await insertAuditLog({
      userId,
      actorUserId: admin.id,
      action: `wallet.${direction}_manual`,
      entityType: 'wallet',
      entityId: userId,
      metadata: { amount, reason, reference, transactionId: transaction.id },
    })

    await appendNotification(userId, createNotification({
      userId,
      title: direction === 'credit' ? 'Wallet credited by admin' : 'Wallet adjusted by admin',
      message: direction === 'credit'
        ? `₦${amount.toLocaleString('en-NG')} was credited to your wallet.`
        : `₦${amount.toLocaleString('en-NG')} was debited from your wallet.`,
      type: direction === 'credit' ? 'success' : 'info',
    }))

    return NextResponse.json({
      data: {
        user: sanitizeUser(targetUser),
        wallet: result.wallet,
        transaction: result.transaction,
      },
      success: true,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to adjust wallet.', success: false },
      { status: 400 }
    )
  }
}
