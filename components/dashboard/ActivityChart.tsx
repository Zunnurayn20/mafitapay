'use client'
import { useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { useAppStore } from '@/store'

const PERIODS = ['Week','Month','Year']

export function ActivityChart() {
  const { transactions } = useAppStore()
  const [period, setPeriod] = useState('Month')
  const now = new Date()
  const bucketCount = period === 'Week' ? 7 : period === 'Month' ? 14 : 12
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(now)
    const end = new Date(now)

    if (period === 'Year') {
      start.setMonth(now.getMonth() - (bucketCount - 1 - index), 1)
      start.setHours(0, 0, 0, 0)
      end.setMonth(start.getMonth() + 1, 1)
      end.setHours(0, 0, 0, 0)
    } else {
      start.setDate(now.getDate() - (bucketCount - 1 - index))
      start.setHours(0, 0, 0, 0)
      end.setTime(start.getTime())
      end.setDate(start.getDate() + 1)
    }

    const value = transactions
      .filter(item => item.status === 'success' && item.amount < 0)
      .filter(item => {
        const createdAt = new Date(item.createdAt).getTime()
        return createdAt >= start.getTime() && createdAt < end.getTime()
      })
      .reduce((sum, item) => sum + Math.abs(item.amount), 0)

    const label = period === 'Year'
      ? start.toLocaleString('en-NG', { month: 'short' })
      : start.toLocaleString('en-NG', { day: 'numeric', month: 'short' })

    return { label, value }
  })
  const max = Math.max(...buckets.map(item => item.value), 1)
  const activeIndex = buckets.length - 1
  const rangeLabel = period === 'Week'
    ? 'Last 7 days'
    : period === 'Month'
      ? 'Last 14 days'
      : `${now.getFullYear()} monthly view`

  return (
    <Card>
      <CardHeader className="flex-wrap gap-3">
        <CardTitle>Spending Activity — {rangeLabel}</CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-[9px] font-bold border transition-all ${period === p ? 'border-[var(--gold)] text-[var(--gold2)] bg-[rgba(79,70,229,.08)]' : 'border-[var(--border)] text-[var(--muted)] bg-[var(--clay)]'}`}
            >{p}</button>
          ))}
        </div>
      </CardHeader>
      <div className="px-5 pt-5 pb-8">
        <div className="flex items-end gap-1.5 h-[130px]">
          <div className="flex flex-col justify-between h-full pr-2 flex-shrink-0">
            {[max, max / 2, 0].map(value => (
              <span key={value} className="text-[7px] text-[var(--muted)] font-mono">
                ₦{Math.round(value).toLocaleString('en-NG')}
              </span>
            ))}
          </div>
          {buckets.map((bucket, i) => (
            <div key={i} className="flex-1 flex flex-col items-center h-full justify-end">
              <div
                title={`₦${Math.round(bucket.value).toLocaleString('en-NG')}`}
                style={{
                  width: '100%',
                  height: `${(bucket.value / max) * 100}%`,
                  minHeight: bucket.value > 0 ? '8%' : '2px',
                  background: i === activeIndex ? 'rgba(79,70,229,.45)' : 'rgba(79,70,229,.18)',
                  borderTop: `2px solid ${i === activeIndex ? 'var(--gold2)' : 'var(--gold)'}`,
                  cursor: 'pointer',
                  transition: 'background .15s',
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'rgba(79,70,229,.4)')}
                onMouseOut={e => (e.currentTarget.style.background = i === activeIndex ? 'rgba(79,70,229,.45)' : 'rgba(79,70,229,.18)')}
              />
              <span className="text-[7px] text-[var(--muted)] font-mono mt-1.5 whitespace-nowrap">{bucket.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
