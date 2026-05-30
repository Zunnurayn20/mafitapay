'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import type { AuditLog, BillProvider, CryptoAsset, CryptoOrder, DepositIntent, KycSubmission, PayoutRequest, ProviderDiagnosticsReport, ProviderEvent, Transaction, User, Wallet } from '@/types'

type QuickModal = 'transactions' | 'activity' | 'wallets' | 'users' | 'settlements' | 'providers' | 'bills' | 'crypto' | 'health'

type AdminQuickData = {
  transactions: Array<{ userId: string; transaction: Transaction }>
  auditLogs: AuditLog[]
  walletRows: Array<{ user: User; wallet: Wallet | null }>
  users: User[]
  kycItems: KycSubmission[]
  depositIntents: DepositIntent[]
  payoutRequests: PayoutRequest[]
  providerDiagnostics: ProviderDiagnosticsReport | null
  billProviders: BillProvider[]
  cryptoAssets: CryptoAsset[]
  cryptoOrders: CryptoOrder[]
  providerEvents: ProviderEvent[]
}

const EMPTY_DATA: AdminQuickData = {
  transactions: [],
  auditLogs: [],
  walletRows: [],
  users: [],
  kycItems: [],
  depositIntents: [],
  payoutRequests: [],
  providerDiagnostics: null,
  billProviders: [],
  cryptoAssets: [],
  cryptoOrders: [],
  providerEvents: [],
}

async function fetchAdminJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`${url} returned ${response.status} ${response.statusText || 'non-JSON response'}. Restart dev server if this is local.`)
  }
  const payload = await response.json()
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `${url} failed with ${response.status}.`)
  }
  return payload.data as T
}

