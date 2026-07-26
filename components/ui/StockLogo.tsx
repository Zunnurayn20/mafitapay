'use client'

import { AssetLogo } from '@/components/ui/AssetLogo'
import { resolveNgxStockLogoUrl } from '@/lib/ngx-logos'

type StockLogoProps = {
  symbol: string
  name: string
  logoUrl?: string
  size?: 'sm' | 'md'
}

export function StockLogo({ symbol, name, logoUrl, size = 'md' }: StockLogoProps) {
  const boxClass = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  const imageClass = size === 'sm' ? 'h-9 w-9 object-contain p-1' : 'h-11 w-11 object-contain p-1.5'

  return (
    <AssetLogo
      src={resolveNgxStockLogoUrl(symbol, logoUrl)}
      alt={`${name} logo`}
      fallback={symbol.slice(0, 2)}
      className={`flex ${boxClass} flex-shrink-0 items-center justify-center overflow-hidden rounded-sm border border-[var(--border)] bg-white`}
      imgClassName={imageClass}
      textClassName="font-display text-[10px] font-black text-[var(--gold)]"
    />
  )
}