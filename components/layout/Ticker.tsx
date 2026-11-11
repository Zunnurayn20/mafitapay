'use client'

import { useCryptoAssets } from '@/lib/client/catalogs'
import { formatNGN } from '@/lib/utils'
import type { CryptoAsset } from '@/types'

function rateStatus(asset?: CryptoAsset) {
  if (!asset || !asset.buyRate || asset.buyRate <= 0 || asset.pricingSource === 'safe') return 'unavailable'
  return asset.pricingSource === 'backup' ? 'cached' : 'live'
}

export function Ticker() {
  const assets = useCryptoAssets()
  const usdt = assets.find(asset => asset.id === 'USDT_BSC') ?? assets.find(asset => asset.symbol === 'USDT')
  const eth = assets.find(asset => asset.id === 'ETH_BASE') ?? assets.find(asset => asset.symbol === 'ETH')
  const usdtStatus = rateStatus(usdt)
  const ethStatus = rateStatus(eth)

  return (
    <div className="flex flex-shrink-0 items-center gap-4 overflow-hidden border-b border-[var(--border)] bg-[var(--clay)] px-4 py-2 sm:px-6 lg:px-8">
      <span className="flex-shrink-0 text-[8px] font-bold tracking-[1.2px] text-[var(--gold)]">MAFITAPAY</span>
      <span
        className="animate-ticker whitespace-nowrap text-[10px] italic text-[var(--muted)]"
        style={{ animationDuration: '35s' }}
        aria-live="polite"
      >
        “Owo l&apos;owo — a hand washes the other.”
        {' · '}
        USDT {usdtStatus === 'live' ? 'live' : usdtStatus === 'cached' ? 'cached' : 'rate unavailable'}
        {usdtStatus !== 'unavailable' && usdt ? ` · Buy ${formatNGN(usdt.buyRate)} · Sell ${formatNGN(usdt.sellRate)}` : ''}
        {' · '}
        ETH {ethStatus === 'live' ? 'live' : ethStatus === 'cached' ? 'cached' : 'rate unavailable'}
        {ethStatus !== 'unavailable' && eth ? ` · Buy ${formatNGN(eth.buyRate)}` : ''}
        {' · Your funds are secured.'}
      </span>
    </div>
  )
}
