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

export function toSafeLogoBasename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset'
}

/**
 * Written to the Railway volume, not `public/`. `public/` is baked into the Docker image from git
 * (Dockerfile: `COPY --from=builder /app/public ./public`), so a logo written there at runtime
 * lived in one container's writable layer and disappeared on the next deploy -- while the pair in
 * the database went on pointing at a path that now 404s. That is why two earlier uploads had to be
 * aliased by hand in sanitizeCryptoIcon. `data/` is the mounted volume, so these survive releases.
 */
export async function saveCryptoLogo(bytes: Buffer, contentType: string, basename: string) {
  const ext = CRYPTO_LOGO_EXTENSIONS.get(contentType)
  if (!ext) throw new Error('Only PNG, JPG, and WEBP logos are supported.')
  if (bytes.byteLength > CRYPTO_LOGO_MAX_BYTES) throw new Error('Logo must be 2MB or smaller.')

  const fileName = `${toSafeLogoBasename(basename)}-${randomUUID().slice(0, 8)}${ext}`
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
