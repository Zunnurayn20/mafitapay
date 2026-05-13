'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { useAppStore } from '@/store'
import { fmtDate, formatNGN } from '@/lib/utils'
import type { CryptoOrder } from '@/types'

const STATUS_FILTERS = ['all', 'pending', 'fulfilled', 'failed', 'expired'] as const
const ORDER_LIST_CACHE_TTL_MS = 5_000
const ORDER_SYNC_POLL_MS = 15_000

const orderListSnapshot = new Map<string, { data: CryptoOrder[]; fetchedAt: number }>()
const orderListInflight = new Map<string, Promise<CryptoOrder[]>>()

function compactHash(value: string, head = 10, tail = 8) {
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function formatPairLabel(pairId: string) {
  return pairId.replace(/_/g, ' · ')
}

function formatCryptoQuantity(value: number) {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1) return value.toFixed(6).replace(/\.?0+$/, '')
  return value.toFixed(8).replace(/\.?0+$/, '')
}

function getOrderStatusLabel(order: CryptoOrder) {
  if (order.status === 'fulfilled' || order.destinationTxHash) return 'Delivered to wallet'
  if (order.status === 'failed') return 'Delivery failed'
  if (order.status === 'expired') return 'Quote expired'
  if (order.executionRail === 'near_intents' && order.providerStatus === 'SUCCESS:AWAITING_NATIVE_PAYOUT') {
    return 'Awaiting treasury payout'
  }
  if (order.executionRail === 'sui_treasury' && order.providerStatus === 'DONE:AWAITING_SUI_PAYOUT') {
    return 'Awaiting treasury payout'
  }
  if (order.executionRail === 'routed_treasury') return 'Awaiting bridge confirmation'
  if (order.executionRail === 'sui_treasury') return 'Awaiting SUI settlement'
  if (order.executionRail === 'near_intents') return 'Awaiting NEAR settlement'
  if (order.executionStatus === 'broadcasted') return 'Awaiting network confirmation'
  return 'Queued for execution'
}

function getOrderStatusTone(order: CryptoOrder) {
  if (order.status === 'fulfilled' || order.destinationTxHash) return 'success'
  if (order.status === 'failed' || order.status === 'expired') return 'failed'
  return 'pending'
}

function isOrderStillProcessing(order: CryptoOrder) {
  return order.status === 'pending'
}

async function fetchCryptoOrders(status: (typeof STATUS_FILTERS)[number], force = false) {
  const params = new URLSearchParams({ limit: '50' })
  if (status !== 'all') params.set('status', status)
  const key = params.toString()
  const now = Date.now()

  if (!force) {
    const snapshot = orderListSnapshot.get(key)
    if (snapshot && now - snapshot.fetchedAt < ORDER_LIST_CACHE_TTL_MS) {
      return snapshot.data
    }
  }

  const existing = orderListInflight.get(key)
  if (existing) return existing

  const request = fetch(`/api/crypto/orders?${key}`, {
    credentials: 'include',
    cache: 'no-store',
  }).then(async response => {
    const payload = await response.json()
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || 'Failed to load crypto orders.')
    }
    const nextOrders = Array.isArray(payload.data) ? payload.data as CryptoOrder[] : []
    orderListSnapshot.set(key, { data: nextOrders, fetchedAt: Date.now() })
    return nextOrders
  }).finally(() => {
    orderListInflight.delete(key)
  })

  orderListInflight.set(key, request)
  return request
}

