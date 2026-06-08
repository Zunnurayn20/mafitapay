/**
 * Small smoke / manual test helper for the crypto deposit scanner + force scan.
 * Run with: npx tsx tests/crypto-deposit-smoke.ts 0xYourTestDepositAddress USDC_BASE
 * (requires the dev server running and admin or the internal functions via a job token if added)
 *
 * It demonstrates calling the force scan for one address (the new admin helper capability).
 */

import { forceScanDepositAddress, kickCryptoDepositScanner } from '../lib/server/crypto-deposit-scanner'

async function main() {
  const address = process.argv[2]
  const pairId = process.argv[3]
  if (!address) {
    console.log('Usage: tsx tests/crypto-deposit-smoke.ts <depositAddress> [pairId]')
    console.log('Example: tsx tests/crypto-deposit-smoke.ts 0x123... USDC_BASE')
    process.exit(1)
  }
  console.log('Kicking full scanner watchdog sync...')
  const full = await kickCryptoDepositScanner()
  console.log('Full sync result:', full)

  console.log('Attempting targeted force scan for', address, pairId || '')
  try {
    const targeted = await forceScanDepositAddress({ address, pairId: pairId as any })
    console.log('Targeted force result:', JSON.stringify(targeted, null, 2))
  } catch (e) {
    console.warn('Targeted force (expected if address not provisioned in this DB):', (e as Error).message)
  }
  console.log('Smoke done. Check logs for [crypto-deposit-scanner] and DB crypto_deposit_events.')
}

main().catch(console.error)
