import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'

export const runtime = 'nodejs'

const ALLOWED_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
])

const MAX_FILE_SIZE = 2 * 1024 * 1024

function toSafeBasename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset'
}

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
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only PNG, JPG, and WEBP logos are supported.', success: false }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Logo must be 2MB or smaller.', success: false }, { status: 400 })
  }

  const ext = ALLOWED_TYPES.get(file.type) as string
  const baseName = toSafeBasename(pairId || symbol || file.name.replace(/\.[^.]+$/, ''))
  const fileName = `${baseName}-${randomUUID().slice(0, 8)}${ext}`
  const targetDir = path.join(process.cwd(), 'public', 'crypto-assets')
  const targetPath = path.join(targetDir, fileName)

  await mkdir(targetDir, { recursive: true })
  await writeFile(targetPath, Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({
    data: {
      path: `/crypto-assets/${fileName}`,
      fileName,
      contentType: file.type,
      size: file.size,
    },
    success: true,
  })
}