export default function CryptoOrdersPage() {
  const { showToast } = useAppStore()
  const [orders, setOrders] = useState<CryptoOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('all')
  const [syncingPending, setSyncingPending] = useState(false)

  const load = useCallback(async (nextStatus: (typeof STATUS_FILTERS)[number], options?: { background?: boolean; force?: boolean }) => {
    if (!options?.background) setLoading(true)
    try {
      const nextOrders = await fetchCryptoOrders(nextStatus, options?.force === true)
      setOrders(nextOrders)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load crypto orders.', 'error')
    } finally {
      if (!options?.background) setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void load(status)
  }, [load, status])

  const pendingSyncOrders = useMemo(() => orders.filter(order =>
    order.status === 'pending'
    && (order.executionRail === 'base_legacy' || order.executionRail === 'base_treasury' || order.executionRail === 'bsc_treasury' || order.executionRail === 'routed_treasury' || order.executionRail === 'sui_treasury' || order.executionRail === 'near_intents')
    && order.executionStatus === 'broadcasted'
    && !(order.executionRail === 'near_intents' && order.providerStatus === 'SUCCESS:AWAITING_NATIVE_PAYOUT')
    && !(order.executionRail === 'sui_treasury' && order.providerStatus === 'DONE:AWAITING_SUI_PAYOUT')
  ), [orders])

  useEffect(() => {
    if (pendingSyncOrders.length === 0) return
    if (syncingPending) return

    let active = true
    const timer = globalThis.setTimeout(() => {
      if (!active) return
      setSyncingPending(true)

      void (async () => {
        for (const order of pendingSyncOrders) {
          if (!active) return
          await fetch(`/api/crypto/orders/${encodeURIComponent(order.id)}/sync`, {
            method: 'POST',
            credentials: 'include',
          })
        }
      })().then(async () => {
        if (!active) return
        await load(status, { background: true, force: true })
      }).finally(() => {
        if (active) setSyncingPending(false)
      })
    }, ORDER_SYNC_POLL_MS)

    return () => {
      active = false
      globalThis.clearTimeout(timer)
    }
  }, [load, pendingSyncOrders, status, syncingPending])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map(item => (
          <button
            key={item}
            onClick={() => setStatus(item)}
            className={`px-3.5 py-1.5 text-[10px] font-bold border transition-all ${status === item ? 'border-[var(--gold)] text-[var(--gold2)] bg-[rgba(79,70,229,.08)]' : 'border-[var(--border)] text-[var(--text2)] bg-[var(--clay)] hover:border-[var(--border2)]'}`}
          >
            {item.toUpperCase()}
          </button>
        ))}
      </div>

      <Card>
        <div className="border-b border-[var(--border)] px-5 py-4">
          <div className="text-[13px] font-bold text-[var(--text)]">Crypto Orders</div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">Track your buy and sell orders, delivery status, and execution details.</div>
        </div>

        {loading ? (
          <div className="p-5 text-[11px] text-[var(--muted)]">Loading crypto orders…</div>
        ) : orders.length === 0 ? (
          <div className="p-5 text-[11px] text-[var(--muted)]">No crypto orders found for this filter.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {orders.map(order => (
              <div key={order.id} className="flex flex-col gap-3 px-5 py-4 xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] xl:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[13px] font-bold text-[var(--text)]">{formatPairLabel(order.pairId)}</div>
                    <Badge variant={getOrderStatusTone(order)}>
                      {order.status}
                    </Badge>
                    <Badge variant="pending">{order.side}</Badge>
                    {isOrderStillProcessing(order) && (
                      <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.7px] text-[var(--gold2)]">
                        <span>Processing</span>
                        <span className="flex items-center gap-1">
                          {[0, 1, 2].map(index => (
                            <span
                              key={index}
                              className="h-1.5 w-1.5 rounded-full bg-[var(--gold2)] animate-soft-pulse"
                              style={{ animationDelay: `${index * 0.2}s` }}
                            />
                          ))}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-[12px] font-semibold text-[var(--text)]">
                    {formatNGN(order.amountNgn)} for {formatCryptoQuantity(order.cryptoAmount)}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    {fmtDate(order.createdAt)} · Rate {formatNGN(order.unitRate)}
                  </div>
                </div>

                <div className="min-w-0 text-[10px] text-[var(--muted)]">
                  <div>
                    Destination: <span className="font-semibold text-[var(--text2)]">{order.walletAddress
                      ? compactHash(order.walletAddress)
                      : order.destinationLabel || order.destinationType}</span>
                  </div>
                  {order.destinationTxHash ? (
                    <div className="mt-1">
                      Tx: <span className="font-mono text-[var(--text2)]">{compactHash(order.destinationTxHash)}</span>
                    </div>
                  ) : (
                    <div className="mt-1">
                      {order.executionRail === 'routed_treasury'
                        ? 'Bridge route in progress'
                        : order.executionRail === 'sui_treasury'
                          ? order.providerStatus === 'DONE:AWAITING_SUI_PAYOUT'
                            ? 'Waiting for treasury payout'
                            : 'SUI treasury swap in progress'
                        : order.executionRail === 'near_intents'
                          ? order.providerStatus === 'SUCCESS:AWAITING_NATIVE_PAYOUT'
                            ? 'Waiting for treasury payout'
                            : 'NEAR swap in progress'
                        : order.executionStatus === 'broadcasted'
                          ? 'Waiting for network confirmation'
                          : 'Waiting for treasury execution'}
                    </div>
                  )}
                </div>

                <div className={`justify-self-start border px-3 py-2 text-[10px] font-semibold xl:justify-self-end ${
                  getOrderStatusTone(order) === 'success'
                    ? 'border-[rgba(46,170,92,.3)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]'
                    : getOrderStatusTone(order) === 'failed'
                      ? 'border-[rgba(196,52,26,.3)] bg-[rgba(196,52,26,.08)] text-[var(--red2)]'
                      : 'border-[rgba(202,165,96,.3)] bg-[rgba(202,165,96,.1)] text-[var(--gold2)]'
                }`}>
                  {getOrderStatusLabel(order)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
