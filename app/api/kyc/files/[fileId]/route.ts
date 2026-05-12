import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { requireAdminUser, requireUser, unauthorized } from '@/lib/server/auth'
import { getKycSubmissionByDocumentUrl } from '@/lib/server/data'

export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: RouteContext<'/api/kyc/files/[fileId]'>) {
  const [user, admin] = await Promise.all([requireUser(), requireAdminUser()])
  if (!user && !admin) return unauthorized()

  const { fileId } = await ctx.params
  const documentUrl = `/api/kyc/files/${encodeURIComponent(fileId)}`
  const submission = await getKycSubmissionByDocumentUrl(documentUrl)

  if (!submission) {
    return NextResponse.json({ error: 'KYC file not found.', success: false }, { status: 404 })
  }

  const viewer = admin ?? user
  if (!viewer) return unauthorized()
  if (!admin && submission.userId !== viewer.id) {
    return unauthorized()
  }

  const safeFileId = path.basename(fileId)
  const storagePath = path.join(process.cwd(), 'data', 'uploads', 'kyc', submission.userId, safeFileId)
  const buffer = await readFile(storagePath)

  return new Response(buffer, {
    headers: {
      'Content-Type': submission.mimeType ?? 'application/octet-stream',
      'Content-Length': String(buffer.byteLength),
      'Content-Disposition': `inline; filename="${submission.documentName ?? safeFileId}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
