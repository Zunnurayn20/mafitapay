import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getCngnConfigState, getCngnRuntimeState } from '@/lib/server/cngn'

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const config = getCngnConfigState()
  const runtime = await getCngnRuntimeState()
  const warnings: string[] = []

  if (!config.apiKeyConfigured) warnings.push('cNGN API key is missing.')
  if (!config.encryptionKeyConfigured) warnings.push('cNGN encryption key is missing.')
  if (!config.privateKeyConfigured) warnings.push('cNGN private key is missing.')
  if (!runtime.sodiumAvailable) warnings.push('libsodium-wrappers is not available, so encrypted cNGN responses cannot be decrypted yet.')

  return NextResponse.json({
    data: {
      ...config,
      ...runtime,
      criticalChecks: [
        {
          key: 'api_key',
          label: 'API Key',
          ready: config.apiKeyConfigured,
          detail: config.apiKeyConfigured ? 'Bearer auth can be sent to cNGN.' : 'MAFITAPAY_CNGN_API_KEY is missing.',
        },
        {
          key: 'encryption_key',
          label: 'AES Request Encryption',
          ready: config.encryptionKeyConfigured,
          detail: config.encryptionKeyConfigured ? 'AES request encryption key is configured.' : 'MAFITAPAY_CNGN_ENCRYPTION_KEY is missing.',
        },
        {
          key: 'private_key',
          label: 'Encrypted Response Decryption',
          ready: config.privateKeyConfigured && runtime.sodiumAvailable,
          detail: config.privateKeyConfigured && runtime.sodiumAvailable
            ? 'Private key and sodium runtime are available for response decryption.'
            : !config.privateKeyConfigured
              ? 'MAFITAPAY_CNGN_PRIVATE_KEY is missing.'
              : 'libsodium-wrappers is missing, so encrypted responses cannot be opened yet.',
        },
        {
          key: 'merchant_enabled',
          label: 'Merchant Rail',
          ready: config.merchantEnabled && runtime.sodiumAvailable,
          detail: config.merchantEnabled && runtime.sodiumAvailable
            ? 'cNGN merchant rail can be attempted by the server.'
            : 'cNGN merchant rail is not fully ready.',
        },
      ],
      warnings,
    },
    success: true,
  })
}
