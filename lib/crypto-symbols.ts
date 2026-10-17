/** Current display ticker for a crypto symbol, including renamed legacy tickers. */
export function getCryptoDisplaySymbol(symbol: string | null | undefined) {
  const normalized = symbol?.trim().toUpperCase() ?? ''
  if (normalized === 'TON') return 'GRAM'
  return normalized
}

/** Resolve the customer-facing ticker from a stored pair ID. */
export function getCryptoDisplaySymbolFromPairId(pairId: string | null | undefined) {
  const normalized = pairId?.trim().toUpperCase() ?? ''
  if (normalized === 'TON_TON') return 'GRAM'
  return getCryptoDisplaySymbol(normalized.split('_')[0]) || 'Asset'
}
