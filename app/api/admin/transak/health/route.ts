import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getTransakConfigState } from '@/lib/server/transak'

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const config = getTransakConfigState()
  const warnings: string[] = []

  if (!config.apiKeyConfigured) warnings.push('Transak API key is missing.')
  if (!config.apiSecretConfigured) warnings.push('Transak API secret is missing.')
  if (!config.referrerDomainConfigured) warnings.push('Transak referrer domain is missing.')
  if (!config.redirectUrlConfigured) warnings.push('Transak redirect URL is missing. Checkout can still open, but return flow will be weaker.')

  return NextResponse.json({
    data: {
      ...config,
      criticalChecks: [
        {
          key: 'api_key',
          label: 'API Key',
          ready: config.apiKeyConfigured,
          detail: config.apiKeyConfigured ? 'Transak API key is configured.' : 'Missing Transak API key.',
        },
        {
          key: 'api_secret',
          label: 'API Secret',
          ready: config.apiSecretConfigured,
          detail: config.apiSecretConfigured ? 'Transak API secret is configured.' : 'Missing Transak API secret.',
        },
        {
          key: 'referrer_domain',
          label: 'Referrer Domain',
          ready: config.referrerDomainConfigured,
          detail: config.referrerDomainConfigured ? 'Transak referrer domain is configured.' : 'Missing Transak referrer domain.',
        },
      ],
      warnings,
    },
    success: true,
  })
}
