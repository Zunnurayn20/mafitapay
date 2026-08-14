import { WalletContractV4 } from '@ton/ton'
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { base58 } from '@scure/base'
import { ed25519 } from '@noble/curves/ed25519.js'
import { KeyPair, keyToImplicitAddress } from 'near-api-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { CryptoAsset, CryptoDepositAddress, CryptoDepositAddressFamily } from '@/types'
import {
  createCryptoDepositAddress,
  getCryptoAssets,
  getSensitiveIdentityConfigState,
  listCryptoDepositAddressesByUserId,
} from '@/lib/server/data'
import { subscribeCryptoDepositAddressesToAlchemy } from '@/lib/server/alchemy-address-webhooks'

const FAMILY_LABELS: Record<CryptoDepositAddressFamily, string> = {
  evm: 'EVM networks',
  solana: 'Solana',
  ton: 'TON',
  near: 'NEAR',
  sui: 'Sui',
}

export function getCryptoDepositAddressFamilyForAsset(asset: CryptoAsset): CryptoDepositAddressFamily | null {
  const network = asset.network.trim().toLowerCase()
  if (asset.routedAddressFamily === 'solana' || network === 'solana') return 'solana'
  if (network === 'ton') return 'ton'
  if (network === 'near') return 'near'
  if (network === 'sui') return 'sui'
  if (
    network === 'base'
    || network === 'bsc'
    || network === 'ethereum'
    || network === 'polygon'
    || network === 'matic'
    || network === 'arbitrum'
    || network === 'optimism'
    || network === 'linea'
    || network === 'robinhood'
    || asset.routedAddressFamily === 'evm'
  ) {
    return 'evm'
  }
  return null
}

function getNetworkLabel(family: CryptoDepositAddressFamily) {
  return FAMILY_LABELS[family]
}

async function generateAddressForFamily(family: CryptoDepositAddressFamily) {
  if (family === 'evm') {
    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)
    return {
      address: account.address,
      secret: privateKey,
      derivationPath: "random:evm-secp256k1",
    }
  }

  if (family === 'ton') {
    const mnemonic = await mnemonicNew(24)
    const keyPair = await mnemonicToPrivateKey(mnemonic)
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })
    return {
      address: wallet.address.toString({ bounceable: false, urlSafe: true }),
      secret: mnemonic.join(' '),
      derivationPath: 'random:ton-wallet-v4',
    }
  }

  if (family === 'near') {
    const keyPair = KeyPair.fromRandom('ed25519')
    return {
      address: keyToImplicitAddress(keyPair.getPublicKey()),
      secret: keyPair.toString(),
      derivationPath: 'random:near-implicit-ed25519',
    }
  }

  if (family === 'solana') {
    const privateKey = ed25519.utils.randomSecretKey()
    const publicKey = ed25519.getPublicKey(privateKey)
    return {
      address: base58.encode(publicKey),
      secret: base58.encode(privateKey),
      derivationPath: 'random:solana-ed25519',
    }
  }

  const keypair = new Ed25519Keypair()
  return {
    address: keypair.getPublicKey().toSuiAddress(),
    secret: keypair.getSecretKey(),
    derivationPath: 'random:sui-ed25519',
  }
}

export async function getRequiredCryptoDepositFamilies() {
  const assets = await getCryptoAssets()
  const families = new Set<CryptoDepositAddressFamily>()
  for (const asset of assets) {
    if (asset.isActive === false) continue
    const family = getCryptoDepositAddressFamilyForAsset(asset)
    if (family) families.add(family)
  }
  return [...families]
}

export async function provisionCryptoDepositAddressesForUser(userId: string): Promise<CryptoDepositAddress[]> {
  const keyState = getSensitiveIdentityConfigState()
  if (!keyState.configured) {
    throw new Error('MAFITAPAY_SENSITIVE_DATA_KEY must be configured before creating crypto deposit addresses.')
  }

  const requiredFamilies = await getRequiredCryptoDepositFamilies()
  const existing = await listCryptoDepositAddressesByUserId(userId)
  const existingFamilies = new Set(existing.map(item => item.addressFamily))

  const created: CryptoDepositAddress[] = []
  for (const family of requiredFamilies) {
    if (existingFamilies.has(family)) continue
    const generated = await generateAddressForFamily(family)
    const address = await createCryptoDepositAddress({
      userId,
      addressFamily: family,
      networkLabel: getNetworkLabel(family),
      ...generated,
    })
    created.push(address)
  }

  // Subscriptions are deliberately best-effort: a temporary Alchemy dashboard/API outage must
  // never stop a customer from receiving their deposit address. The normal scanner remains the
  // reconciliation fallback, and the protected sync job can replay every address later.
  if (created.length > 0) {
    void subscribeCryptoDepositAddressesToAlchemy({
      evmAddresses: created.filter(item => item.addressFamily === 'evm').map(item => item.address),
      solanaAddresses: created.filter(item => item.addressFamily === 'solana').map(item => item.address),
    }).catch(error => console.warn('[alchemy-webhook] could not subscribe new deposit address:', error instanceof Error ? error.message : String(error)))
  }

  return listCryptoDepositAddressesByUserId(userId)
}

export async function getCryptoDepositAddressForAsset(userId: string, asset: CryptoAsset) {
  const family = getCryptoDepositAddressFamilyForAsset(asset)
  if (!family) return null
  const addresses = await provisionCryptoDepositAddressesForUser(userId)
  return addresses.find(item => item.addressFamily === family) ?? null
}
