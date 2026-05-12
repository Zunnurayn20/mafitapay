import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getFlutterwaveResolutionConfigState } from '@/lib/server/bank-resolution'
import { getFlutterwaveCollectionsConfigState } from '@/lib/server/flutterwave-collections'
import { getFlutterwaveTransferConfigState } from '@/lib/server/flutterwave-transfers'
import { getSensitiveIdentityConfigState } from '@/lib/server/data'

export async function GET() {
  const admin = await requireAdminUser()
  if (!admin) return unauthorized()

  const resolution = getFlutterwaveResolutionConfigState()
  const collections = getFlutterwaveCollectionsConfigState()
  const transfers = getFlutterwaveTransferConfigState()
  const secureIdentity = getSensitiveIdentityConfigState()

  const warnings: string[] = []
  if (!collections.secretKeyConfigured) {
    warnings.push('Flutterwave deposit collection is disabled because the secret key is missing.')
  }
  if (!secureIdentity.configured) {
    warnings.push('Secure BVN/NIN storage is disabled because MAFITAPAY_SENSITIVE_DATA_KEY is missing.')
  }
  if (!resolution.secretKeyConfigured && resolution.provider === 'flutterwave') {
    warnings.push('Account resolution is set to Flutterwave but the secret key is missing.')
  }
  if (!transfers.clientIdConfigured || !transfers.clientSecretConfigured) {
    warnings.push('Flutterwave payout initiation is disabled because client credentials are incomplete.')
  }
  if (!transfers.secretHashConfigured) {
    warnings.push('Flutterwave webhook signature verification is disabled because the secret hash is missing.')
  }
  if (!transfers.jobSecretConfigured) {
    warnings.push('Automated payout polling is disabled because the job secret is missing.')
  }
  if (!transfers.callbackUrlConfigured) {
    warnings.push('Flutterwave callback URL is not configured. Webhooks can still work if configured separately in the dashboard.')
  }

  const criticalChecks = [
    {
      key: 'secure_identity',
      label: 'Secure Identity Storage',
      ready: secureIdentity.configured,
      detail: secureIdentity.configured
        ? 'BVN/NIN encryption is configured.'
        : 'BVN/NIN encryption key is missing.',
    },
    {
      key: 'deposit_collections',
      label: 'Deposit Collections',
      ready: collections.depositsEnabled,
      detail: collections.depositsEnabled
        ? 'Flutterwave deposit collections can generate funding accounts.'
        : 'Flutterwave secret key is missing for deposit collections.',
    },
    {
      key: 'account_resolution',
      label: 'Bank Resolution',
      ready: resolution.resolutionEnabled,
      detail: resolution.resolutionEnabled
        ? `Resolver is active via ${resolution.provider}.`
        : 'Bank resolution is not live.',
    },
    {
      key: 'payout_initiation',
      label: 'Payout Initiation',
      ready: transfers.payoutsEnabled,
      detail: transfers.payoutsEnabled
        ? 'Flutterwave payout initiation is configured.'
        : 'Flutterwave client credentials are missing.',
    },
    {
      key: 'webhook_verification',
      label: 'Webhook Verification',
      ready: transfers.webhooksEnabled,
      detail: transfers.webhooksEnabled
        ? 'Webhook signatures can be verified.'
        : 'Flutterwave secret hash is missing.',
    },
  ]

  return NextResponse.json({
    data: {
      mode: {
        mixed: resolution.secretKeyConfigured && transfers.payoutsEnabled,
        resolutionOnly: resolution.secretKeyConfigured && !transfers.payoutsEnabled,
        payoutsOnly: !resolution.secretKeyConfigured && transfers.payoutsEnabled,
      },
      collections,
      criticalChecks,
      secureIdentity,
      resolution,
      transfers,
      warnings,
    },
    success: true,
  })
}
