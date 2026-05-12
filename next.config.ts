import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const configDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  turbopack: {
    root: configDir,
    resolveAlias: {
      tailwindcss: path.join(configDir, 'node_modules/tailwindcss'),
      '@tailwindcss/postcss': path.join(configDir, 'node_modules/@tailwindcss/postcss'),
    },
  },
}

export default nextConfig
