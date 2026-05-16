'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { AdminSubmodule } from '../admin-config'
import type { AdminWorkspaceState } from '../useAdminWorkspace'

export function AdminUsersSection({ workspace, submodule }: { workspace: AdminWorkspaceState; submodule?: AdminSubmodule }) {
  const [selectedKycId, setSelectedKycId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const {
    filteredKycItems,
    kycFundingFilter,
    setKycFundingFilter,
    reviewNotes,
    setReviewNotes,
    reviewKyc,
    reviewingId,
    users,
    updateUserStatus,
    updatingUserId,
    auditLogs,
  } = workspace
  const showKyc = !submodule || submodule === 'kyc'
  const showAccounts = !submodule || submodule === 'accounts'
  const showAudit = !submodule || submodule === 'audit'
  const selectedKycItem = filteredKycItems.find(item => item.id === selectedKycId) ?? null
  const selectedAccount = users.find(item => item.id === selectedAccountId) ?? null

  return (
    <>
      {showKyc && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">KYC Review Queue</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setKycFundingFilter('all')}
              className={`border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[1px] ${
                kycFundingFilter === 'all'
                  ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)] text-[var(--gold2)]'
                  : 'border-[var(--border)] bg-[var(--clay)] text-[var(--muted)]'
              }`}
            >
              All IDs
            </button>
            <button
              type="button"
              onClick={() => setKycFundingFilter('funding_only')}
              className={`border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[1px] ${
                kycFundingFilter === 'funding_only'
                  ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)] text-[var(--gold2)]'
                  : 'border-[var(--border)] bg-[var(--clay)] text-[var(--muted)]'
              }`}
            >
              BVN/NIN Only
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredKycItems.length === 0 ? (
            <div className="text-[11px] text-[var(--muted)]">No KYC submissions available.</div>
          ) : filteredKycItems.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedKycId(item.id)}
              className={`border bg-[var(--clay)] p-4 text-left transition-all ${
                selectedKycId === item.id
                  ? 'border-[var(--gold)] bg-[rgba(202,165,96,.08)]'
                  : 'border-[var(--border)] hover:border-[var(--border2)]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">{item.documentType.toUpperCase()} · {item.documentNumber}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">User: {item.userId}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString('en-NG')}</div>
                </div>
                <div className={`border px-2.5 py-1 text-[8px] font-bold ${
                  item.status === 'approved'
                    ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]'
                    : item.status === 'rejected'
                      ? 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.1)] text-[var(--red2)]'
                      : 'border-[rgba(99,102,241,.3)] bg-[rgba(79,70,229,.1)] text-[var(--gold2)]'
                }`}>
                  {item.status.toUpperCase()}
                </div>
              </div>
              <div className="mt-3 text-[10px] text-[var(--gold2)]">
                Open Review
              </div>
            </button>
          ))}
        </div>
        <Modal
          open={Boolean(selectedKycItem)}
          onClose={() => setSelectedKycId(null)}
          title={selectedKycItem ? `${selectedKycItem.documentType.toUpperCase()} Review` : 'KYC Review'}
          subtitle={selectedKycItem ? `${selectedKycItem.userId} · ${selectedKycItem.documentNumber}` : undefined}
          size="lg"
          className="max-w-3xl"
        >
          {selectedKycItem && (
            <div className="border border-[var(--gold)] bg-[var(--clay)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">{selectedKycItem.documentType.toUpperCase()} · {selectedKycItem.documentNumber}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">User: {selectedKycItem.userId} · Submitted: {new Date(selectedKycItem.createdAt).toLocaleString('en-NG')}</div>
                  <div className="mt-2 text-[10px] text-[var(--text2)]">Full Name: {workspace.users.find(user => user.id === selectedKycItem.userId)?.name || 'Unavailable'}</div>
                  <a href={selectedKycItem.documentUrl} target="_blank" rel="noreferrer" className="mt-2 block text-[10px] text-[var(--gold2)] break-all underline">
                    {selectedKycItem.documentName || selectedKycItem.documentUrl}
                  </a>
                </div>
                <div className={`border px-2.5 py-1 text-[8px] font-bold ${
                  selectedKycItem.status === 'approved'
                    ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]'
                    : selectedKycItem.status === 'rejected'
                      ? 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.1)] text-[var(--red2)]'
                      : 'border-[rgba(99,102,241,.3)] bg-[rgba(79,70,229,.1)] text-[var(--gold2)]'
                }`}>
                  {selectedKycItem.status.toUpperCase()}
                </div>
              </div>
              <textarea
                value={reviewNotes[selectedKycItem.id] ?? selectedKycItem.notes ?? ''}
                onChange={event => setReviewNotes(current => ({ ...current, [selectedKycItem.id]: event.target.value }))}
                className="mt-3 min-h-20 w-full border border-[var(--border)] bg-[var(--coal)] p-3 text-[10px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
                placeholder="Review note"
              />
              <div className="mt-3 flex gap-2">
                <Button onClick={() => void reviewKyc(selectedKycItem.id, 'approved')} disabled={reviewingId === selectedKycItem.id}>Approve</Button>
                <Button variant="danger" onClick={() => void reviewKyc(selectedKycItem.id, 'rejected')} disabled={reviewingId === selectedKycItem.id}>Reject</Button>
              </div>
            </div>
          )}
        </Modal>
      </Card>}

      {(showAccounts || showAudit) && <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        {showAccounts && <Card className="p-5">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">User Access Control</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {users.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)]">No users available.</div>
            ) : users.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedAccountId(item.id)}
                className={`border p-4 text-left transition-all ${
                  selectedAccountId === item.id
                    ? 'border-[var(--gold)] bg-[rgba(202,165,96,.08)]'
                    : 'border-[var(--border)] bg-[var(--clay)] hover:border-[var(--border2)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-bold text-[var(--text)]">{item.name}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.email}</div>
                    <div className="mt-2 text-[10px] text-[var(--text2)]">{item.accountStatus.toUpperCase()} · {item.kycStatus.toUpperCase()}</div>
                  </div>
                  <span className={`border px-2 py-1 text-[8px] font-bold uppercase tracking-[.8px] ${item.accountStatus === 'active' ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]' : 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]'}`}>
                    {item.accountStatus === 'active' ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="mt-3 text-[10px] text-[var(--gold2)]">Open Account Actions</div>
              </button>
            ))}
          </div>
          <Modal
            open={Boolean(selectedAccount)}
            onClose={() => setSelectedAccountId(null)}
            title={selectedAccount ? selectedAccount.name : 'User Access'}
            subtitle={selectedAccount ? selectedAccount.email : undefined}
            size="lg"
            className="max-w-3xl"
          >
            {selectedAccount && (
              <div className="border border-[var(--gold)] bg-[var(--clay)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[12px] font-bold text-[var(--text)]">{selectedAccount.name}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{selectedAccount.email}</div>
                    <div className="mt-2 text-[10px] text-[var(--text2)]">
                      {selectedAccount.accountStatus.toUpperCase()} · {selectedAccount.kycStatus.toUpperCase()} · Tier {selectedAccount.tier || 'basic'}
                    </div>
                  </div>
                  <div className={`border px-2.5 py-1 text-[8px] font-bold ${
                    selectedAccount.accountStatus === 'active'
                      ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]'
                      : 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.1)] text-[var(--gold2)]'
                  }`}>
                    {selectedAccount.accountStatus.toUpperCase()}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="border border-[var(--border)] bg-[var(--coal)] px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Phone</div>
                    <div className="mt-1 text-[11px] text-[var(--text)]">{selectedAccount.phone || 'Unavailable'}</div>
                  </div>
                  <div className="border border-[var(--border)] bg-[var(--coal)] px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Handle</div>
                    <div className="mt-1 text-[11px] text-[var(--text)]">{selectedAccount.handle || 'Unavailable'}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant={selectedAccount.accountStatus === 'active' ? 'danger' : 'primary'}
                    onClick={() => void updateUserStatus(selectedAccount.id, selectedAccount.accountStatus === 'active' ? 'deactivated' : 'active')}
                    disabled={updatingUserId === selectedAccount.id}
                  >
                    {updatingUserId === selectedAccount.id ? 'Updating…' : selectedAccount.accountStatus === 'active' ? 'Deactivate Account' : 'Reactivate Account'}
                  </Button>
                </div>
              </div>
            )}
          </Modal>
        </Card>}

        {showAudit && <Card className="p-5">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Audit Trail</div>
          <div className="space-y-3">
            {auditLogs.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)]">No audit events recorded yet.</div>
            ) : auditLogs.map(item => (
              <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                <div className="text-[11px] font-bold text-[var(--text)]">{item.action}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  Entity: {item.entityType} · {item.entityId}
                </div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  User: {item.userId ?? 'n/a'} · Actor: {item.actorUserId ?? 'system'}
                </div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString('en-NG')}</div>
              </div>
            ))}
          </div>
        </Card>}
      </div>}
    </>
  )
}
