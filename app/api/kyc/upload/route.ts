import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])
const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

function sanitizeBaseName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const formData = await req.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A document file is required.', success: false }, { status: 400 })
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only PDF, JPG, PNG, and WEBP documents are allowed.', success: false }, { status: 400 })
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Document must be between 1 byte and 5MB.', success: false }, { status: 400 })
  }

  const extension = path.extname(file.name) || MIME_EXTENSIONS[file.type] || ''
  const fileId = `kyc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}${extension}`
  const uploadDir = path.join(process.cwd(), 'data', 'uploads', 'kyc', user.id)
  const storagePath = path.join(uploadDir, sanitizeBaseName(fileId))

  await mkdir(uploadDir, { recursive: true })
  await writeFile(storagePath, Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({
    data: {
      documentUrl: `/api/kyc/files/${encodeURIComponent(fileId)}`,
      documentName: file.name || fileId,
      mimeType: file.type,
      fileSize: file.size,
    },
    success: true,
  }, { status: 201 })
}
