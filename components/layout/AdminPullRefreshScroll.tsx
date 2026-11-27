'use client'

import { RefreshCw } from 'lucide-react'
import { useRef, useState, type ReactNode, type TouchEvent } from 'react'

export function AdminPullRefreshScroll({
  children,
  className,
}: {
  children: ReactNode
  className: string
}) {
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const distanceRef = useRef(0)

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1 || refreshing || event.currentTarget.scrollTop > 0) {
      startRef.current = null
      return
    }
    startRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const start = startRef.current
    if (!start || event.touches.length !== 1 || event.currentTarget.scrollTop > 0) return
    const touch = event.touches[0]
    const deltaY = touch.clientY - start.y
    const deltaX = Math.abs(touch.clientX - start.x)
    if (deltaY <= 0 || deltaX > deltaY) return
    const nextDistance = Math.min(88, deltaY * 0.5)
    distanceRef.current = nextDistance
    setDistance(nextDistance)
  }

  function finishTouch() {
    startRef.current = null
    const shouldRefresh = distanceRef.current >= 64 && !refreshing
    distanceRef.current = 0
    setDistance(0)
    if (!shouldRefresh) return
    setRefreshing(true)
    window.setTimeout(() => window.location.reload(), 120)
  }

  function cancelTouch() {
    startRef.current = null
    distanceRef.current = 0
    setDistance(0)
  }

  return (
    <div
      className={`relative ${className}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={finishTouch}
      onTouchCancel={cancelTouch}
    >
      <div
        aria-live="polite"
        className={`pointer-events-none absolute left-1/2 top-2 z-40 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-xs text-[var(--text2)] shadow-lg transition-[opacity,transform] duration-150 ${distance === 0 && !refreshing ? 'opacity-0' : 'opacity-100'}`}
        style={{ transform: `translate(-50%, ${Math.max(0, distance - 18)}px)` }}
      >
        <RefreshCw size={14} className={refreshing ? 'animate-spin text-[var(--gold)]' : 'text-[var(--gold)]'} />
        <span>{refreshing ? 'Refreshing…' : distance >= 64 ? 'Release to refresh' : 'Pull to refresh'}</span>
      </div>
      {children}
    </div>
  )
}
