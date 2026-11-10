import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  getTransactionByReference,
  insertAuditLog,
  listPendingBillTransactions,
  markProviderEventProcessed,
  recordProviderEvent,
  resolvePendingTransactionByReference,
  updatePendingTransactionMetadata,
} from '@/lib/server/data'
import { getAsbdataTransactionStatus } from '@/lib/server/asbdata-bills'

const inFlightBillLookups = new Map<string, Promise<AsbdataBillSyncResult>>()
const BILL_LOOKUP_MIN_GAP_MS = 60_000

type AsbdataBillSyncResult = {
  reference: string
  checked: boolean
  synced: boolean
  status: string
  providerStatus: string | null
  reason?: string
}

function isDue(lastSyncAt: unknown) {
  if (typeof lastSyncAt !== 'string') return true
  const time = Date.parse(lastSyncAt)
  return !Number.isFinite(time) || Date.now() - time >= BILL_LOOKUP_MIN_GAP_MS
}

export function syncAsbdataBill(reference: string, actorUserId?: string, options?: { force?: boolean }) {
  const existing = inFlightBillLookups.get(reference)
  if (existing) return existing

  const run = syncAsbdataBillOnce(reference, actorUserId, options).finally(() => {
    if (inFlightBillLookups.get(reference) === run) inFlightBillLookups.delete(reference)
  })
  inFlightBillLookups.set(reference, run)
  return run
}

async function syncAsbdataBillOnce(reference: string, actorUserId?: string, options?: { force?: boolean }): Promise<AsbdataBillSyncResult> {
  const match = await getTransactionByReference(reference)
  if (!match) throw new Error('Bill transaction not found.')

  const transaction = match.transaction
  const metadata = transaction.metadata ?? {}
  if (!['data', 'airtime'].includes(transaction.type)
    || metadata.settlementKind !== 'provider_bill'
    || metadata.providerName !== 'asbdata') {
    throw new Error('This transaction is not an ASBDATA data or airtime purchase.')
  }
  if (transaction.status !== 'pending') {
    return {
      reference,
      checked: false,
      synced: false,
      status: transaction.status,
      providerStatus: typeof metadata.providerStatus === 'string' ? metadata.providerStatus : null,
    }
  }

  const providerReference = typeof metadata.providerReference === 'string' ? metadata.providerReference.trim() : ''
  // ASBDATA's vend request does not include MafitaPay's reference. A local reference cannot be
  // queried as if it were a provider ID when the API response did not return an ID.
  if (!providerReference || providerReference === reference) {
    return {
      reference,
      checked: false,
      synced: false,
      status: 'pending',
      providerStatus: typeof metadata.providerStatus === 'string' ? metadata.providerStatus : null,
      reason: 'ASBDATA did not return a provider transaction ID, so this purchase cannot be queried automatically.',
    }
  }

  if (!options?.force && !isDue(metadata.providerLastSyncAt)) {
    return {
      reference,
      checked: false,
      synced: false,
      status: 'pending',
      providerStatus: typeof metadata.providerStatus === 'string' ? metadata.providerStatus : null,
    }
  }

  let lookup: Awaited<ReturnType<typeof getAsbdataTransactionStatus>>
  try {
    lookup = await getAsbdataTransactionStatus(providerReference)
  } catch (error) {
    await updatePendingTransactionMetadata(match.userId, transaction.id, {
      ...metadata,
      providerLastSyncAt: new Date().toISOString(),
      providerLookupError: 'status_lookup_failed',
    })
    throw error
  }

  const providerStatus = lookup.rawStatus
  const checkedAt = new Date().toISOString()
  if (lookup.status === 'unknown' || lookup.status === 'pending') {
    await updatePendingTransactionMetadata(match.userId, transaction.id, {
      ...metadata,
      providerStatus: providerStatus ?? 'PENDING',
      providerLastSyncAt: checkedAt,
    })
    return { reference, checked: true, synced: false, status: 'pending', providerStatus }
  }

  const outcome = lookup.status
  await updatePendingTransactionMetadata(match.userId, transaction.id, {
    ...metadata,
    providerStatus: providerStatus ?? outcome.toUpperCase(),
    providerLastSyncAt: checkedAt,
  })
  const eventId = `asbdata-bill-sync:${providerReference}:${outcome}`
  const recorded = await recordProviderEvent({
    externalEventId: eventId,
    provider: transaction.type === 'airtime' ? 'asbdata_airtime' : 'asbdata_data',
    reference,
    status: providerStatus ?? outcome,
    failureReason: outcome === 'failed' ? lookup.reason : undefined,
    payload: lookup.payload,
  })
  const resolved = await resolvePendingTransactionByReference(reference, outcome)
  if (!resolved) {
    return {
      reference,
      checked: true,
      synced: false,
      status: transaction.status,
      providerStatus,
      reason: 'The transaction could not be settled from its current state.',
    }
  }

  if (resolved.transaction.status !== outcome) {
    return {
      reference,
      checked: true,
      synced: false,
      status: resolved.transaction.status,
      providerStatus,
      reason: 'ASBDATA reported a result that conflicts with MafitaPay’s recorded transaction status. No balance change was made.',
    }
  }

  await markProviderEventProcessed(eventId)
  if (recorded.inserted) {
    await insertAuditLog({
      userId: resolved.userId,
      actorUserId,
      action: `bill_payment.asbdata_sync_${outcome}`,
      entityType: 'transaction',
      entityId: resolved.transaction.id,
      metadata: { reference, providerReference, providerStatus },
    })
    await appendNotification(resolved.userId, createNotification({
      userId: resolved.userId,
      title: outcome === 'success' ? 'Purchase confirmed' : 'Purchase failed',
      message: outcome === 'success'
        ? `${resolved.transaction.description} has been confirmed by ASBDATA.`
        : `${resolved.transaction.description} failed and the reserved funds have been released.`,
      type: outcome === 'success' ? 'success' : 'error',
    }))
  }

  return {
    reference,
    checked: true,
    synced: true,
    status: outcome,
    providerStatus,
    reason: recorded.inserted ? undefined : 'Provider confirmation was already recorded.',
  }
}

