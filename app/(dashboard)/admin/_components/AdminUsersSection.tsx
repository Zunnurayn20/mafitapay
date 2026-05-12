'use client'

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { AdminSubmodule } from '../admin-config'
import type { AdminWorkspaceState } from '../useAdminWorkspace'

export function AdminUsersSection({ workspace, submodule }: { workspace: AdminWorkspaceState; submodule?: AdminSubmodule }) {
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
        <div className="space-y-4">
          {filteredKycItems.length === 0 ? (
            <div className="text-[11px] text-[var(--muted)]">No KYC submissions available.</div>
          ) : filteredKycItems.map(item => (
            <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">{item.documentType.toUpperCase()} · {item.documentNumber}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">User: {item.userId} · Submitted: {new Date(item.createdAt).toLocaleString('en-NG')}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    Funding impact: {item.documentType === 'bvn' || item.documentType === 'nin'
                      ? 'Approval unlocks permanent funding account eligibility.'
                      : 'Approval does not unlock permanent funding accounts.'}
                  </div>
                  <a href={item.documentUrl} target="_blank" rel="noreferrer" className="mt-1 block text-[10px] text-[var(--gold2)] break-all underline">
                    {item.documentName || item.documentUrl}
                  </a>
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
              <textarea
                value={reviewNotes[item.id] ?? item.notes ?? ''}
                onChange={event => setReviewNotes(current => ({ ...current, [item.id]: event.target.value }))}
                className="mt-3 min-h-20 w-full border border-[var(--border)] bg-[var(--coal)] p-3 text-[10px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
                placeholder="Review note"
              />
              <div className="mt-3 flex gap-2">
                <Button onClick={() => void reviewKyc(item.id, 'approved')} disabled={reviewingId === item.id}>Approve</Button>
                <Button variant="danger" onClick={() => void reviewKyc(item.id, 'rejected')} disabled={reviewingId === item.id}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>}

      {(showAccounts || showAudit) && <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        {showAccounts && <Card className="p-5">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">User Access Control</div>
          <div className="space-y-3">
            {users.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)]">No users available.</div>
            ) : users.map(item => (
              <div key={item.id} className="flex items-center justify-between gap-4 border border-[var(--border)] bg-[var(--clay)] p-4">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold text-[var(--text)]">{item.name}</div>
                  <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.email} · {item.accountStatus.toUpperCase()} · {item.kycStatus.toUpperCase()}</div>
                </div>
                <Button
                  variant={item.accountStatus === 'active' ? 'danger' : 'primary'}
                  size="sm"
                  onClick={() => void updateUserStatus(item.id, item.accountStatus === 'active' ? 'deactivated' : 'active')}
                  disabled={updatingUserId === item.id}
                >
                  {updatingUserId === item.id ? 'Updating…' : item.accountStatus === 'active' ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            ))}
          </div>
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
