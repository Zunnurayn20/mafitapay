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

  async function share() {
    if (!overview?.referralCode) return
    const url = `${window.location.origin}/register?ref=${encodeURIComponent(overview.referralCode)}`
    const text = `Join MafitaPay with my referral code ${overview.referralCode}: ${url}`

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: 'MafitaPay Referral',
          text,
        })
        return
      }

      navigator.clipboard?.writeText(url)
      showToast('Referral signup link copied.')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      showToast(error instanceof Error ? error.message : 'Unable to share referral link.', 'error')
    }
  }

  const referralCode = overview?.referralCode || '—'
  const entries = overview?.entries ?? []

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,21.25rem)]">
      <div className="order-2 xl:order-1">
        <div className="mb-4 grid grid-cols-2 gap-3">
          {[
            { label: 'Total Referrals', val: loading ? '...' : String(overview?.totalReferrals ?? 0), sub: 'Friends joined', color: 'var(--gold2)' },
            { label: 'Total Earned', val: loading ? '...' : `₦${(overview?.totalEarned ?? 0).toLocaleString('en-NG')}`, sub: 'Referral bonuses paid', color: 'var(--green)' },
          ].map(s => (
            <Card key={s.label} className="p-4" accent={s.color}>
              <div className="mb-1 text-[8px] font-bold uppercase tracking-[1.1px] text-[var(--muted)]">{s.label}</div>
              <div className="font-display text-[21px] font-black text-[var(--text)]">{s.val}</div>
              <div className="mt-1 text-[9px] text-[var(--green2)]">{s.sub}</div>
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
            <div key={entry.userId} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0 sm:px-5 sm:py-4">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--clay2)] font-display text-[13px] font-bold text-[var(--gold2)]">
                {entry.name.trim().charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1">
                <div className="text-[12px] font-semibold text-[var(--text)]">{entry.name}</div>
                <div className="text-[8px] text-[var(--muted)] sm:text-[9px]">
                  Joined {new Date(entry.joinedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short' })} · {entry.transactionCount} transaction{entry.transactionCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-bold text-[var(--green2)] sm:text-[12px]">₦{entry.earnedAmount.toLocaleString('en-NG')}</div>
                <Badge variant={entry.rewardPaid ? 'success' : 'pending'} className="mt-1 text-[8px]">{entry.rewardPaid ? 'Paid' : 'Pending'}</Badge>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div className="order-1 xl:order-2">
        <Card className="p-5 sm:p-6">
          <div className="mb-1 text-[13px] font-bold text-[var(--text)]">Your Referral Code</div>
          <div className="mb-4 text-[10px] text-[var(--muted)]">Share with friends and earn automatically after their first qualifying transaction.</div>
          <div className="mb-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-center font-mono text-[22px] font-black tracking-[3px] text-[var(--gold2)] sm:text-[28px] sm:tracking-[4px]">{referralCode}</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-2">
            <Button onClick={copy} className="px-2 py-2 text-[10px] sm:py-3 sm:text-sm" disabled={!overview?.referralCode}>{copied ? 'Copied' : 'Code'}</Button>
            <Button
              variant="secondary"
              className="px-2 py-2 text-[10px] sm:py-3 sm:text-sm"
              disabled={!overview?.referralCode}
              onClick={() => {
                const url = `${window.location.origin}/register?ref=${encodeURIComponent(overview?.referralCode ?? '')}`
                navigator.clipboard?.writeText(url)
                showToast('Referral signup link copied.')
              }}
            >
              Link
            </Button>
            <Button variant="secondary" className="px-2 py-2 text-[10px] sm:col-span-2 sm:py-3 sm:text-sm" disabled={!overview?.referralCode} onClick={() => void share()}>
              Share
            </Button>
          </div>
          <div className="mt-4 border border-[rgba(79,70,229,.18)] border-l-4 border-l-[var(--gold)] bg-[rgba(79,70,229,.06)] p-3">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[var(--gold2)]">How it works</div>
            <div className="text-[10px] leading-[1.6] text-[var(--text2)]">A referred user appears here after signup. Your ₦200 bonus is paid once they complete their first successful non-referral transaction.</div>
          </div>
        </Card>
      </div>
    </div>
  )
}
