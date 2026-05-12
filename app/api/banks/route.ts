import { NextResponse } from 'next/server'
import { getBankDirectory, upsertBankDirectory } from '@/lib/server/data'
import { fetchFlutterwaveBanks } from '@/lib/server/bank-resolution'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const country = url.searchParams.get('country') || 'NG'
  const forceRefresh = url.searchParams.get('refresh') === 'true'

  let banks = await getBankDirectory(country, 'flutterwave')

  if (forceRefresh || banks.length === 0) {
    try {
      const fetched = await fetchFlutterwaveBanks(country)
      if (fetched.length > 0) {
        banks = await upsertBankDirectory(fetched)
      }
    } catch {
      // Keep cached bank directory if provider fetch is unavailable.
    }
  }

  return NextResponse.json({ data: banks, success: true })
}
