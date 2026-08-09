import { getProfitMargin } from '@/lib/server/data'

/**
 * Flat per-product profit margins for products that are not data plans.
 *
 * Data / airtime plans use the pricing-rules engine (`lib/server/data-pricing.ts`)
 * — hierarchical % + flat + floor/cap + round, like online-data-sub.
 *
 * The database is the only source for these flat keys. There is no env var and no
 * hardcoded default: a margin is whatever an admin set on /admin/margins.
 *
 * An unset margin resolves to 0 — the product sells at provider cost. That is
 * deliberate so sales keep flowing, but a missing row earns nothing; both paths
 * log loudly.
 */

export type MarginKey = 'transfer_out'

export type MarginDefinition = {
  key: MarginKey
  label: string
  description: string
}

export const MARGIN_DEFINITIONS: readonly MarginDefinition[] = [
  {
    key: 'transfer_out',
    label: 'Bank transfer & withdrawal',
    description: 'Added on top of the Flutterwave payout cost, which already includes VAT.',
  },
]

const DEFINITION_BY_KEY = new Map(MARGIN_DEFINITIONS.map(entry => [entry.key, entry]))

/**
 * The margin charged for a product, or 0 when none is set.
 *
 * Never throws: a pricing lookup must not be the thing that fails a purchase.
 */
export async function resolveMargin(key: MarginKey): Promise<number> {
  if (!DEFINITION_BY_KEY.has(key)) {
    console.warn(`[margins] unknown margin key "${key}" — charging 0`)
    return 0
  }

  try {
    const stored = await getProfitMargin(key)
    if (stored != null && stored >= 0) return stored
    console.warn(`[margins] no margin set for "${key}" — selling at provider cost`)
    return 0
  } catch (error) {
    console.warn(
      `[margins] could not read margin "${key}" — selling at provider cost:`,
      error instanceof Error ? error.message : error,
    )
    return 0
  }
}

/** Every margin with its current value, for the admin page. `isSet` false means never configured. */
export async function listResolvedMargins() {
  return Promise.all(MARGIN_DEFINITIONS.map(async definition => {
    let stored: number | null = null
    try {
      stored = await getProfitMargin(definition.key)
    } catch {
      stored = null
    }

    const value = stored != null && stored >= 0 ? stored : 0
    const isSet = stored != null && stored >= 0

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      value,
      isSet,
    }
  }))
}
