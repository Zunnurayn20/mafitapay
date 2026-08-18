import { NextResponse } from 'next/server'
import { requireAdminUser, unauthorized } from '@/lib/server/auth'
import { CONTRACT_LOOKUP_NETWORKS, isContractLookupNetwork } from '@/lib/crypto-contract-lookup'
import { lookupTokenByContract } from '@/lib/server/token-metadata'

export const runtime = 'nodejs'

/**
 * Fills in a crypto pair draft from a contract address so an operator never hand-types a chain id,
 * token address, decimals or price-feed id. Read-only: nothing here writes to the catalog, it only
 * returns what the form should be populated with.
 */
export async function POST(req: Request) {
  const user = await requireAdminUser()
  if (!user) return unauthorized()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.', success: false }, { status: 400 })
  }

  const payload = (body ?? {}) as { network?: unknown; address?: unknown }
  const network = typeof payload.network === 'string' ? payload.network.trim() : ''
  const address = typeof payload.address === 'string' ? payload.address.trim() : ''

  if (!address) {
    return NextResponse.json({ error: 'Contract address is required.', success: false }, { status: 400 })
  }
  if (!isContractLookupNetwork(network)) {
    return NextResponse.json({
      error: `Contract lookup is only available on ${CONTRACT_LOOKUP_NETWORKS.join(', ')}. Other networks store token metadata differently, so those pairs are still entered by hand.`,
      success: false,
    }, { status: 400 })
  }

  try {
    const data = await lookupTokenByContract(network, address)
    return NextResponse.json({ data, success: true })
  } catch (error) {
    const statusCode = (error as Error & { statusCode?: number }).statusCode
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Token lookup failed.',
      success: false,
    }, { status: typeof statusCode === 'number' ? statusCode : 502 })
  }
}
