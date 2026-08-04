import { listPayoutRequests } from '@/lib/server/data'
import { isFlutterwavePayoutEnabled } from '@/lib/server/flutterwave-transfers'
import { syncFlutterwavePayout } from '@/lib/server/payout-sync'
import { sanitizeErrorForLogs } from '@/lib/utils'

let pendingFlutterwavePayoutSyncPromise: Promise<Awaited<ReturnType<typeof syncPendingFlutterwavePayouts>>> | null = null
let flutterwavePayoutSyncIntervalStarted = false

// Poll cadence for reconciling pending payouts. Each pending payout costs one HTTPS retrieve, so
// this stays well below the crypto scanner's cost, but keep it configurable and off the 30s bills
// cadence so the two schedulers do not stack up on the same tick.
const PAYOUT_SYNC_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.MAFITAPAY_FLUTTERWAVE_PAYOUT_SYNC_INTERVAL_MS ?? 60_000) || 60_000
)

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

/** Run a reconcile pass, collapsing concurrent callers onto one in-flight run. */
export function kickPendingFlutterwavePayoutSync(actorUserId?: string) {
  if (!pendingFlutterwavePayoutSyncPromise) {
    pendingFlutterwavePayoutSyncPromise = syncPendingFlutterwavePayouts(actorUserId).finally(() => {
      pendingFlutterwavePayoutSyncPromise = null
    })
  }
  return pendingFlutterwavePayoutSyncPromise
}

/**
 * Reconcile pending payouts on a timer.
 *
 * Payouts were the only provider flow with no automatic backstop: settlement depended entirely on
 * the webhook, so a callback that never arrived — or arrived in an envelope the handler did not
 * recognise and dropped with a 200 — left the payout at `pending` forever even though the money had
 * moved and the recipient had been paid. Retrieving the transfer directly resolves it regardless of
 * whether any callback lands, which also makes this robust to the webhook shape changing again.
 */
export function ensureFlutterwavePayoutSyncScheduler() {
  if (flutterwavePayoutSyncIntervalStarted) return
  if (!isFlutterwavePayoutEnabled()) return
  flutterwavePayoutSyncIntervalStarted = true

  setInterval(() => {
    void kickPendingFlutterwavePayoutSync().catch(error => {
      console.warn('[flutterwave-payout-sync] scheduler_error', sanitizeErrorForLogs(error))
    })
  }, PAYOUT_SYNC_INTERVAL_MS)
}
