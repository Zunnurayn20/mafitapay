'use client'

import { useCallback, useEffect, useState } from 'react'
import { Fingerprint, Smartphone } from 'lucide-react'
import { getDeviceLoginHint, forgetFingerprintLogin } from '@/lib/client/device-login'
import { useAppStore } from '@/store'

type Device = { id: string; deviceLabel: string; platform: 'android'; createdAt: string; lastUsedAt: string | null; expiresAt: string }

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never used'
}

export function DeviceLoginSettings() {
  const isAuthenticated = useAppStore(state => state.isAuthenticated)
  const showToast = useAppStore(state => state.showToast)
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const loadDevices = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/auth/device-login', { credentials: 'include', cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Could not load sign-in devices.')
      setDevices(Array.isArray(payload?.data) ? payload.data : [])
      setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load sign-in devices.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (isAuthenticated) void loadDevices() }, [isAuthenticated, loadDevices])

  async function revoke(id: string) {
    setBusyId(id)
    try {
      const response = await fetch('/api/auth/device-login', { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Could not remove this device.')
      if (getDeviceLoginHint()?.id === id) await forgetFingerprintLogin()
      setDevices(current => current.filter(device => device.id !== id))
      showToast('Fingerprint sign-in removed from this device.')
    } catch (caught) { showToast(caught instanceof Error ? caught.message : 'Could not remove this device.', 'error') }
    finally { setBusyId('') }
  }

  async function revokeAll() {
    setBusyId('all')
    try {
      const response = await fetch('/api/auth/device-login', { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Could not remove sign-in devices.')
      await forgetFingerprintLogin()
      setDevices([])
      showToast('Fingerprint sign-in removed from all devices.')
    } catch (caught) { showToast(caught instanceof Error ? caught.message : 'Could not remove sign-in devices.', 'error') }
    finally { setBusyId('') }
  }

  return <section className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--clay)] p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--gold)]/30 bg-[var(--gold-tint)] text-[var(--gold2)]"><Fingerprint size={20} /></span>
        <div><h3 className="text-sm font-bold text-[var(--text)]">Fingerprint sign-in devices</h3><p className="mt-1 text-xs text-[var(--muted)]">Review or revoke Android devices that can sign in with a fingerprint.</p></div>
      </div>
      {devices.length > 1 ? <button type="button" onClick={() => void revokeAll()} disabled={Boolean(busyId)} className="min-h-11 shrink-0 text-xs font-semibold text-[var(--danger-text)] disabled:opacity-50">{busyId === 'all' ? 'Removing…' : 'Remove all'}</button> : null}
    </div>
    {error ? <p role="alert" className="mt-4 text-xs text-[var(--danger-text)]">{error}</p> : null}
    <div className="mt-4 space-y-2">
      {loading ? <p className="rounded-xl border border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">Loading devices…</p> : devices.length ? devices.map(device => {
        const thisDevice = getDeviceLoginHint()?.id === device.id
        return <div key={device.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--coal)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3"><Smartphone size={18} className="shrink-0 text-[var(--gold2)]" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--text)]">{device.deviceLabel}{thisDevice ? ' · This device' : ''}</p><p className="mt-1 text-[11px] text-[var(--muted)]">Last used {displayDate(device.lastUsedAt)} · Expires {displayDate(device.expiresAt)}</p></div></div>
          <button type="button" onClick={() => void revoke(device.id)} disabled={Boolean(busyId)} className="min-h-11 shrink-0 px-2 text-xs font-semibold text-[var(--danger-text)] disabled:opacity-50">{busyId === device.id ? 'Removing…' : 'Remove'}</button>
        </div>
      }) : <p className="rounded-xl border border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">No fingerprint sign-in devices are enrolled.</p>}
    </div>
  </section>
}
