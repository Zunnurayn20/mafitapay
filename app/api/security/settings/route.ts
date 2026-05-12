import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { getSecuritySettingsByUserId, upsertSecuritySettings } from '@/lib/server/data'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: await getSecuritySettingsByUserId(user.id), success: true })
}

export async function PATCH(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const settings = await upsertSecuritySettings(user.id, {
    transactionPinEnabled: typeof body.transactionPinEnabled === 'boolean' ? body.transactionPinEnabled : undefined,
    twoFactorEnabled: typeof body.twoFactorEnabled === 'boolean' ? body.twoFactorEnabled : undefined,
    biometricEnabled: typeof body.biometricEnabled === 'boolean' ? body.biometricEnabled : undefined,
  })

  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: 'Security settings updated',
    message: 'Your authentication preferences were updated successfully.',
    type: 'success',
  }))

  return NextResponse.json({ data: settings, success: true })
}
