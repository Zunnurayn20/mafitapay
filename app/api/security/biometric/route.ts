import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { beginBiometricApproval, beginBiometricRegistration, disableBiometricCredential, finishBiometricApproval, finishBiometricRegistration } from '@/lib/server/biometric'
import { getBiometricCredentialsByUserId, upsertSecuritySettings } from '@/lib/server/data'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  const credentials = await getBiometricCredentialsByUserId(user.id)
  return NextResponse.json({ data: { credentials }, success: true })
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  try {
    const body = await req.json()
    const intent = typeof body.intent === 'string' ? body.intent : ''
    const origin = req.headers.get('origin') || new URL(req.url).origin

    if (intent === 'register_options') {
      const options = await beginBiometricRegistration(user, origin)
      return NextResponse.json({ data: { options }, success: true })
    }

    if (intent === 'register_verify') {
      await finishBiometricRegistration({
        user,
        origin,
        response: body.response,
        userAgent: req.headers.get('user-agent') || undefined,
      })

      await appendNotification(user.id, createNotification({
        userId: user.id,
        title: 'Biometric approval enabled',
        message: 'This device can now approve sensitive transactions with Face ID, fingerprint, or passkey.',
        type: 'success',
      }))

      return NextResponse.json({ data: { enrolled: true }, success: true })
    }

    if (intent === 'approval_options') {
      const options = await beginBiometricApproval(user, origin)
      return NextResponse.json({ data: { options }, success: true })
    }

    if (intent === 'approval_verify') {
      const approval = await finishBiometricApproval({
        user,
        response: body.response,
      })
      return NextResponse.json({ data: { approval }, success: true })
    }

    if (intent === 'toggle') {
      const enabled = body.enabled === true
      const settings = await upsertSecuritySettings(user.id, { biometricEnabled: enabled })
      return NextResponse.json({ data: { settings }, success: true })
    }

    return NextResponse.json({ error: 'Unsupported biometric intent.', success: false }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Biometric request failed.', success: false },
      { status: 400 }
    )
  }
}

export async function DELETE(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  try {
    const body = await req.json()
    const credentialId = typeof body.credentialId === 'string' ? body.credentialId.trim() : ''
    if (!credentialId) {
      throw new Error('credentialId is required.')
    }

    await disableBiometricCredential(user.id, credentialId)
    const credentials = await getBiometricCredentialsByUserId(user.id)
    await appendNotification(user.id, createNotification({
      userId: user.id,
      title: 'Biometric device removed',
      message: 'A biometric approval device was removed from your account.',
      type: 'info',
    }))
    return NextResponse.json({ data: { credentials }, success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Biometric removal failed.', success: false },
      { status: 400 }
    )
  }
}
