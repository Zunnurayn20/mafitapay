import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { CRYPTO_LOGO_EXTENSIONS, CRYPTO_LOGO_MAX_BYTES, saveCryptoLogo } from '@/lib/server/crypto-logo-store'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const formData = await req.formData()
  const file = formData.get('file')
  const pairId = typeof formData.get('pairId') === 'string' ? String(formData.get('pairId')).trim() : ''
  const symbol = typeof formData.get('symbol') === 'string' ? String(formData.get('symbol')).trim() : ''

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Image file is required.', success: false }, { status: 400 })
  }
  if (!CRYPTO_LOGO_EXTENSIONS.has(file.type)) {
    return NextResponse.json({ error: 'Only PNG, JPG, and WEBP logos are supported.', success: false }, { status: 400 })
  }
  if (file.size > CRYPTO_LOGO_MAX_BYTES) {
    return NextResponse.json({ error: 'Logo must be 2MB or smaller.', success: false }, { status: 400 })
  }

  try {
    const saved = await saveCryptoLogo(
      Buffer.from(await file.arrayBuffer()),
      file.type,
      pairId || symbol || file.name.replace(/\.[^.]+$/, ''),
    )

    return NextResponse.json({ data: saved, success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Logo upload failed.'
    console.error('[crypto-assets/upload] Logo upload failed:', message)
    return NextResponse.json({ error: message, success: false }, { status: 503 })
  }
}
