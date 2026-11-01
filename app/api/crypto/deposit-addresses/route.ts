import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { listCryptoDepositAddressesByUserId } from '@/lib/server/data'
import { provisionCryptoDepositAddressesForUser } from '@/lib/server/crypto-deposit-addresses'
import { sanitizeErrorForLogs } from '@/lib/utils'

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
    console.error('[crypto/deposit-addresses] provisioning failed', sanitizeErrorForLogs(error))
    return NextResponse.json({
      error: 'We couldn’t set up your crypto deposit addresses right now. Please try again later or contact support.',
      success: false,
    }, { status: 503 })
  }
}

