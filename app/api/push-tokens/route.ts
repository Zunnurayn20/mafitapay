import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { deletePushToken, upsertPushToken } from '@/lib/server/data'

const PLATFORMS = ['android', 'ios', 'web'] as const

type Platform = (typeof PLATFORMS)[number]

function readToken(body: unknown) {
  if (!body || typeof body !== 'object') return ''
  const token = (body as { token?: unknown }).token
  return typeof token === 'string' ? token.trim() : ''
}

function readPlatform(body: unknown): Platform {
  if (!body || typeof body !== 'object') return 'android'
  const platform = (body as { platform?: unknown }).platform
  return PLATFORMS.includes(platform as Platform) ? (platform as Platform) : 'android'
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  try {
    const body = await req.json()
    const token = readToken(body)
    if (!token) {
      return NextResponse.json({ error: 'A push token is required.', success: false }, { status: 400 })
    }

    await upsertPushToken({ userId: user.id, token, platform: readPlatform(body) })
    return NextResponse.json({ data: { registered: true }, success: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to register push token.',
      success: false,
    }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  try {
    const body = await req.json()
    const token = readToken(body)
    if (!token) {
      return NextResponse.json({ error: 'A push token is required.', success: false }, { status: 400 })
    }

    await deletePushToken(user.id, token)
    return NextResponse.json({ data: { removed: true }, success: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to remove push token.',
      success: false,
    }, { status: 500 })
  }
}
