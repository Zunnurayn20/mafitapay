'use client'

import { useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, Users } from 'lucide-react'
import {
  AdminEmpty,
  AdminPageCard,
  AdminStatusPill,
  AdminTable,
  AdminThead,
} from '@/components/admin/AdminUi'

type RecentUserRow = {
  id: string
  name: string
  referralCode: string
  phone: string
  email: string
  walletBalance: string
  accountStatus: string
  kycStatus: string
  joinedAt: string
}

type RecentTransactionRow = {
  id: string
  customerName: string
  customerContact: string
  description: string
  type: string
  reference: string
  amount: string
  isCredit: boolean
  status: string
  createdAt: string
}

export function RecentOverviewTabs({
  users,
  transactions,
}: {
  users: RecentUserRow[]
  transactions: RecentTransactionRow[]
}) {
  const [activeTab, setActiveTab] = useState<'transactions' | 'users'>('transactions')

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const nextTab = activeTab === 'transactions' ? 'users' : 'transactions'
    setActiveTab(nextTab)
    document.getElementById(`admin-recent-${nextTab}-tab`)?.focus()
  }

  const actionHref = activeTab === 'transactions' ? '/admin/transactions' : '/admin/users'
  const actionLabel = activeTab === 'transactions' ? 'View all transactions' : 'View all users'

  return (
    <AdminPageCard
      title="Recent activity"
      description="Switch between the newest transactions and customer accounts."
      actions={(
        <Link href={actionHref} className="text-sm font-semibold text-[var(--gold2)] hover:underline">
          {actionLabel}
        </Link>
      )}
    >
      <div className="border-b border-[var(--border)] px-4 pt-3">
        <div role="tablist" aria-label="Recent activity" className="flex gap-2">
          <button
            type="button"
            id="admin-recent-transactions-tab"
            role="tab"
            aria-selected={activeTab === 'transactions'}
            aria-controls="admin-recent-transactions-panel"
            tabIndex={activeTab === 'transactions' ? 0 : -1}
            onClick={() => setActiveTab('transactions')}
            onKeyDown={handleTabKeyDown}
            className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${activeTab === 'transactions' ? 'border-[var(--gold)] text-[var(--gold2)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}
          >
            <ArrowLeftRight size={16} aria-hidden="true" />
            Transactions
            <span className="rounded-full bg-[var(--clay)] px-2 py-0.5 text-xs">{transactions.length}</span>
          </button>
          <button
            type="button"
            id="admin-recent-users-tab"
            role="tab"
            aria-selected={activeTab === 'users'}
            aria-controls="admin-recent-users-panel"
            tabIndex={activeTab === 'users' ? 0 : -1}
            onClick={() => setActiveTab('users')}
            onKeyDown={handleTabKeyDown}
            className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${activeTab === 'users' ? 'border-[var(--gold)] text-[var(--gold2)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}
          >
            <Users size={16} aria-hidden="true" />
            Users
            <span className="rounded-full bg-[var(--clay)] px-2 py-0.5 text-xs">{users.length}</span>
          </button>
        </div>
      </div>

      <div
        id="admin-recent-transactions-panel"
        role="tabpanel"
        aria-labelledby="admin-recent-transactions-tab"
        tabIndex={0}
        hidden={activeTab !== 'transactions'}
      >
        {transactions.length === 0 ? <AdminEmpty label="No transactions yet." /> : (
          <AdminTable>
            <AdminThead columns={['Customer', 'Transaction', 'Amount', 'Status', 'Date']} />
            <tbody className="divide-y divide-[var(--border)]">
              {transactions.map(row => (
                <tr key={row.id} className="hover:bg-[var(--clay)]">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[var(--text)]">{row.customerName}</div>
                    <div className="text-xs text-[var(--muted)]">{row.customerContact}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text)]">{row.description || row.type}</div>
                    <div className="text-xs text-[var(--muted)]">{row.type} / {row.reference}</div>
                  </td>
                  <td className={`px-4 py-3 font-mono font-semibold ${row.isCredit ? 'text-[var(--green2)]' : 'text-[var(--red2)]'}`}>
                    {row.isCredit ? '+' : '-'}{row.amount}
                  </td>
                  <td className="px-4 py-3"><AdminStatusPill status={row.status} /></td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{row.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </div>

      <div
        id="admin-recent-users-panel"
        role="tabpanel"
        aria-labelledby="admin-recent-users-tab"
        tabIndex={0}
        hidden={activeTab !== 'users'}
      >
        {users.length === 0 ? <AdminEmpty label="No users yet." /> : (
          <AdminTable>
            <AdminThead columns={['User', 'Contact', 'Wallet', 'Status', 'Joined']} />
            <tbody className="divide-y divide-[var(--border)]">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-[var(--clay)]">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[var(--text)]">{user.name}</div>
                    <div className="text-xs text-[var(--muted)]">{user.referralCode}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--muted)]">
                    <div>{user.phone || 'No phone'}</div>
                    <div>{user.email || 'No email'}</div>
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-[var(--text)]">{user.walletBalance}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <AdminStatusPill status={user.accountStatus} />
                      <AdminStatusPill status={user.kycStatus} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{user.joinedAt}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </div>
    </AdminPageCard>
  )
}
