'use client'
import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store'
import type { Beneficiary } from '@/types'

export default function ProfilePage() {
  const { fundingAccountEligibility, kycSubmission, refreshSession, showToast, user, wallet } = useAppStore()
  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [bankBeneficiaries, setBankBeneficiaries] = useState<Beneficiary[]>([])
  const [internalBeneficiaries, setInternalBeneficiaries] = useState<Beneficiary[]>([])
  const [archivedBeneficiaries, setArchivedBeneficiaries] = useState<Beneficiary[]>([])
  const [loadingBeneficiaries, setLoadingBeneficiaries] = useState(true)
  const [updatingBeneficiaryId, setUpdatingBeneficiaryId] = useState<string | null>(null)

  async function loadBeneficiaries() {
    const [bankItems, internalItems, archivedItems] = await Promise.all([
      fetch('/api/beneficiaries?kind=bank', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Failed to load bank beneficiaries.')
        }
        return Array.isArray(payload.data) ? payload.data : []
      }),
      fetch('/api/beneficiaries?kind=internal', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Failed to load internal beneficiaries.')
        }
        return Array.isArray(payload.data) ? payload.data : []
      }),
      fetch('/api/beneficiaries?includeArchived=true', { credentials: 'include', cache: 'no-store' }).then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Failed to load archived beneficiaries.')
        }
        return Array.isArray(payload.data) ? payload.data.filter((item: Beneficiary) => item.archivedAt) : []
      }),
    ])

    setBankBeneficiaries(bankItems)
    setInternalBeneficiaries(internalItems)
    setArchivedBeneficiaries(archivedItems)
  }

  useEffect(() => {
    setName(user?.name ?? '')
    setPhone(user?.phone ?? '')
  }, [user?.name, user?.phone])

  useEffect(() => {
    let active = true

    void loadBeneficiaries()
      .then(() => {
        if (!active) return
      })
      .catch(error => {
        if (!active) return
        showToast(error instanceof Error ? error.message : 'Failed to load beneficiaries.', 'error')
      })
      .finally(() => {
        if (active) setLoadingBeneficiaries(false)
      })

    return () => {
      active = false
    }
  }, [showToast])

  async function updateBeneficiary(id: string, action: 'set_default' | 'archive' | 'restore' | 'delete') {
    setUpdatingBeneficiaryId(id)
    try {
      const response = await fetch(`/api/beneficiaries/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Beneficiary update failed.')
      }
      await loadBeneficiaries()
      showToast(
        action === 'set_default'
          ? 'Default beneficiary updated.'
          : action === 'archive'
            ? 'Beneficiary archived.'
            : action === 'restore'
              ? 'Beneficiary restored.'
              : 'Beneficiary deleted.'
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Beneficiary update failed.', 'error')
    } finally {
      setUpdatingBeneficiaryId(null)
    }
  }

  const initial = user?.name?.trim().charAt(0).toUpperCase() || 'A'
  const virtualAccounts = (wallet?.virtualAccounts ?? []).filter(item => (item.provider === 'flutterwave' || item.provider === 'cngn') && item.isPermanent)
  const kycCopy = user?.kycStatus === 'verified'
    ? {
        badge: 'KYC VERIFIED',
        badgeClass: 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]',
        headline: 'Verification complete',
        body: 'Your account has full access to supported wallet and transfer limits.',
      }
    : user?.kycStatus === 'rejected'
      ? {
          badge: 'KYC REJECTED',
          badgeClass: 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.1)] text-[var(--red2)]',
          headline: 'Verification requires attention',
          body: 'Your last verification attempt was rejected. Upload a valid government ID to continue.',
        }
      : {
          badge: 'KYC PENDING',
          badgeClass: 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.1)] text-[var(--red2)]',
          headline: 'Verification required',
          body: 'Upload a valid government ID to unlock higher transaction limits and full P2P access.',
        }

  async function saveProfile() {
    if (!name.trim() || !phone.trim()) {
      showToast('Name and phone are required.', 'error')
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, phone }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Profile update failed.')
      }

      await refreshSession()
      showToast('Profile updated successfully.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Profile update failed.', 'error')
    } finally {
      setSaving(false)
    }
  }


  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div>
        <Card className="mb-4">
          <div className="flex items-center gap-5 p-6">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full border-2 border-[var(--gold)] bg-[var(--clay2)] font-display text-2xl font-black text-[var(--gold)]">{initial}</div>
            <div>
              <div className="font-display text-[20px] font-black text-[var(--text)]">{user?.name || 'MafitaPay User'}</div>
              <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{user?.email || 'No email on file'}</div>
              <div className="mt-2 flex gap-2">
                <span className="border border-[rgba(99,102,241,.3)] bg-[rgba(79,70,229,.1)] px-2.5 py-1 text-[8px] font-bold tracking-wide text-[var(--gold2)]">REF: {user?.referralCode || 'MAFAT2912'}</span>
                <span className={`border px-2.5 py-1 text-[8px] font-bold tracking-wide ${kycCopy.badgeClass}`}>{kycCopy.badge}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 text-[11px] font-bold text-[var(--text)]">Edit Profile</div>
          <div className="space-y-4">
            <Input label="Full Name" value={name} onChange={event => setName(event.target.value)} />
            <Input label="Phone Number" value={phone} onChange={event => setPhone(event.target.value)} />
            <Input label="Email Address" value={user?.email || ''} readOnly disabled />
            <Input label="Public Handle" value={user?.handle || ''} readOnly disabled />
          </div>
          <div className="mt-5">
            <Button className="w-full py-3" onClick={saveProfile} disabled={saving}>
              {saving ? 'Saving…' : 'Save Profile'}
            </Button>
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          {[
            { icon: '👤', title: 'Personal Profile', sub: `${user?.phone || 'No phone'} · ${user?.handle || '@mafitapay'}` },
            { icon: '🔐', title: 'Security & PIN', sub: `Tier: ${user?.tier || 'basic'} · Status: ${user?.kycStatus || 'pending'}` },
            { icon: '🏦', title: 'Virtual Accounts', sub: virtualAccounts.length > 0 ? virtualAccounts.map(item => item.bank).join(' · ') : 'No virtual account assigned yet' },
          ].map(item => (
            <div key={item.title} className="flex items-center gap-4 border-b border-[var(--border)] px-5 py-4 last:border-0">
              <span className="text-lg">{item.icon}</span>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[var(--text)]">{item.title}</div>
                <div className="mt-0.5 text-[9px] text-[var(--muted)]">{item.sub}</div>
              </div>
            </div>
          ))}
        </Card>

        <Card className="mt-4 p-6">
          <div className="mb-3 text-[11px] font-bold text-[var(--text)]">Funding Account Eligibility</div>
          <div className={`border p-4 text-[11px] ${
            fundingAccountEligibility.eligible || fundingAccountEligibility.hasPermanentAccount
              ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)]'
              : 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)]'
          }`}>
            <div className="font-bold text-[var(--text)]">
              {fundingAccountEligibility.hasPermanentAccount
                ? 'Permanent account assigned'
                : fundingAccountEligibility.eligible
                  ? 'Eligible for permanent account creation'
                  : 'Not eligible yet'}
            </div>
            <div className="mt-1 text-[var(--text2)]">{fundingAccountEligibility.message}</div>
            {fundingAccountEligibility.identityType && (
              <div className="mt-2 text-[10px] text-[var(--muted)]">Identity type: {fundingAccountEligibility.identityType.toUpperCase()}</div>
            )}
            {!fundingAccountEligibility.eligible && !fundingAccountEligibility.hasPermanentAccount && (
              <div className="mt-3">
                <Button size="sm" onClick={() => { window.location.href = '/kyc' }}>Go To BVN/NIN KYC →</Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="mt-4 p-6">
          <div className="mb-4 text-[11px] font-bold text-[var(--text)]">Saved Beneficiaries</div>
          {loadingBeneficiaries ? (
            <div className="text-[11px] text-[var(--muted)]">Loading beneficiary records…</div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Internal Transfers</div>
                <div className="space-y-2">
                  {internalBeneficiaries.length === 0 ? (
                    <div className="text-[11px] text-[var(--muted)]">No saved internal recipients yet.</div>
                  ) : internalBeneficiaries.map(item => (
                    <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-bold text-[var(--text)]">{item.label}</div>
                          {item.isDefault && <div className="mt-1 text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Default recipient</div>}
                        </div>
                        <div className="flex gap-2">
                          {!item.isDefault && (
                            <button
                              onClick={() => void updateBeneficiary(item.id, 'set_default')}
                              disabled={updatingBeneficiaryId === item.id}
                              className="border border-[var(--border)] px-2 py-1 text-[9px] font-bold text-[var(--text2)] disabled:opacity-50"
                            >
                              Default
                            </button>
                          )}
                          <button
                            onClick={() => void updateBeneficiary(item.id, 'archive')}
                            disabled={updatingBeneficiaryId === item.id}
                            className="border border-[rgba(196,52,26,.35)] px-2 py-1 text-[9px] font-bold text-[var(--red2)] disabled:opacity-50"
                          >
                            Archive
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        {item.handle ? `@${item.handle}` : 'Handle unavailable'}
                        {item.lastUsedAt ? ` · Last used ${new Date(item.lastUsedAt).toLocaleString('en-NG')}` : ''}
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        Source: {item.verificationProvider || 'internal_directory'} · {item.verificationStatus || 'verified'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Bank Beneficiaries</div>
                <div className="space-y-2">
                  {bankBeneficiaries.length === 0 ? (
                    <div className="text-[11px] text-[var(--muted)]">No saved bank beneficiaries yet.</div>
                  ) : bankBeneficiaries.map(item => (
                    <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-bold text-[var(--text)]">{item.accountName || item.label}</div>
                          {item.isDefault && <div className="mt-1 text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Default bank payout</div>}
                        </div>
                        <div className="flex gap-2">
                          {!item.isDefault && (
                            <button
                              onClick={() => void updateBeneficiary(item.id, 'set_default')}
                              disabled={updatingBeneficiaryId === item.id}
                              className="border border-[var(--border)] px-2 py-1 text-[9px] font-bold text-[var(--text2)] disabled:opacity-50"
                            >
                              Default
                            </button>
                          )}
                          <button
                            onClick={() => void updateBeneficiary(item.id, 'archive')}
                            disabled={updatingBeneficiaryId === item.id}
                            className="border border-[rgba(196,52,26,.35)] px-2 py-1 text-[9px] font-bold text-[var(--red2)] disabled:opacity-50"
                          >
                            Archive
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        {item.bankName || 'Bank unavailable'}{item.bankCode ? ` (${item.bankCode})` : ''} · {item.accountNumber || 'Account unavailable'}
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        {item.verifiedAt
                          ? `Validated ${new Date(item.verifiedAt).toLocaleString('en-NG')}`
                          : 'Saved without validation timestamp'}
                        {item.lastUsedAt ? ` · Last used ${new Date(item.lastUsedAt).toLocaleString('en-NG')}` : ''}
                      </div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        Verification source: {item.verificationProvider || 'local_validation'} · {item.verificationStatus || 'verified'}
                        {item.verificationReference ? ` · Ref ${item.verificationReference}` : ''}
                      </div>
                      {item.verificationReason && (
                        <div className="mt-1 text-[10px] text-[var(--muted)]">{item.verificationReason}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="mt-4 p-6">
          <div className="mb-4 text-[11px] font-bold text-[var(--text)]">Archived Beneficiaries</div>
          {loadingBeneficiaries ? (
            <div className="text-[11px] text-[var(--muted)]">Loading archived records…</div>
          ) : archivedBeneficiaries.length === 0 ? (
            <div className="text-[11px] text-[var(--muted)]">No archived beneficiaries.</div>
          ) : (
            <div className="space-y-2">
              {archivedBeneficiaries.map(item => (
                <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold text-[var(--text)]">{item.label}</div>
                      <div className="mt-1 text-[10px] text-[var(--muted)]">
                        {item.kind.toUpperCase()} · Archived {item.archivedAt ? new Date(item.archivedAt).toLocaleString('en-NG') : 'recently'}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void updateBeneficiary(item.id, 'restore')}
                        disabled={updatingBeneficiaryId === item.id}
                        className="border border-[var(--border)] px-2 py-1 text-[9px] font-bold text-[var(--text2)] disabled:opacity-50"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => void updateBeneficiary(item.id, 'delete')}
                        disabled={updatingBeneficiaryId === item.id}
                        className="border border-[rgba(196,52,26,.35)] px-2 py-1 text-[9px] font-bold text-[var(--red2)] disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div>
        <Card className="p-6">
          <div className="mb-4 text-[11px] font-bold text-[var(--text)]">KYC Verification</div>
          <div className="border border-[rgba(196,52,26,.18)] border-l-4 border-l-[var(--red2)] bg-[rgba(196,52,26,.06)] p-4">
            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--red2)]">{kycCopy.headline}</div>
            <div className="text-[11px] leading-relaxed text-[var(--text2)]">{kycCopy.body}</div>
            <div className="mt-2 text-[10px] text-[var(--text2)]">Open the dedicated KYC page to upload documents, track review status, and unlock higher limits.</div>
            <div className="mt-4">
              <Button className="w-full py-3" onClick={() => { window.location.href = '/kyc' }}>
                Open KYC Workspace
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
