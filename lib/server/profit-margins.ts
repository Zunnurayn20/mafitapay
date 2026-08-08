import { getProfitMargin } from '@/lib/server/data'

/**
 * Per-product profit margins.
 *
 * Each margin has an admin-set value in the database and an env-var fallback. The database wins
 * when a row exists, so pricing can be changed from the admin page without a redeploy; the env var
 * remains the value a fresh install starts from.
 *
 * A missing row is not the same as zero. Zero is a legitimate margin an admin might choose, so
 * absence falls back to env while an explicit 0 is honoured.
 */

export type MarginKey = 'bills_amigo' | 'bills_asbdata' | 'transfer_out'

export type MarginDefinition = {
  key: MarginKey
  label: string
  description: string
  envVar: string
  fallback: number
}

export const MARGIN_DEFINITIONS: readonly MarginDefinition[] = [
  {
    key: 'bills_amigo',
    label: 'Data & airtime (Amigo)',
    description: 'Added to the Amigo wholesale price on every data bundle.',
    envVar: 'MAFITAPAY_AMIGO_PLATFORM_MARKUP_NGN',
    fallback: 15,
  },
  {
    key: 'bills_asbdata',
    label: 'Data & airtime (ASBDATA)',
    description: 'Added to the ASBDATA wholesale price on every data bundle.',
    envVar: 'MAFITAPAY_ASBDATA_PLATFORM_MARKUP_NGN',
    fallback: 15,
  },
  {
    key: 'transfer_out',
    label: 'Bank transfer & withdrawal',
    description: 'Added on top of the Flutterwave payout cost, which already includes VAT.',
    envVar: 'MAFITAPAY_TRANSFER_FEE_MARGIN_NGN',
    fallback: 25,
  },
]

const DEFINITION_BY_KEY = new Map(MARGIN_DEFINITIONS.map(entry => [entry.key, entry]))

function readEnvMargin(definition: MarginDefinition): number {
  const raw = process.env[definition.envVar]
  const parsed = Number(raw)
  // Negative margins would mean selling below cost, which is never intended here.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : definition.fallback
}

/** The margin actually charged for a product: admin value if set, else the env fallback. */
export async function resolveMargin(key: MarginKey): Promise<number> {
  const definition = DEFINITION_BY_KEY.get(key)
  if (!definition) return 0

  try {
    const stored = await getProfitMargin(key)
    if (stored != null && stored >= 0) return stored
  } catch {
    // A margin lookup must never take down a purchase. Fall through to the env value.
  }

  return readEnvMargin(definition)
}

/** Every margin with both its effective value and where that value came from, for the admin page. */
export async function listResolvedMargins() {
  return Promise.all(MARGIN_DEFINITIONS.map(async definition => {
    let stored: number | null = null
    try {
      stored = await getProfitMargin(definition.key)
    } catch {
      stored = null
    }

    const envValue = readEnvMargin(definition)
    // Checked inline rather than via a boolean flag so the null is actually narrowed away.
    const value = stored != null && stored >= 0 ? stored : envValue
    const source = stored != null && stored >= 0 ? ('database' as const) : ('env' as const)

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      envVar: definition.envVar,
      envValue,
      value,
      source,
    }
  }))
}
