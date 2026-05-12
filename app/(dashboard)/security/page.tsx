'use client'
import { useState } from 'react'
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store'

export default function SecurityPage() {
  const { currentSessionToken, fundingAccountEligibility, logout, refreshSession, securitySettings, sessions, showToast, user } = useAppStore()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [revokingToken, setRevokingToken] = useState<string | null>(null)
  const [revokingOthers, setRevokingOthers] = useState(false)
  const [updatingSetting, setUpdatingSetting] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState(false)

  const activeSessions = sessions.map(session => ({
    id: session.token,
    icon: session.token === currentSessionToken ? '💻' : '📱',
    device: session.userAgent?.split(' ').slice(0, 4).join(' ') || 'Browser session',
    info: `${session.token === currentSessionToken ? 'Current session' : 'Signed in'} · ${new Date(session.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
    current: session.token === currentSessionToken,
  }))

  async function updateSetting(key: 'transactionPinEnabled' | 'twoFactorEnabled' | 'biometricEnabled', value: boolean) {
    setUpdatingSetting(key)
    try {
      const response = await fetch('/api/security/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: value }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Security settings update failed.')
      }

      await refreshSession()
      showToast('Security settings updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Security settings update failed.', 'error')
    } finally {
      setUpdatingSetting(null)
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast('Fill in all password fields.', 'error')
      return
    }

    if (newPassword !== confirmPassword) {
      showToast('New password confirmation does not match.', 'error')
      return
    }

    setSavingPassword(true)
    try {
      const response = await fetch('/api/security/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Password update failed.')
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await refreshSession()
      showToast('Password updated successfully.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Password update failed.', 'error')
    } finally {
      setSavingPassword(false)
    }
  }

  async function revokeSession(token: string) {
    setRevokingToken(token)
    try {
      const response = await fetch(`/api/security/sessions/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Session revoke failed.')
      }

      await refreshSession()
      showToast('Session revoked.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Session revoke failed.', 'error')
    } finally {
      setRevokingToken(null)
    }
  }

  async function revokeOtherSessions() {
    setRevokingOthers(true)
    try {
      const response = await fetch('/api/security/sessions/others', {
        method: 'DELETE',
        credentials: 'include',
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Other session revoke failed.')
      }

      await refreshSession()
      showToast(payload.data?.revokedCount > 0 ? 'Other sessions revoked.' : 'No other active sessions found.', 'info')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Other session revoke failed.', 'error')
    } finally {
      setRevokingOthers(false)
    }
  }

  async function deactivateAccount() {
    setDeactivating(true)
    try {
      const response = await fetch('/api/account/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status: 'deactivated',
          reason: 'User deactivated account from security settings.',
        }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Account deactivation failed.')
      }

      await logout()
      showToast('Account deactivated. Contact support or an administrator to reactivate it.', 'info')
      window.location.href = '/login'
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Account deactivation failed.', 'error')
      setDeactivating(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div>
        <Card className="mb-4">
          <CardHeader><CardTitle>Authentication</CardTitle></CardHeader>
          {[
            {
              key: 'transactionPinEnabled',
              label: 'Transaction PIN',
              sub: '4-digit PIN for all transfers',
              enabled: securitySettings?.transactionPinEnabled ?? false,
            },
            {
              key: 'twoFactorEnabled',
              label: 'Two-Factor Auth (2FA)',
              sub: 'Extra layer via SMS or Authenticator',
              enabled: securitySettings?.twoFactorEnabled ?? false,
            },
            {
              key: 'biometricEnabled',
              label: 'Biometric Login',
              sub: 'Fingerprint / Face ID',
              enabled: securitySettings?.biometricEnabled ?? false,
            },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 last:border-0">
              <div>
                <div className="text-[13px] font-semibold text-[var(--text)]">{item.label}</div>
                <div className="mt-0.5 text-[9px] text-[var(--muted)]">{item.sub}</div>
              </div>
              <button
                onClick={() => void updateSetting(item.key as 'transactionPinEnabled' | 'twoFactorEnabled' | 'biometricEnabled', !item.enabled)}
                disabled={updatingSetting === item.key}
                className={`border px-2.5 py-1 text-[8px] font-bold ${
                  item.enabled
                    ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]'
                    : 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.1)] text-[var(--red2)]'
                } disabled:opacity-50`}
              >
                {updatingSetting === item.key ? 'UPDATING…' : item.enabled ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>
          ))}
        </Card>

        <Card className="p-6">
          <div className="mb-4 text-[11px] font-bold text-[var(--text)]">Change Password</div>
          <div className="space-y-4">
            <Input label="Current Password" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
            <Input label="New Password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} />
            <Input label="Confirm New Password" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
          </div>
          <div className="mt-5">
            <Button className="w-full py-3" onClick={changePassword} disabled={savingPassword}>
              {savingPassword ? 'Updating…' : 'Update Password'}
            </Button>
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Active Sessions</CardTitle>
            <CardAction>
              <div className="flex items-center gap-2">
                <span>{sessions.length} session(s)</span>
                {sessions.length > 1 && (
                  <Button variant="secondary" size="sm" onClick={revokeOtherSessions} disabled={revokingOthers}>
                    {revokingOthers ? 'Signing out…' : 'Log Out Others'}
                  </Button>
                )}
              </div>
            </CardAction>
          </CardHeader>
          {activeSessions.map(session => (
            <div key={session.id} className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4 last:border-0">
              <span className="text-lg">{session.icon}</span>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[var(--text)]">{session.device}</div>
                <div className="mt-0.5 text-[9px] text-[var(--muted)]">{session.info}</div>
              </div>
              {session.current ? (
                <span className="border border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] px-2.5 py-1 text-[8px] font-bold text-[var(--green2)]">ACTIVE</span>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => revokeSession(session.id)} disabled={revokingToken === session.id}>
                  {revokingToken === session.id ? 'Revoking…' : 'Revoke'}
                </Button>
              )}
            </div>
          ))}
        </Card>
      </div>

      <div>
        <Card className="mb-4">
          <CardHeader><CardTitle>Transaction Limits</CardTitle></CardHeader>
          <div className="p-5">
            {[
              { label: 'Daily Transfers', val: user?.tier === 'verified' ? '₦250,000 / ₦1,000,000' : '₦50,000 / ₦500,000', pct: user?.tier === 'verified' ? 25 : 10, color: 'var(--gold)' },
              { label: 'P2P Deposits', val: user?.kycStatus === 'verified' ? '₦100,000 / ₦2,000,000' : '₦25,000 / ₦1,000,000', pct: user?.kycStatus === 'verified' ? 5 : 2.5, color: 'var(--green)' },
              { label: 'Crypto Volume', val: user?.kycStatus === 'verified' ? '₦150,000 / ₦1,000,000' : '₦76,000 / ₦500,000', pct: user?.kycStatus === 'verified' ? 15 : 7.6, color: 'var(--purple)' },
            ].map(limit => (
              <div key={limit.label} className="mb-5 last:mb-0">
                <div className="mb-1.5 flex justify-between text-[11px]"><span className="text-[var(--muted)]">{limit.label}</span><span className="font-bold text-[var(--text)]">{limit.val}</span></div>
                <div className="h-1.5 border border-[var(--border)] bg-[var(--clay2)]">
                  <div className="h-full" style={{ width: `${limit.pct}%`, background: limit.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5">
            <div className="mb-3 text-[10px] text-[var(--muted)]">Complete KYC to unlock higher limits</div>
            <Button size="sm" onClick={() => { window.location.href = '/kyc' }}>Upload ID →</Button>
          </div>
        </Card>

        <Card className="mb-4">
          <CardHeader><CardTitle>Funding Account Access</CardTitle></CardHeader>
          <div className="p-5">
            <div className={`border p-4 text-[11px] ${
              fundingAccountEligibility.eligible || fundingAccountEligibility.hasPermanentAccount
                ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)]'
                : 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)]'
            }`}>
              <div className="font-bold text-[var(--text)]">
                {fundingAccountEligibility.hasPermanentAccount
                  ? 'Permanent account active'
                  : fundingAccountEligibility.eligible
                    ? 'Ready for permanent funding account'
                    : 'Permanent account locked'}
              </div>
              <div className="mt-1 text-[var(--text2)]">{fundingAccountEligibility.message}</div>
              {fundingAccountEligibility.identityType && (
                <div className="mt-2 text-[10px] text-[var(--muted)]">Required identity: {fundingAccountEligibility.identityType.toUpperCase()}</div>
              )}
            </div>
            {!fundingAccountEligibility.eligible && !fundingAccountEligibility.hasPermanentAccount && (
              <div className="mt-3">
                <Button size="sm" onClick={() => { window.location.href = '/kyc' }}>Go To BVN/NIN KYC →</Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="border-[rgba(196,52,26,.2)] bg-[rgba(196,52,26,.02)] p-5">
          <div className="mb-3 text-[11px] font-bold text-[var(--red2)]">Danger Zone</div>
          <div className="flex flex-col gap-2">
            <Button variant="danger" className="w-full py-2.5 text-[11px]" onClick={deactivateAccount} disabled={deactivating || user?.accountStatus === 'deactivated'}>
              {deactivating ? 'Deactivating…' : user?.accountStatus === 'deactivated' ? 'Account Deactivated' : 'Deactivate Account'}
            </Button>
            <Button variant="danger" className="w-full py-2.5 text-[11px] opacity-70" onClick={() => showToast('Permanent deletion remains an admin/support-only workflow.', 'info')}>
              Delete Account Permanently
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
