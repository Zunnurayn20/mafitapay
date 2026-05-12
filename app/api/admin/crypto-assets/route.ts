import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getCryptoAssetById, getCryptoAssets, upsertCryptoAssets } from '@/lib/server/data'
import type { CryptoAsset } from '@/types'

export async function GET() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: await getCryptoAssets(), success: true })
}

export async function PATCH(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const assets = Array.isArray(body.assets) ? body.assets as CryptoAsset[] : null

  if (!assets) {
    return NextResponse.json({ error: 'assets array is required.', success: false }, { status: 400 })
  }

  return NextResponse.json({ data: await upsertCryptoAssets(assets), success: true })
}

export async function POST(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const pairId = typeof body.pairId === 'string' ? body.pairId.trim() : ''
  if (!pairId) {
    return NextResponse.json({ error: 'pairId is required.', success: false }, { status: 400 })
  }

  const asset = await getCryptoAssetById(pairId)
  if (!asset) {
    return NextResponse.json({ error: 'Crypto pair not found.', success: false }, { status: 404 })
  }

  return NextResponse.json({ data: asset, success: true })
}
