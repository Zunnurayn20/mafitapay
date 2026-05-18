import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { disableTransactionPin, upsertTransactionPin } from '@/lib/server/data'

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const newPin = typeof body.newPin === 'string' ? body.newPin.trim() : ''
  const currentPin = typeof body.currentPin === 'string' ? body.currentPin.trim() : undefined
  const isUpdate = Boolean(currentPin)

  if (!newPin) {
    return NextResponse.json({ error: 'New transaction PIN is required.', success: false }, { status: 400 })
  }

  try {
    const settings = await upsertTransactionPin(user.id, newPin, currentPin)
    await appendNotification(user.id, createNotification({
      userId: user.id,
      title: isUpdate ? 'Transaction PIN updated' : 'Transaction PIN created',
      message: 'Your transaction PIN was saved successfully.',
      type: 'success',
    }))

    return NextResponse.json({ data: settings, success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Transaction PIN update failed.', success: false }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const currentPin = typeof body.currentPin === 'string' ? body.currentPin.trim() : ''
  if (!currentPin) {
    return NextResponse.json({ error: 'Current transaction PIN is required.', success: false }, { status: 400 })
  }

  try {
    const settings = await disableTransactionPin(user.id, currentPin)
    await appendNotification(user.id, createNotification({
      userId: user.id,
      title: 'Transaction PIN removed',
      message: 'Transaction PIN protection was disabled for your account.',
      type: 'info',
    }))

    return NextResponse.json({ data: settings, success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Transaction PIN disable failed.', success: false }, { status: 400 })
  }
}
