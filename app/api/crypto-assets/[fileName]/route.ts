import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const CONTENT_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

/**
 * Serve an admin-uploaded crypto logo from the persistent volume.
 *
 * Deliberately public, unlike its sibling `/api/kyc/files/[fileId]`: these logos render for every
 * customer on the crypto list, including before a session resolves, and they carry nothing private.
 * Requiring auth here would simply break the images.
 *
 * Uploads cannot live in `public/` -- that directory is rebuilt from git in the Docker image on every
 * deploy, so a runtime write there survives only until the next release. The upload route therefore
 * writes to `data/uploads/crypto-assets/` on the Railway volume, and this route is how those files
 * reach the browser. Logos seeded in git keep being served straight from `public/crypto-assets/`.
 */
export async function GET(_req: Request, ctx: RouteContext<'/api/crypto-assets/[fileName]'>) {
  const { fileName } = await ctx.params
  // basename strips any traversal segments before they can escape the upload directory.
  const safeFileName = path.basename(fileName)
  const contentType = CONTENT_TYPES.get(path.extname(safeFileName).toLowerCase())
  if (!contentType) {
    return NextResponse.json({ error: 'Unsupported crypto logo type.', success: false }, { status: 404 })
  }

  // Left to inference rather than annotated `Buffer`: readFile resolves to Buffer<ArrayBuffer>,
  // which satisfies BodyInit, while a bare `Buffer` widens to Buffer<ArrayBufferLike> and does not.
  const buffer = await readFile(path.join(process.cwd(), 'data', 'uploads', 'crypto-assets', safeFileName))
    .catch(() => null)
  if (!buffer) {
    return NextResponse.json({ error: 'Crypto logo not found.', success: false }, { status: 404 })
  }

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.byteLength),
      // The uploader appends a random suffix per file, so a given URL's bytes never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
