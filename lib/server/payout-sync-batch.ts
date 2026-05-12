import { listPayoutRequests } from '@/lib/server/data'
import { syncFlutterwavePayout } from '@/lib/server/payout-sync'

export async function syncPendingFlutterwavePayouts(actorUserId?: string) {
  const pending = await listPayoutRequests({ status: 'pending', limit: 50 })
  const targets = pending.filter(item =>
    item.providerReference
    && (item.provider.toLowerCase().includes('bank_') || item.provider.toLowerCase().includes('flutterwave'))
  )

  const results = await Promise.allSettled(targets.map(item => syncFlutterwavePayout(item.reference, actorUserId)))

  return results.reduce((acc, result, index) => {
    const reference = targets[index]?.reference
    if (result.status === 'fulfilled') {
      acc.checked += 1
      if (result.value.synced) acc.synced += 1
      else acc.pending += 1
      acc.results.push({
        reference,
        synced: result.value.synced,
        status: result.value.status,
        providerStatus: result.value.providerStatus,
      })
    } else {
      acc.failed += 1
      acc.results.push({
        reference,
        synced: false,
        error: result.reason instanceof Error ? result.reason.message : 'Sync failed.',
      })
    }
    return acc
  }, {
    checked: 0,
    synced: 0,
    pending: 0,
    failed: 0,
    results: [] as Array<Record<string, unknown>>,
  })
}
