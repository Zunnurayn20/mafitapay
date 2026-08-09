import { getProfitMargin } from '@/lib/server/data'

/**
 * Per-product profit margins.
 *
 * The database is the only source. There is no env var and no hardcoded default: a margin is
 * whatever an admin set on /admin/margins, and nothing else. Changing pricing therefore never
 * requires a redeploy, and there is exactly one number to look at when asking what we charge.
 *
 * An unset margin resolves to 0 -- the product sells at provider cost. That is a deliberate
 * choice: it keeps sales flowing rather than blocking them, but it means a missing row costs
 * real money on every transaction. Both paths below log loudly so the condition is visible in
 * logs instead of quietly eroding revenue.
 */

export type MarginKey = 'bills_amigo' | 'bills_asbdata' | 'transfer_out'

export type MarginDefinition = {
  key: MarginKey
  label: string
  description: string
}

export const MARGIN_DEFINITIONS: readonly MarginDefinition[] = [
  {
    key: 'bills_amigo',
    label: 'Data & airtime (Amigo)',
    description: 'Added to the Amigo wholesale price on every data bundle.',
  },
  {
    key: 'bills_asbdata',
    label: 'Data & airtime (ASBDATA)',
    description: 'Added to the ASBDATA wholesale price on every data bundle.',
  },
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
 * Never throws: a pricing lookup must not be the thing that fails a purchase. The tradeoff is
 * that a database problem sells at cost, so both the miss and the error are logged as warnings.
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

    // Checked inline rather than through the isSet flag so the null is actually narrowed away.
    const value = stored != null && stored >= 0 ? stored : 0
    const isSet = stored != null && stored >= 0

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      // What customers are actually charged right now.
      value,
      isSet,
    }
  }))
}
