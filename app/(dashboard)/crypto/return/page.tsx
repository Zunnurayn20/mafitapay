'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store'

type SyncState = 'syncing' | 'success' | 'error'

export default function CryptoReturnPage() {
  const { refreshSession } = useAppStore()
  const searchParams = useSearchParams()
  const [state, setState] = useState<SyncState>('syncing')
  const [message, setMessage] = useState('Checking your provider order and updating your wallet history…')
  const [partnerOrderId, setPartnerOrderId] = useState('')

  useEffect(() => {
    let active = true

    async function run() {
      try {
        const nextPartnerOrderId = searchParams.get('partnerOrderId') ?? ''
        if (!nextPartnerOrderId) {
          throw new Error('Missing provider order reference.')
        }
        if (!active) return
        setPartnerOrderId(nextPartnerOrderId)

        const response = await fetch('/api/crypto/provider/transak/return-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ partnerOrderId: nextPartnerOrderId }),
        })
        const payload = await response.json()
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || 'Unable to sync provider order.')
        }

        await refreshSession()
        if (!active) return

        const orderStatus = payload.data?.order?.status
        if (orderStatus === 'fulfilled') {
          setState('success')
          setMessage('Your buy order has completed and your history has been updated.')
          return
        }
        if (orderStatus === 'failed' || orderStatus === 'expired') {
          setState('error')
          setMessage(`Your order is ${orderStatus}. Check transaction history for details.`)
          return
        }

        setState('success')
        setMessage('Your order is still pending. We refreshed its latest provider status in your account.')
      } catch (error) {
        if (!active) return
        setState('error')
        setMessage(error instanceof Error ? error.message : 'Unable to sync your order.')
      }
    }

    void run()
    return () => {
      active = false
    }
  }, [refreshSession, searchParams])

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="p-8">
        <div className="text-[11px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Order Return</div>
        <div className="mt-3 text-[24px] font-display font-black text-[var(--text)]">
          {state === 'syncing' ? 'Syncing Order…' : state === 'success' ? 'Order Updated' : 'Sync Failed'}
        </div>
        <div className="mt-3 text-[13px] text-[var(--text2)]">{message}</div>
        {partnerOrderId && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] p-3 text-[10px] text-[var(--muted)] font-mono">
            {partnerOrderId}
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/history">
            <Button>Open History</Button>
          </Link>
          <Link href="/crypto">
            <Button variant="secondary">Back to Crypto</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}
