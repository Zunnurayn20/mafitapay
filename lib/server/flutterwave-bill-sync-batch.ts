import { listPendingBillTransactions } from '@/lib/server/data'
import { syncFlutterwaveBill } from '@/lib/server/flutterwave-bill-sync'

let pendingFlutterwaveBillSyncPromise: Promise<Awaited<ReturnType<typeof syncPendingFlutterwaveBills>>> | null = null
let billSyncFollowUp = false
let flutterwaveBillSyncIntervalStarted = false

const BILL_SYNC_MIN_GAP_MS = 15_000

function isBillSyncDue(lastSyncAt?: unknown) {
  if (typeof lastSyncAt !== 'string') return true
  const syncedAt = Date.parse(lastSyncAt)
  return !Number.isFinite(syncedAt) || Date.now() - syncedAt >= BILL_SYNC_MIN_GAP_MS
}

export async function syncPendingFlutterwaveBills(actorUserId?: string, options?: { userId?: string; onlyDue?: boolean }) {
  const pending = await listPendingBillTransactions(50, options?.userId)
  const targets = pending.filter(item => (
    item.transaction.metadata?.providerName === 'flutterwave'
    && item.transaction.metadata?.settlementKind === 'provider_bill'
    && (!options?.onlyDue || isBillSyncDue(item.transaction.metadata?.providerLastSyncAt))
  ))
  const results = await Promise.allSettled(targets.map(item => syncFlutterwaveBill(item.transaction.reference, actorUserId)))

  return results.reduce((acc, result, index) => {
    const reference = targets[index]?.transaction.reference
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
  if (pendingFlutterwaveBillSyncPromise) {
    billSyncFollowUp = true
    return pendingFlutterwaveBillSyncPromise
  }

  pendingFlutterwaveBillSyncPromise = syncPendingFlutterwaveBills(actorUserId).finally(() => {
    pendingFlutterwaveBillSyncPromise = null
    if (billSyncFollowUp) {
      billSyncFollowUp = false
      void kickPendingFlutterwaveBillSync(actorUserId).catch(error => {
        console.warn('[flutterwave-bill-sync] follow_up_error', error instanceof Error ? error.message : 'Sync failed.')
      })
    }
  })
  return pendingFlutterwaveBillSyncPromise
}

export function ensureFlutterwaveBillSyncScheduler() {
  if (flutterwaveBillSyncIntervalStarted) return
  flutterwaveBillSyncIntervalStarted = true

  const run = () => {
    void kickPendingFlutterwaveBillSync()
  }
  run()
  setInterval(run, 30_000)
}
