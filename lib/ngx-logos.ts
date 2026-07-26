const NGX_LOGO_CDN_BASE = 'https://cdn.jsdelivr.net/gh/ngnmarket/ngx-logos/dist/png'

export function getNgxStockLogoUrl(symbol: string) {
  const normalized = symbol.trim().toUpperCase()
  if (!normalized) return undefined
  return `${NGX_LOGO_CDN_BASE}/${encodeURIComponent(normalized)}.png`
}

export function resolveNgxStockLogoUrl(symbol: string, logoUrl?: string) {
  const trimmed = logoUrl?.trim()
  if (trimmed) return trimmed
  return getNgxStockLogoUrl(symbol)
}