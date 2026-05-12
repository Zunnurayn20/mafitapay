import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { getCryptoMarketHealth } from '@/lib/server/crypto-market'
import { insertAuditLog, refreshCryptoMarketSnapshots } from '@/lib/server/data'

export async function POST() {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  const assets = await refreshCryptoMarketSnapshots()
  const health = await getCryptoMarketHealth()

  await insertAuditLog({
    actorUserId: user.id,
    action: 'crypto_market.refresh',
    entityType: 'crypto_market',
    entityId: 'market_snapshot',
    metadata: {
      refreshedAssets: assets.map(item => item.id),
      status: health.status,
      provider: health.provider,
    },
  })

  return NextResponse.json({
    data: {
      assets,
      health,
    },
    success: true,
  })
}
