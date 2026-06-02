import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { listCryptoDepositAddressesByUserId } from '@/lib/server/data'
import { provisionCryptoDepositAddressesForUser } from '@/lib/server/crypto-deposit-addresses'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  return NextResponse.json({
    data: await listCryptoDepositAddressesByUserId(user.id),
    success: true,
  })
}

export async function POST() {
  const user = await requireUser()
  if (!user) return unauthorized()

  try {
    return NextResponse.json({
      data: await provisionCryptoDepositAddressesForUser(user.id),
      success: true,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to provision crypto deposit addresses.',
      success: false,
    }, { status: 503 })
  }
}