export async function syncPendingAsbdataBills(actorUserId?: string, options?: { userId?: string }) {
  const pending = await listPendingBillTransactions(50, options?.userId)
  const targets = pending.filter(item => (
    item.transaction.metadata?.providerName === 'asbdata'
    && (item.transaction.type === 'data' || item.transaction.type === 'airtime')
    && isDue(item.transaction.metadata?.providerLastSyncAt)
  ))
  const results = await Promise.allSettled(targets.map(item => syncAsbdataBill(item.transaction.reference, actorUserId)))

  return results.reduce((acc, result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value.checked) acc.checked += 1
      if (result.value.synced) acc.synced += 1
      else acc.pending += 1
      acc.results.push({ ...result.value })
    } else {
      acc.failed += 1
      acc.results.push({
        reference: targets[index]?.transaction.reference,
        checked: false,
        synced: false,
        error: result.reason instanceof Error ? result.reason.message : 'ASBDATA status lookup failed.',
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

let syncTimerStarted = false
let syncPromise: Promise<Awaited<ReturnType<typeof syncPendingAsbdataBills>>> | null = null

export function ensureAsbdataBillSyncScheduler() {
  if (syncTimerStarted) return
  syncTimerStarted = true
  const run = () => {
    if (syncPromise) return
    syncPromise = syncPendingAsbdataBills()
      .catch(error => {
        console.warn('[asbdata-bill-sync] pass failed:', error instanceof Error ? error.message : 'unknown error')
        return { checked: 0, synced: 0, pending: 0, failed: 1, results: [] }
      })
      .finally(() => { syncPromise = null })
  }
  run()
  setInterval(run, BILL_LOOKUP_MIN_GAP_MS)
}
