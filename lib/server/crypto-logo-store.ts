import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * One place that decides where a crypto logo lands and what URL serves it back, shared by the
 * operator upload route and the contract-address lookup that imports a logo from CoinGecko. Both
 * must agree on the directory and the served path, so neither owns the rule alone.
 */

export const CRYPTO_LOGO_MAX_BYTES = 2 * 1024 * 1024

export const CRYPTO_LOGO_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
])

const SUPABASE_CRYPTO_LOGO_BUCKET = 'crypto-assets'

function getSupabaseStorageConfig() {
  const projectUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/$/, '')
  const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  return projectUrl && secretKey ? { projectUrl, secretKey } : null
}

function storageHeaders(secretKey: string) {
  const headers: Record<string, string> = { apikey: secretKey }
  // Current sb_secret_* keys are opaque API keys, not JWTs. Supabase translates them using the
  // apikey header; sending one as a Bearer token makes Storage reject it as an invalid JWT.
  if (!secretKey.startsWith('sb_')) headers.Authorization = `Bearer ${secretKey}`
  return headers
}

async function ensureSupabaseCryptoLogoBucket(projectUrl: string, secretKey: string) {
  const bucketUrl = `${projectUrl}/storage/v1/bucket/${SUPABASE_CRYPTO_LOGO_BUCKET}`
  const headers = storageHeaders(secretKey)
  const existing = await fetch(bucketUrl, { headers, signal: AbortSignal.timeout(10_000) })
  if (existing.ok) return

  const existingError = await existing.json().catch(() => ({})) as {
    code?: string
    message?: string
    statusCode?: string
  }
  const bucketMissing = existing.status === 404
    || existingError.code === 'NoSuchBucket'
    || /bucket not found/i.test(existingError.message ?? '')
  if (!bucketMissing) {
    throw new Error(
      `Supabase Storage could not check the crypto-assets bucket (HTTP ${existing.status}, ${existingError.code ?? existingError.message ?? 'unknown error'}).`,
    )
  }

  const response = await fetch(`${projectUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: SUPABASE_CRYPTO_LOGO_BUCKET,
      name: SUPABASE_CRYPTO_LOGO_BUCKET,
      public: true,
      file_size_limit: CRYPTO_LOGO_MAX_BYTES,
      allowed_mime_types: [...CRYPTO_LOGO_EXTENSIONS.keys()],
    }),
    signal: AbortSignal.timeout(10_000),
  })

  // A concurrent first upload may have created the bucket already. Verify before treating a
  // conflict as success because Storage versions have returned both 400 and 409 for duplicates.
  if (response.status === 409 || response.status === 400) {
    const createdByAnotherRequest = await fetch(bucketUrl, { headers, signal: AbortSignal.timeout(10_000) })
    if (createdByAnotherRequest.ok) return
  }
  if (!response.ok) {
    const details = await response.json().catch(() => ({})) as { code?: string; message?: string }
    throw new Error(
      `Supabase Storage could not prepare the crypto-assets bucket (HTTP ${response.status}, ${details.code ?? details.message ?? 'unknown error'}).`,
    )
  }
}

async function saveCryptoLogoToSupabase(bytes: Buffer, contentType: string, fileName: string) {
  const config = getSupabaseStorageConfig()
  if (!config) {
    throw new Error('Logo storage is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to the Vercel Production environment.')
  }

  await ensureSupabaseCryptoLogoBucket(config.projectUrl, config.secretKey)
  const response = await fetch(
    `${config.projectUrl}/storage/v1/object/${SUPABASE_CRYPTO_LOGO_BUCKET}/${encodeURIComponent(fileName)}`,
    {
      method: 'POST',
      headers: {
        ...storageHeaders(config.secretKey),
        'Content-Type': contentType,
        'Cache-Control': 'max-age=31536000',
        'x-upsert': 'false',
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(20_000),
    },
  )

  if (!response.ok) {
    throw new Error(`Supabase Storage could not save the logo (HTTP ${response.status}).`)
  }
}

export function getSupabaseCryptoLogoPublicUrl(fileName: string) {
  const config = getSupabaseStorageConfig()
  if (!config) return null
  return `${config.projectUrl}/storage/v1/object/public/${SUPABASE_CRYPTO_LOGO_BUCKET}/${encodeURIComponent(fileName)}`
}

export function toSafeLogoBasename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset'
}

/**
 * On Vercel, logos go to Supabase Storage because function filesystems are temporary. On persistent
 * self-hosted deployments, keep using the mounted data volume. Both return the same app URL so the
 * database and UI do not need to know which storage backend serves the file.
 */
export async function saveCryptoLogo(bytes: Buffer, contentType: string, basename: string) {
  const ext = CRYPTO_LOGO_EXTENSIONS.get(contentType)
  if (!ext) throw new Error('Only PNG, JPG, and WEBP logos are supported.')
  if (bytes.byteLength > CRYPTO_LOGO_MAX_BYTES) throw new Error('Logo must be 2MB or smaller.')

  const fileName = `${toSafeLogoBasename(basename)}-${randomUUID().slice(0, 8)}${ext}`

  if (process.env.VERCEL) {
    await saveCryptoLogoToSupabase(bytes, contentType, fileName)
    return {
      fileName,
      path: `/api/crypto-assets/${fileName}`,
      contentType,
      size: bytes.byteLength,
    }
  }

  const targetDir = path.join(process.cwd(), 'data', 'uploads', 'crypto-assets')

  await mkdir(targetDir, { recursive: true })
  await writeFile(path.join(targetDir, fileName), bytes)

  return {
    fileName,
    // Served by app/api/crypto-assets/[fileName]/route.ts, since nothing outside `public/` is a
    // static route. Stored verbatim as the pair's icon.
    path: `/api/crypto-assets/${fileName}`,
    contentType,
    size: bytes.byteLength,
  }
}
