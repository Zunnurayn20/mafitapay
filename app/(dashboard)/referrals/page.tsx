'use client'
import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store'
import type { ReferralOverview } from '@/types'

export default function ReferralsPage() {
  const { showToast } = useAppStore()
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<ReferralOverview | null>(null)

  useEffect(() => {
    let active = true

    void fetch('/api/referrals', { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Failed to load referral data.')
        }
        return payload.data as ReferralOverview
      })
      .then(data => {
        if (!active) return
        setOverview(data)
      })
      .catch(error => {
        if (!active) return
        showToast(error instanceof Error ? error.message : 'Failed to load referral data.', 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [showToast])

  function copy() {
    if (!overview?.referralCode) return
    navigator.clipboard?.writeText(overview.referralCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const referralCode = overview?.referralCode || '—'
  const entries = overview?.entries ?? []

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,21.25rem)]">
      <div>
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { label: 'Total Referrals', val: loading ? '...' : String(overview?.totalReferrals ?? 0), sub: 'Friends joined', color: 'var(--gold2)' },
            { label: 'Total Earned', val: loading ? '...' : `₦${(overview?.totalEarned ?? 0).toLocaleString('en-NG')}`, sub: 'Referral bonuses paid', color: 'var(--green)' },
          ].map(s => (
            <Card key={s.label} className="p-5" accent={s.color}>
              <div className="mb-2 text-[8px] font-bold uppercase tracking-[1.3px] text-[var(--muted)]">{s.label}</div>
              <div className="mb-1 font-display text-[26px] font-black text-[var(--text)]">{s.val}</div>
              <div className="text-[10px] text-[var(--green2)]">{s.sub}</div>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle>Friends Referred</CardTitle></CardHeader>
          {entries.length === 0 && !loading && (
            <div className="px-5 py-6 text-[11px] text-[var(--muted)]">
              No referred users yet.
            </div>
          )}
          {entries.map(entry => (
            <div key={entry.userId} className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4 last:border-0">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--clay2)] font-display text-sm font-bold text-[var(--gold2)]">
                {entry.name.trim().charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[var(--text)]">{entry.name}</div>
                <div className="text-[9px] text-[var(--muted)]">
                  Joined {new Date(entry.joinedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short' })} · {entry.transactionCount} transaction{entry.transactionCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[12px] font-bold text-[var(--green2)]">₦{entry.earnedAmount.toLocaleString('en-NG')}</div>
                <Badge variant={entry.rewardPaid ? 'success' : 'pending'} className="mt-1">{entry.rewardPaid ? 'Paid' : 'Pending'}</Badge>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div>
        <Card className="p-6">
          <div className="mb-1 text-[13px] font-bold text-[var(--text)]">Your Referral Code</div>
          <div className="mb-4 text-[10px] text-[var(--muted)]">Share with friends. Referral bonuses post automatically after a referred user completes a qualifying transaction.</div>
          <div className="mb-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-4 text-center font-mono text-[28px] font-black tracking-[4px] text-[var(--gold2)]">{referralCode}</div>
          <div className="flex gap-2">
            <Button onClick={copy} className="flex-1 py-3" disabled={!overview?.referralCode}>{copied ? '✓ Copied!' : 'Copy Code'}</Button>
            <Button
              variant="secondary"
              className="flex-1 py-3"
              disabled={!overview?.referralCode}
              onClick={() => {
                const url = `${window.location.origin}/register?ref=${encodeURIComponent(overview?.referralCode ?? '')}`
                navigator.clipboard?.writeText(url)
                showToast('Referral signup link copied.')
              }}
            >
              Copy Link
            </Button>
          </div>
          <div className="mt-5 border border-[rgba(79,70,229,.18)] border-l-4 border-l-[var(--gold)] bg-[rgba(79,70,229,.06)] p-4">
            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--gold2)]">How it works</div>
            <div className="text-[11px] leading-[1.7] text-[var(--text2)]">Share your code or link. When someone signs up with it, they appear here. Once they complete their first successful non-referral transaction, your ₦200 referral bonus is paid automatically.</div>
          </div>
        </Card>
      </div>
    </div>
  )
}
