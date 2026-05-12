import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { getWalletByUserId } from '@/lib/server/data'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: await getWalletByUserId(user.id), success: true })
}
