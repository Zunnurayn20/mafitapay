import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { createCngnVirtualAccount, getCngnBalance, isCngnMerchantEnabled } from '@/lib/server/cngn'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  if (!isCngnMerchantEnabled()) {
    return NextResponse.json({ error: 'cNGN merchant rail is not configured.', success: false }, { status: 503 })
  }

  const body = await req.json().catch(() => ({}))
  const action = body?.action === 'create_virtual_account' ? 'create_virtual_account' : 'balance'

  try {
    if (action === 'create_virtual_account') {
      const account = await createCngnVirtualAccount()
      return NextResponse.json({
        data: {
          action,
          account,
        },
        success: true,
      })
    }

    const balances = await getCngnBalance()
    return NextResponse.json({
      data: {
        action,
        balances,
      },
      success: true,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'cNGN test failed.',
      success: false,
    }, { status: 502 })
  }
}
