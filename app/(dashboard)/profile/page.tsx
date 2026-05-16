'use client'
import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store'
export default function ProfilePage() {
  const { refreshSession, showToast, user, wallet } = useAppStore()
  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [editingProfile, setEditingProfile] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(user?.name ?? '')
    setPhone(user?.phone ?? '')
  }, [user?.name, user?.phone])

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
    <div className="max-w-3xl">
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
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold text-[var(--text)]">Edit Profile</div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                Update your name and phone only when needed.
              </div>
            </div>
            <Button
              size="sm"
              variant={editingProfile ? 'secondary' : 'primary'}
              onClick={() => setEditingProfile(current => !current)}
            >
              {editingProfile ? 'Close' : 'Edit'}
            </Button>
          </div>

          {editingProfile ? (
            <>
              <div className="mt-5 space-y-4">
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
            </>
          ) : null}
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          {[
            { icon: '👤', title: 'Personal Profile', sub: `${user?.email || 'No email on file'} · ${user?.phone || 'No phone'}` },
            { icon: '🔐', title: 'Security & PIN', sub: 'Manage password, sessions, and account access' },
            { icon: '✅', title: 'Verification Status', sub: kycCopy.headline },
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

      </div>

    </div>
  )
}