async function fetchAdminJsonSafe<T>(url: string, fallback: T): Promise<T> {
  try {
    return await fetchAdminJson<T>(url)
  } catch (error) {
    console.warn('[admin-quick-access] load_failed', {
      url,
      error: error instanceof Error ? error.message : 'Request failed',
    })
    return fallback
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusTone(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'fulfilled' || normalized === 'active') return 'text-[var(--green2)]'
  if (normalized === 'failed' || normalized === 'expired') return 'text-[var(--red2)]'
  return 'text-[var(--gold2)]'
}

export function AdminQuickAccess() {
  const [data, setData] = useState<AdminQuickData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeModal, setActiveModal] = useState<QuickModal | null>(null)
  const [walletForm, setWalletForm] = useState({ userId: '', direction: 'credit', amount: '', reason: '' })
  const [walletSaving, setWalletSaving] = useState(false)
  const [walletError, setWalletError] = useState('')

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        setLoading(true)
        setError('')
        const [
          transactions,
          auditLogs,
          walletRows,
          users,
          kycItems,
          depositIntents,
          payoutRequests,
          providerDiagnostics,
          billProviders,
          cryptoAssets,
          cryptoOrders,
          providerEvents,
        ] = await Promise.all([
          fetchAdminJsonSafe<Array<{ userId: string; transaction: Transaction }>>('/api/admin/transactions?limit=12', []),
          fetchAdminJsonSafe<AuditLog[]>('/api/admin/audit-logs?limit=12', []),
          fetchAdminJsonSafe<Array<{ user: User; wallet: Wallet | null }>>('/api/admin/wallets?limit=25', []),
          fetchAdminJsonSafe<User[]>('/api/admin/users', []),
          fetchAdminJsonSafe<KycSubmission[]>('/api/admin/kyc', []),
          fetchAdminJsonSafe<DepositIntent[]>('/api/admin/deposit-intents?limit=12', []),
          fetchAdminJsonSafe<PayoutRequest[]>('/api/admin/payout-requests?limit=12', []),
          fetchAdminJsonSafe<ProviderDiagnosticsReport | null>('/api/admin/provider-events/report', null),
          fetchAdminJsonSafe<BillProvider[]>('/api/admin/bill-providers', []),
          fetchAdminJsonSafe<CryptoAsset[]>('/api/admin/crypto-assets', []),
          fetchAdminJsonSafe<CryptoOrder[]>('/api/admin/crypto-orders?status=pending&limit=12', []),
          fetchAdminJsonSafe<ProviderEvent[]>('/api/admin/provider-events?limit=12', []),
        ])

        if (!active) return
        setData({
          transactions: Array.isArray(transactions) ? transactions : [],
          auditLogs: Array.isArray(auditLogs) ? auditLogs : [],
          walletRows: Array.isArray(walletRows) ? walletRows : [],
          users: Array.isArray(users) ? users : [],
          kycItems: Array.isArray(kycItems) ? kycItems : [],
          depositIntents: Array.isArray(depositIntents) ? depositIntents : [],
          payoutRequests: Array.isArray(payoutRequests) ? payoutRequests : [],
          providerDiagnostics: providerDiagnostics ?? null,
          billProviders: Array.isArray(billProviders) ? billProviders : [],
          cryptoAssets: Array.isArray(cryptoAssets) ? cryptoAssets : [],
          cryptoOrders: Array.isArray(cryptoOrders) ? cryptoOrders : [],
          providerEvents: Array.isArray(providerEvents) ? providerEvents : [],
        })
      } catch (quickAccessError) {
        if (!active) return
        setError(quickAccessError instanceof Error ? quickAccessError.message : 'Failed to load admin quick access.')
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [])

  const activeBillProviders = data.billProviders.filter(item => item.isActive !== false)
  const liveCryptoAssets = data.cryptoAssets.filter(item => item.isActive !== false)
  const failedProviderEvents = data.providerEvents.filter(item => item.status.toLowerCase() === 'failed')
  const pendingKyc = data.kycItems.filter(item => item.status === 'pending')
  const blockedUsers = data.users.filter(item => item.accountStatus !== 'active')
  const pendingDeposits = data.depositIntents.filter(item => item.status === 'pending')
  const pendingPayouts = data.payoutRequests.filter(item => item.status === 'pending')
  const totalWalletBalance = data.walletRows.reduce((sum, item) => sum + (item.wallet?.balance ?? 0), 0)
  const selectedWalletRow = data.walletRows.find(item => item.user.id === walletForm.userId) ?? data.walletRows[0] ?? null
  const latestTransaction = data.transactions[0]?.transaction
  const latestAudit = data.auditLogs[0]

  async function submitWalletAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (walletSaving) return

    setWalletSaving(true)
    setWalletError('')
    try {
      const response = await fetch('/api/admin/wallets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: walletForm.userId || selectedWalletRow?.user.id,
          direction: walletForm.direction,
          amount: walletForm.amount,
          reason: walletForm.reason,
        }),
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error(`/api/admin/wallets returned ${response.status} ${response.statusText || 'non-JSON response'}. Restart dev server if this is local.`)
      }
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Unable to adjust wallet.')
      }

      const nextRow = payload.data as { user: User; wallet: Wallet }
      setData(current => ({
        ...current,
        walletRows: current.walletRows.map(item => item.user.id === nextRow.user.id ? nextRow : item),
      }))
      setWalletForm(current => ({ ...current, amount: '', reason: '' }))
    } catch (adjustError) {
      setWalletError(adjustError instanceof Error ? adjustError.message : 'Unable to adjust wallet.')
    } finally {
      setWalletSaving(false)
    }
  }

  return (
    <section className="border border-[var(--border)] bg-[var(--coal)] p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[1.2px] text-[var(--muted)]">Superuser Control Center</div>
          <div className="mt-1 truncate text-[14px] font-black text-[var(--text)]">Fast access to live operational data</div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[9px] font-bold uppercase tracking-[.8px]">
          <span className="border border-[var(--border)] bg-[var(--clay)] px-2 py-1 text-[var(--text2)]">{data.users.length} users</span>
          <span className="border border-[var(--border)] bg-[var(--clay)] px-2 py-1 text-[var(--text2)]">₦{totalWalletBalance.toLocaleString('en-NG')} wallets</span>
          <span className="border border-[var(--border)] bg-[var(--clay)] px-2 py-1 text-[var(--text2)]">{pendingKyc.length} kyc</span>
          <span className="border border-[var(--border)] bg-[var(--clay)] px-2 py-1 text-[var(--text2)]">{pendingDeposits.length + pendingPayouts.length} settlements</span>
          {loading && <span className="border border-[var(--gold)] bg-[rgba(202,165,96,.10)] px-2 py-1 text-[var(--gold2)]">Loading</span>}
        </div>
      </div>

      {error ? (
        <div className="mt-3 border border-[var(--red2)] bg-[rgba(196,52,26,.08)] p-2 text-[11px] text-[var(--red2)]">
          {error}
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-10">
          <QuickAccessLink
            href="/admin/analytics"
            label="Analytics"
            value="Live"
            detail="Money movement, users, wallets, product mix, and provider reliability"
          />
          <QuickAccessCard
            label="All App Transactions"
            value={data.transactions.length.toString()}
            detail={latestTransaction ? `${latestTransaction.status.toUpperCase()} · ${latestTransaction.type} · ₦${latestTransaction.amount.toLocaleString('en-NG')}` : 'No recent transaction'}
            onClick={() => setActiveModal('transactions')}
          />
          <QuickAccessCard
            label="Recent Activity"
            value={data.auditLogs.length.toString()}
            detail={latestAudit ? latestAudit.action : 'No audit activity'}
            onClick={() => setActiveModal('activity')}
          />
          <QuickAccessCard
            label="Wallet Control"
            value={`₦${totalWalletBalance.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`}
            detail={`${data.walletRows.length} wallets · credit/debit with audit log`}
            onClick={() => {
              if (!walletForm.userId && selectedWalletRow) {
                setWalletForm(current => ({ ...current, userId: selectedWalletRow.user.id }))
              }
              setActiveModal('wallets')
            }}
          />
          <QuickAccessCard
            label="Users & KYC"
            value={data.users.length.toString()}
            detail={`${pendingKyc.length} pending KYC · ${blockedUsers.length} restricted accounts`}
            onClick={() => setActiveModal('users')}
          />
          <QuickAccessCard
            label="Settlements"
            value={(pendingDeposits.length + pendingPayouts.length).toString()}
            detail={`${pendingDeposits.length} deposits · ${pendingPayouts.length} payouts pending`}
            onClick={() => setActiveModal('settlements')}
          />
          <QuickAccessCard
            label="Provider Events"
            value={(data.providerDiagnostics?.totalPendingEvents ?? data.providerEvents.length).toString()}
            detail={`${data.providerDiagnostics?.totalFailedEvents24h ?? failedProviderEvents.length} failures in 24h`}
            onClick={() => setActiveModal('providers')}
          />
          <QuickAccessCard
            label="Bills"
            value={activeBillProviders.length.toString()}
            detail={`${data.billProviders.length - activeBillProviders.length} archived providers`}
            onClick={() => setActiveModal('bills')}
          />
          <QuickAccessCard
            label="Crypto"
            value={data.cryptoOrders.length.toString()}
            detail={`${liveCryptoAssets.length} active assets · ${failedProviderEvents.length} failed events`}
            onClick={() => setActiveModal('crypto')}
          />
          <QuickAccessCard
            label="System Health"
            value={data.providerDiagnostics ? 'Live' : '—'}
            detail={`${data.providerDiagnostics?.totalRetryingEvents ?? 0} retrying events · ${data.providerDiagnostics?.providers.length ?? 0} providers`}
            onClick={() => setActiveModal('health')}
          />
        </div>
      )}

      <Modal
        open={activeModal === 'transactions'}
        onClose={() => setActiveModal(null)}
        title="All App Transactions"
        subtitle="Who did it, transaction type, time, date, status, amount, and reference"
        size="lg"
        className="max-w-4xl"
      >
        <div className="space-y-2 p-4">
          {data.transactions.length === 0 ? (
            <EmptyState label="No recent transactions available." />
          ) : data.transactions.map(item => (
            <div key={item.transaction.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold text-[var(--text)]">{item.transaction.description}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">User: {item.userId}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">Type: {item.transaction.type} · Date: {formatDate(item.transaction.createdAt)}</div>
                  <div className="mt-1 truncate text-[10px] text-[var(--muted)]">Ref: {item.transaction.reference}</div>
                </div>
                <div className="shrink-0 text-left sm:text-right">
                  <div className="text-[12px] font-black text-[var(--text)]">₦{item.transaction.amount.toLocaleString('en-NG')}</div>
                  <div className={`mt-1 text-[10px] font-bold uppercase tracking-[.8px] ${statusTone(item.transaction.status)}`}>
                    {item.transaction.status}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <ModalFooter href="/admin/operations/support" label="Open Ledger Tools" />
        </div>
      </Modal>

      <Modal
        open={activeModal === 'activity'}
        onClose={() => setActiveModal(null)}
        title="Admin Recent Activity"
        subtitle="Latest audit events"
        size="lg"
        className="max-w-4xl"
      >
        <div className="space-y-2 p-4">
          {data.auditLogs.length === 0 ? (
            <EmptyState label="No admin activity recorded yet." />
          ) : data.auditLogs.map(item => (
            <div key={item.id} className="grid gap-2 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-bold text-[var(--text)]">{item.action}</div>
                <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.entityType} · {item.entityId}</div>
              </div>
              <div className="truncate text-[10px] text-[var(--muted)]">Actor: {item.actorUserId ?? 'system'}</div>
              <div className="text-[10px] text-[var(--muted)]">{formatDate(item.createdAt)}</div>
            </div>
          ))}
          <ModalFooter href="/admin/users/audit" label="Open Audit Trail" />
        </div>
      </Modal>

      <Modal
        open={activeModal === 'wallets'}
        onClose={() => setActiveModal(null)}
        title="Wallet Control"
        subtitle="Audited manual credits and debits with transaction and ledger records"
        size="lg"
        className="max-w-5xl"
      >
        <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,.9fr)]">
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Wallets</div>
            {data.walletRows.length === 0 ? (
              <EmptyState label="No wallets available." />
            ) : data.walletRows.map(item => (
              <button
                key={item.user.id}
                type="button"
                onClick={() => setWalletForm(current => ({ ...current, userId: item.user.id }))}
                className={`grid w-full gap-2 border px-3 py-2 text-left transition-all sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                  (walletForm.userId || selectedWalletRow?.user.id) === item.user.id
                    ? 'border-[var(--gold)] bg-[rgba(202,165,96,.10)]'
                    : 'border-[var(--border)] bg-[var(--clay)] hover:border-[var(--border2)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold text-[var(--text)]">{item.user.name}</div>
                  <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.user.email} · {item.user.id}</div>
                </div>
                <div className="text-left sm:text-right">
                  <div className="text-[12px] font-black text-[var(--text)]">₦{(item.wallet?.balance ?? 0).toLocaleString('en-NG')}</div>
                  <div className="mt-1 text-[9px] uppercase tracking-[.8px] text-[var(--muted)]">Locked ₦{(item.wallet?.lockedBalance ?? 0).toLocaleString('en-NG')}</div>
                </div>
              </button>
            ))}
          </div>

          <form onSubmit={submitWalletAdjustment} className="border border-[var(--border)] bg-[var(--clay)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Adjust Selected Wallet</div>
            <div className="mt-2 text-[13px] font-black text-[var(--text)]">{selectedWalletRow?.user.name ?? 'No wallet selected'}</div>
            <div className="mt-1 text-[10px] text-[var(--muted)]">{selectedWalletRow?.user.email ?? 'Select a wallet from the list.'}</div>

            <label className="mt-4 block">
              <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">User</div>
              <select
                value={walletForm.userId || selectedWalletRow?.user.id || ''}
                onChange={event => setWalletForm(current => ({ ...current, userId: event.target.value }))}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
              >
                {data.walletRows.map(item => (
                  <option key={item.user.id} value={item.user.id}>{item.user.name} · {item.user.email}</option>
                ))}
              </select>
            </label>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label>
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Direction</div>
                <select
                  value={walletForm.direction}
                  onChange={event => setWalletForm(current => ({ ...current, direction: event.target.value }))}
                  className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
                >
                  <option value="credit">Credit</option>
                  <option value="debit">Debit</option>
                </select>
              </label>
              <label>
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Amount</div>
                <input
                  value={walletForm.amount}
                  onChange={event => setWalletForm(current => ({ ...current, amount: event.target.value }))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
                />
              </label>
            </div>

            <label className="mt-3 block">
              <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Reason</div>
              <textarea
                value={walletForm.reason}
                onChange={event => setWalletForm(current => ({ ...current, reason: event.target.value }))}
                rows={3}
                placeholder="Required for audit trail"
                className="mt-1 w-full resize-none border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
              />
            </label>

            {walletError && <div className="mt-3 border border-[var(--red2)] bg-[rgba(196,52,26,.08)] p-2 text-[10px] text-[var(--red2)]">{walletError}</div>}

            <button
              type="submit"
              disabled={walletSaving || !selectedWalletRow}
              className="mt-4 w-full bg-[var(--gold)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[var(--terra2)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {walletSaving ? 'Saving Adjustment…' : 'Apply Wallet Adjustment'}
            </button>

            <div className="mt-3 text-[9px] leading-relaxed text-[var(--muted)]">
              Every adjustment creates a transaction, ledger entry, audit event, and user notification.
            </div>
          </form>
        </div>
      </Modal>

      <Modal
        open={activeModal === 'users'}
        onClose={() => setActiveModal(null)}
        title="Users & KYC"
        subtitle="User accounts, access state, and pending identity reviews"
        size="lg"
        className="max-w-5xl"
      >
        <div className="grid gap-3 p-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Users</div>
            {data.users.slice(0, 10).map(item => (
              <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-bold text-[var(--text)]">{item.name}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.email} · {item.phone}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.id} · Joined {formatDate(item.createdAt)}</div>
                  </div>
                  <div className={`shrink-0 text-[10px] font-bold uppercase tracking-[.8px] ${statusTone(item.accountStatus)}`}>
                    {item.accountStatus}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Pending KYC</div>
            {pendingKyc.length === 0 ? (
              <EmptyState label="No pending KYC submissions." />
            ) : pendingKyc.slice(0, 10).map(item => (
              <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-bold text-[var(--text)]">{item.documentType.toUpperCase()} review</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">User: {item.userId}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">Submitted {formatDate(item.createdAt)}</div>
                  </div>
                  <div className={`text-[10px] font-bold uppercase tracking-[.8px] ${statusTone(item.status)}`}>{item.status}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="lg:col-span-2">
            <ModalFooter href="/admin/users/accounts" label="Open Accounts" secondaryHref="/admin/users/kyc" secondaryLabel="Open KYC Queue" />
          </div>
        </div>
      </Modal>

      <Modal
        open={activeModal === 'settlements'}
        onClose={() => setActiveModal(null)}
        title="Settlements"
        subtitle="Deposit intents and payout requests requiring operational attention"
        size="lg"
        className="max-w-5xl"
      >
        <div className="grid gap-3 p-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Deposit Intents</div>
            {data.depositIntents.length === 0 ? (
              <EmptyState label="No recent deposit intents." />
            ) : data.depositIntents.map(item => (
              <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold text-[var(--text)]">₦{item.netAmount.toLocaleString('en-NG')} · {item.provider}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.userId} · {item.reference}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{formatDate(item.createdAt)}</div>
                    {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">{item.failureReason}</div>}
                  </div>
                  <div className={`shrink-0 text-[10px] font-bold uppercase tracking-[.8px] ${statusTone(item.status)}`}>{item.status}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Payout Requests</div>
            {data.payoutRequests.length === 0 ? (
              <EmptyState label="No recent payout requests." />
            ) : data.payoutRequests.map(item => (
              <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold text-[var(--text)]">₦{item.amount.toLocaleString('en-NG')} · {item.provider}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.userId} · {item.reference}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{formatDate(item.createdAt)}</div>
                    {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">{item.failureReason}</div>}
                  </div>
                  <div className={`shrink-0 text-[10px] font-bold uppercase tracking-[.8px] ${statusTone(item.status)}`}>{item.status}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="lg:col-span-2">
            <ModalFooter href="/admin/operations/settlements" label="Open Settlements" secondaryHref="/admin/operations/support" secondaryLabel="Open Reference Support" />
          </div>
        </div>
      </Modal>

      <Modal
        open={activeModal === 'providers'}
        onClose={() => setActiveModal(null)}
        title="Provider Events"
        subtitle="Webhook, retry, and provider failure queue"
        size="lg"
        className="max-w-5xl"
      >
        <div className="space-y-3 p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniMetric label="Pending" value={data.providerDiagnostics?.totalPendingEvents ?? 0} />
            <MiniMetric label="Failures 24h" value={data.providerDiagnostics?.totalFailedEvents24h ?? failedProviderEvents.length} />
            <MiniMetric label="Retrying" value={data.providerDiagnostics?.totalRetryingEvents ?? 0} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Events</div>
              {data.providerEvents.length === 0 ? (
                <EmptyState label="No provider events recorded." />
              ) : data.providerEvents.map(item => (
                <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-bold text-[var(--text)]">{item.provider}</div>
                      <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.reference} · {item.externalEventId}</div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">{item.processedAt ? `Processed ${formatDate(item.processedAt)}` : 'Pending processing'}</div>
                      {item.failureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">{item.failureReason}</div>}
                    </div>
                    <div className={`shrink-0 text-[10px] font-bold uppercase tracking-[.8px] ${statusTone(item.status)}`}>{item.status}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Provider Summary</div>
              {(data.providerDiagnostics?.providers ?? []).length === 0 ? (
                <EmptyState label="No provider diagnostics available." />
              ) : data.providerDiagnostics!.providers.map(item => (
                <div key={item.provider} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
                  <div className="text-[12px] font-bold text-[var(--text)]">{item.provider}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    Pending {item.pendingCount} · Failed {item.failedCount} · Retrying {item.retryingCount}
                  </div>
                  {item.lastFailureReason && <div className="mt-1 text-[10px] text-[var(--red2)]">{item.lastFailureReason}</div>}
                </div>
              ))}
            </div>
          </div>
          <ModalFooter href="/admin/operations/events" label="Open Provider Events" secondaryHref="/admin/health/providers" secondaryLabel="Open Provider Health" />
        </div>
      </Modal>

      <Modal
        open={activeModal === 'bills'}
        onClose={() => setActiveModal(null)}
        title="Bills"
        subtitle="Provider catalog snapshot"
        size="lg"
        className="max-w-4xl"
      >
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          {data.billProviders.length === 0 ? (
            <EmptyState label="No bill providers configured." />
          ) : data.billProviders.map(item => (
            <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">{item.icon} {item.name}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.type} · {item.id}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    ₦{(item.minAmount ?? 0).toLocaleString('en-NG')} - ₦{(item.maxAmount ?? 0).toLocaleString('en-NG')}
                  </div>
                </div>
                <div className={`text-[10px] font-bold uppercase tracking-[.8px] ${item.isActive === false ? 'text-[var(--muted)]' : 'text-[var(--green2)]'}`}>
                  {item.isActive === false ? 'Archived' : 'Active'}
                </div>
              </div>
            </div>
          ))}
          <div className="sm:col-span-2">
            <ModalFooter href="/admin/catalogs/bills" label="Open Bill Providers" />
          </div>
        </div>
      </Modal>

      <Modal
        open={activeModal === 'crypto'}
        onClose={() => setActiveModal(null)}
        title="Crypto"
        subtitle="Pending orders and asset coverage"
        size="lg"
        className="max-w-5xl"
      >
        <div className="grid gap-3 p-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Pending Orders</div>
            {data.cryptoOrders.length === 0 ? (
              <EmptyState label="No pending crypto orders." />
            ) : data.cryptoOrders.map(item => (
              <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold text-[var(--text)]">{item.pairId} · {item.side.toUpperCase()}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.userId} · {formatDate(item.createdAt)}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--muted)]">Tx: {item.transactionId}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[12px] font-black text-[var(--text)]">₦{item.amountNgn.toLocaleString('en-NG')}</div>
                    <div className={`mt-1 text-[10px] font-bold uppercase tracking-[.8px] ${statusTone(item.status)}`}>{item.status}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Assets</div>
            {data.cryptoAssets.slice(0, 12).map(item => (
              <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-bold text-[var(--text)]">{item.symbol} · {item.network}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.name} · {item.executionRail ?? 'catalog only'}</div>
                  </div>
                  <div className={`text-[10px] font-bold uppercase tracking-[.8px] ${item.isActive === false ? 'text-[var(--muted)]' : 'text-[var(--green2)]'}`}>
                    {item.isActive === false ? 'Archived' : 'Active'}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="lg:col-span-2">
            <ModalFooter href="/admin/operations/orders" label="Open Crypto Orders" secondaryHref="/admin/catalogs/assets" secondaryLabel="Open Crypto Assets" />
          </div>
        </div>
      </Modal>

      <Modal
        open={activeModal === 'health'}
        onClose={() => setActiveModal(null)}
        title="System Health"
        subtitle="High-level readiness for provider queues and critical admin routes"
        size="lg"
        className="max-w-4xl"
      >
        <div className="space-y-3 p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniMetric label="Providers" value={data.providerDiagnostics?.providers.length ?? 0} />
            <MiniMetric label="Pending Events" value={data.providerDiagnostics?.totalPendingEvents ?? 0} />
            <MiniMetric label="Failures 24h" value={data.providerDiagnostics?.totalFailedEvents24h ?? 0} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <HealthLink href="/admin/health/rails" label="Rails" detail="Base executor, treasury, 0x, and onchain settlement readiness." />
            <HealthLink href="/admin/health/providers" label="Providers" detail="Flutterwave, webhook verification, bills rail, and provider queue state." />
            <HealthLink href="/admin/health/market" label="Market" detail="Crypto price freshness, cache age, and per-asset live/fallback status." />
            <HealthLink href="/admin/operations/support" label="Support Tools" detail="Ledger traces, reference cases, and webhook acceptance tests." />
          </div>
        </div>
      </Modal>
    </section>
  )
}

function QuickAccessCard({
  label,
  value,
  detail,
  onClick,
}: {
  label: string
  value: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-h-[5.75rem] border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--gold2)] hover:bg-[rgba(255,255,255,.035)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[9px] font-bold uppercase tracking-[.9px] text-[var(--muted)]">{label}</div>
        <div className="shrink-0 text-[8px] font-bold uppercase tracking-[.8px] text-[var(--gold2)] group-hover:text-[var(--green2)]">Open</div>
      </div>
      <div className="mt-2 text-[22px] font-black leading-none text-[var(--text)]">{value}</div>
      <div className="mt-2 line-clamp-2 text-[9px] leading-relaxed text-[var(--muted)]">{detail}</div>
    </button>
  )
}

function QuickAccessLink({
  href,
  label,
  value,
  detail,
}: {
  href: string
  label: string
  value: string
  detail: string
}) {
  return (
    <Link
      href={href}
      className="group min-h-[5.75rem] border border-[var(--border)] bg-[var(--clay)] px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--gold2)] hover:bg-[rgba(255,255,255,.035)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[9px] font-bold uppercase tracking-[.9px] text-[var(--muted)]">{label}</div>
        <div className="shrink-0 text-[8px] font-bold uppercase tracking-[.8px] text-[var(--gold2)] group-hover:text-[var(--green2)]">Open</div>
      </div>
      <div className="mt-2 text-[22px] font-black leading-none text-[var(--text)]">{value}</div>
      <div className="mt-2 line-clamp-2 text-[9px] leading-relaxed text-[var(--muted)]">{detail}</div>
    </Link>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--clay)] p-4 text-[11px] text-[var(--muted)]">
      {label}
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--clay)] px-3 py-2">
      <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-[18px] font-black text-[var(--text)]">{value}</div>
    </div>
  )
}

function HealthLink({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <Link href={href} className="block border border-[var(--border)] bg-[var(--clay)] p-3 transition-all hover:border-[var(--gold2)] hover:bg-[rgba(255,255,255,.035)]">
      <div className="text-[12px] font-bold text-[var(--text)]">{label}</div>
      <div className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">{detail}</div>
      <div className="mt-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Open</div>
    </Link>
  )
}

function ModalFooter({
  href,
  label,
  secondaryHref,
  secondaryLabel,
}: {
  href: string
  label: string
  secondaryHref?: string
  secondaryLabel?: string
}) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
      <Link href={href} className="inline-flex items-center justify-center bg-[var(--gold)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-[var(--terra2)]">
        {label}
      </Link>
      {secondaryHref && secondaryLabel && (
        <Link href={secondaryHref} className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text2)] transition-colors hover:border-[var(--gold2)] hover:text-[var(--text)]">
          {secondaryLabel}
        </Link>
      )}
    </div>
  )
}
