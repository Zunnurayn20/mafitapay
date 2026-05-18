'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { canUseBiometrics, enrollBiometricCredential } from '@/lib/client/biometric'
import { useAppStore } from '@/store'

interface BiometricCredentialItem {
  id: string
  credentialId: string
  label?: string
  createdAt: string
  lastUsedAt?: string
}

export default function SecurityPage() {
  const { currentSessionToken, logout, refreshSession, securitySettings, sessions, showToast, user } = useAppStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const setupMode = searchParams.get('setup') === '1'
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [managingPin, setManagingPin] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingPin, setSavingPin] = useState(false)
  const [disablingPin, setDisablingPin] = useState(false)
  const [managingBiometric, setManagingBiometric] = useState(false)
  const [biometricSupported, setBiometricSupported] = useState(false)
  const [loadingBiometricSupport, setLoadingBiometricSupport] = useState(true)
  const [loadingBiometricCredentials, setLoadingBiometricCredentials] = useState(false)
  const [savingBiometric, setSavingBiometric] = useState(false)
  const [removingBiometricId, setRemovingBiometricId] = useState<string | null>(null)
  const [biometricCredentials, setBiometricCredentials] = useState<BiometricCredentialItem[]>([])
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

  useEffect(() => {
    void (async () => {
      try {
        setBiometricSupported(await canUseBiometrics())
      } finally {
        setLoadingBiometricSupport(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!managingBiometric) return
    void loadBiometricCredentials()
  }, [managingBiometric])

  useEffect(() => {
    if (!setupMode) return
    if (securitySettings?.hasTransactionPin !== true) {
      setManagingPin(true)
    }
    if (securitySettings?.hasBiometricCredential !== true) {
      setManagingBiometric(true)
    }
  }, [securitySettings?.hasBiometricCredential, securitySettings?.hasTransactionPin, setupMode])

  async function updateSetting(key: 'twoFactorEnabled' | 'biometricEnabled', value: boolean) {
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

  async function loadBiometricCredentials() {
    setLoadingBiometricCredentials(true)
    try {
      const response = await fetch('/api/security/biometric', {
        credentials: 'include',
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Biometric devices could not be loaded.')
      }
      setBiometricCredentials(Array.isArray(payload.data?.credentials) ? payload.data.credentials : [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Biometric devices could not be loaded.', 'error')
    } finally {
      setLoadingBiometricCredentials(false)
    }
  }

  async function toggleBiometricEnabled(value: boolean) {
    setUpdatingSetting('biometricEnabled')
    try {
      const response = await fetch('/api/security/biometric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ intent: 'toggle', enabled: value }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Biometric setting update failed.')
      }
      await refreshSession()
      showToast(value ? 'Biometric approval enabled.' : 'Biometric approval disabled.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Biometric setting update failed.', 'error')
    } finally {
      setUpdatingSetting(null)
    }
  }

  async function registerBiometric() {
    setSavingBiometric(true)
    try {
      await enrollBiometricCredential()
      await refreshSession()
      await loadBiometricCredentials()
      showToast('Biometric approval is ready on this device.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Biometric enrollment failed.', 'error')
    } finally {
      setSavingBiometric(false)
    }
  }

  async function removeBiometricCredentialById(credentialId: string) {
    setRemovingBiometricId(credentialId)
    try {
      const response = await fetch('/api/security/biometric', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credentialId }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Biometric device removal failed.')
      }
      setBiometricCredentials(Array.isArray(payload.data?.credentials) ? payload.data.credentials : [])
      await refreshSession()
      showToast('Biometric device removed.', 'info')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Biometric device removal failed.', 'error')
    } finally {
      setRemovingBiometricId(null)
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

  async function saveTransactionPin() {
    if (!newPin || !confirmPin) {
      showToast('Fill in all PIN fields.', 'error')
      return
    }
    if (newPin !== confirmPin) {
      showToast('PIN confirmation does not match.', 'error')
      return
    }
    if (!/^\d{4}$/.test(newPin)) {
      showToast('Transaction PIN must be exactly 4 digits.', 'error')
      return
    }
    if (securitySettings?.hasTransactionPin && !currentPin) {
      showToast('Current transaction PIN is required.', 'error')
      return
    }

    setSavingPin(true)
    try {
      const response = await fetch('/api/security/transaction-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPin: currentPin || undefined,
          newPin,
        }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Transaction PIN update failed.')
      }
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      setManagingPin(false)
      await refreshSession()
      showToast(securitySettings?.hasTransactionPin ? 'Transaction PIN updated.' : 'Transaction PIN created.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Transaction PIN update failed.', 'error')
    } finally {
      setSavingPin(false)
    }
  }

  async function removeTransactionPin() {
    if (!currentPin) {
      showToast('Current transaction PIN is required.', 'error')
      return
    }
    setDisablingPin(true)
    try {
      const response = await fetch('/api/security/transaction-pin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPin }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Transaction PIN disable failed.')
      }
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      setManagingPin(false)
      await refreshSession()
      showToast('Transaction PIN removed.', 'info')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Transaction PIN disable failed.', 'error')
    } finally {
      setDisablingPin(false)
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

  const setupNeedsPin = securitySettings?.hasTransactionPin !== true
  const setupNeedsBiometric = biometricSupported && securitySettings?.hasBiometricCredential !== true
  const setupComplete = !setupNeedsPin && !setupNeedsBiometric

  return (
    <div className="max-w-3xl">
      <div>
        {setupMode ? (
          <Card className="mb-4 border-[rgba(202,165,96,.28)] bg-[rgba(202,165,96,.08)] p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--gold2)]">Security Setup Required</div>
            <div className="mt-2 text-[12px] text-[var(--text2)]">
              Finish your transaction PIN{biometricSupported ? ' and biometric approval' : ''} before using the platform.
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold">
              <span className={`border px-2.5 py-1 ${setupNeedsPin ? 'border-[rgba(196,52,26,.2)] bg-[rgba(196,52,26,.08)] text-[var(--red2)]' : 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]'}`}>
                PIN {setupNeedsPin ? 'Pending' : 'Ready'}
              </span>
              {biometricSupported ? (
                <span className={`border px-2.5 py-1 ${setupNeedsBiometric ? 'border-[rgba(196,52,26,.2)] bg-[rgba(196,52,26,.08)] text-[var(--red2)]' : 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]'}`}>
                  Biometrics {setupNeedsBiometric ? 'Pending' : 'Ready'}
                </span>
              ) : (
                <span className="border border-[var(--border)] bg-[var(--clay)] px-2.5 py-1 text-[var(--muted)]">
                  Biometrics not available on this device
                </span>
              )}
            </div>
            {setupComplete ? (
              <div className="mt-4">
                <Button className="w-full py-3" onClick={() => router.push('/dashboard')}>
                  Continue to Dashboard
                </Button>
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card className="mb-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold text-[var(--text)]">Transaction PIN</div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                {securitySettings?.hasTransactionPin
                  ? 'Protects transfers, withdrawals, bill payments, and in-app crypto execution.'
                  : 'Set a 4-digit PIN for sensitive transactions.'}
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--gold2)]">
                {securitySettings?.hasTransactionPin ? 'Configured' : 'Not set'}
              </div>
            </div>
            <Button
              size="sm"
              variant={managingPin ? 'secondary' : 'primary'}
              onClick={() => setManagingPin(current => !current)}
            >
              {managingPin ? 'Close' : securitySettings?.hasTransactionPin ? 'Manage' : 'Set Up'}
            </Button>
          </div>

          {managingPin ? (
            <>
              <div className="mt-5 space-y-4">
                {securitySettings?.hasTransactionPin ? (
                  <Input
                    label="Current PIN"
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={currentPin}
                    onChange={event => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                ) : null}
                <Input
                  label={securitySettings?.hasTransactionPin ? 'New PIN' : 'Transaction PIN'}
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPin}
                  onChange={event => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                />
                <Input
                  label="Confirm PIN"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={event => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </div>
              <div className="mt-5 flex gap-3">
                {securitySettings?.hasTransactionPin ? (
                  <Button variant="secondary" className="flex-1 py-3" onClick={removeTransactionPin} disabled={disablingPin || savingPin}>
                    {disablingPin ? 'Removing…' : 'Remove PIN'}
                  </Button>
                ) : null}
                <Button className="flex-1 py-3" onClick={saveTransactionPin} disabled={savingPin || disablingPin}>
                  {savingPin ? 'Saving…' : securitySettings?.hasTransactionPin ? 'Update PIN' : 'Create PIN'}
                </Button>
              </div>
            </>
          ) : null}
        </Card>

        <Card className="mb-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold text-[var(--text)]">Biometric Approval</div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                Use Face ID, fingerprint, or passkey as a real WebAuthn approval path for sensitive transactions.
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--gold2)]">
                {securitySettings?.hasBiometricCredential ? 'Configured' : 'Not set'}
              </div>
            </div>
            <Button
              size="sm"
              variant={managingBiometric ? 'secondary' : 'primary'}
              onClick={() => setManagingBiometric(current => !current)}
            >
              {managingBiometric ? 'Close' : securitySettings?.hasBiometricCredential ? 'Manage' : 'Set Up'}
            </Button>
          </div>

          {managingBiometric ? (
            <>
              <div className="mt-5 rounded border border-[var(--border)] bg-[var(--clay)] p-4 text-[10px] text-[var(--text2)]">
                {loadingBiometricSupport
                  ? 'Checking device support…'
                  : biometricSupported
                    ? 'This device supports platform biometrics. You can enroll the current device and use it instead of typing your transaction PIN.'
                    : 'This browser/device does not expose a platform authenticator. Use transaction PIN on this device.'}
              </div>

              {securitySettings?.hasBiometricCredential ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded border border-[var(--border)] bg-[var(--clay)] px-4 py-3">
                  <div>
                    <div className="text-[11px] font-bold text-[var(--text)]">Approval Status</div>
                    <div className="mt-1 text-[9px] text-[var(--muted)]">
                      {securitySettings.biometricEnabled
                        ? `Enabled across ${securitySettings.biometricCredentialCount} enrolled device(s).`
                        : `Disabled, but ${securitySettings.biometricCredentialCount} device(s) remain enrolled.`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void toggleBiometricEnabled(!(securitySettings?.biometricEnabled ?? false))}
                    disabled={updatingSetting === 'biometricEnabled'}
                  >
                    {updatingSetting === 'biometricEnabled'
                      ? 'Saving…'
                      : securitySettings?.biometricEnabled
                        ? 'Disable'
                        : 'Enable'}
                  </Button>
                </div>
              ) : null}

              <div className="mt-4">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--muted)]">Enrolled Devices</div>
                {loadingBiometricCredentials ? (
                  <div className="rounded border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">Loading devices…</div>
                ) : biometricCredentials.length > 0 ? (
                  <div className="space-y-2">
                    {biometricCredentials.map(credential => (
                      <div key={credential.id} className="flex items-center justify-between gap-3 rounded border border-[var(--border)] bg-[var(--clay)] px-4 py-3">
                        <div>
                          <div className="text-[11px] font-semibold text-[var(--text)]">{credential.label || 'This device'}</div>
                          <div className="mt-1 text-[9px] text-[var(--muted)]">
                            {credential.lastUsedAt
                              ? `Last used ${new Date(credential.lastUsedAt).toLocaleString('en-NG')}`
                              : `Added ${new Date(credential.createdAt).toLocaleString('en-NG')}`}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void removeBiometricCredentialById(credential.credentialId)}
                          disabled={removingBiometricId === credential.id}
                        >
                          {removingBiometricId === credential.id ? 'Removing…' : 'Remove'}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">No biometric devices enrolled yet.</div>
                )}
              </div>

              <div className="mt-5">
                <Button
                  className="w-full py-3"
                  onClick={() => void registerBiometric()}
                  disabled={savingBiometric || !biometricSupported}
                >
                  {savingBiometric ? 'Enrolling…' : securitySettings?.hasBiometricCredential ? 'Add This Device' : 'Enroll This Device'}
                </Button>
              </div>
            </>
          ) : null}
        </Card>

        <Card className="mb-4">
          <CardHeader><CardTitle>Authentication</CardTitle></CardHeader>
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <div className="text-[13px] font-semibold text-[var(--text)]">Two-Factor Auth (2FA)</div>
              <div className="mt-0.5 text-[9px] text-[var(--muted)]">Extra layer via SMS or Authenticator</div>
            </div>
            <button
              onClick={() => void updateSetting('twoFactorEnabled', !(securitySettings?.twoFactorEnabled ?? false))}
              disabled={updatingSetting === 'twoFactorEnabled'}
              className={`border px-2.5 py-1 text-[8px] font-bold ${
                securitySettings?.twoFactorEnabled
                  ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]'
                  : 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.1)] text-[var(--red2)]'
              } disabled:opacity-50`}
            >
              {updatingSetting === 'twoFactorEnabled' ? 'UPDATING…' : securitySettings?.twoFactorEnabled ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold text-[var(--text)]">Change Password</div>
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                Open only when you need to update your login password.
              </div>
            </div>
            <Button
              size="sm"
              variant={changingPassword ? 'secondary' : 'primary'}
              onClick={() => setChangingPassword(current => !current)}
            >
              {changingPassword ? 'Close' : 'Change'}
            </Button>
          </div>

          {changingPassword ? (
            <>
              <div className="mt-5 space-y-4">
                <Input label="Current Password" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
                <Input label="New Password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} />
                <Input label="Confirm New Password" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
              </div>
              <div className="mt-5">
                <Button className="w-full py-3" onClick={changePassword} disabled={savingPassword}>
                  {savingPassword ? 'Updating…' : 'Update Password'}
                </Button>
              </div>
            </>
          ) : null}
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
        <Card className="mt-4 border-[rgba(196,52,26,.2)] bg-[rgba(196,52,26,.02)] p-5">
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
