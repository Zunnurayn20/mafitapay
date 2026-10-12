import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { getSecuritySettingsByUserId, upsertSecuritySettings } from '@/lib/server/data'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const settings = await getSecuritySettingsByUserId(user.id)
  return NextResponse.json({ data: settings ? { ...settings, twoFactorEnabled: false } : null, success: true })
}

export async function PATCH(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  if (body.twoFactorEnabled === true) {
    return NextResponse.json({
      error: 'Two-factor authentication is not available yet. This setting does not protect sign-ins.',
      success: false,
    }, { status: 409 })
  }
  const settings = await upsertSecuritySettings(user.id, {
    transactionPinEnabled: typeof body.transactionPinEnabled === 'boolean' ? body.transactionPinEnabled : undefined,
    twoFactorEnabled: false,
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
