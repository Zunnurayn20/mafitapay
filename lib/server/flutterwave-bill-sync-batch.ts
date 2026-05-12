import { listPendingBillTransactions } from '@/lib/server/data'
import { syncFlutterwaveBill } from '@/lib/server/flutterwave-bill-sync'

let pendingFlutterwaveBillSyncPromise: Promise<Awaited<ReturnType<typeof syncPendingFlutterwaveBills>>> | null = null
let flutterwaveBillSyncIntervalStarted = false

export async function syncPendingFlutterwaveBills(actorUserId?: string) {
  const pending = await listPendingBillTransactions(50)
  const results = await Promise.allSettled(pending.map(item => syncFlutterwaveBill(item.transaction.reference, actorUserId)))

  return results.reduce((acc, result, index) => {
    const reference = pending[index]?.transaction.reference
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
        error: result.reason instanceof Error ? result.reason.message : 'Bill sync failed.',
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

export function kickPendingFlutterwaveBillSync(actorUserId?: string) {
  if (!pendingFlutterwaveBillSyncPromise) {
    pendingFlutterwaveBillSyncPromise = syncPendingFlutterwaveBills(actorUserId).finally(() => {
      pendingFlutterwaveBillSyncPromise = null
    })
  }
  return pendingFlutterwaveBillSyncPromise
}

export function ensureFlutterwaveBillSyncScheduler() {
  if (flutterwaveBillSyncIntervalStarted) return
  flutterwaveBillSyncIntervalStarted = true

  setInterval(() => {
    void kickPendingFlutterwaveBillSync()
  }, 30_000)
}
