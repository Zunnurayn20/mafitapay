import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  fallback,
  getAddress,
  http,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, bsc, polygon } from 'viem/chains'
import { Address as TonAddress, TonClient, WalletContractV4, internal, toNano } from '@ton/ton'
import { mnemonicToPrivateKey } from '@ton/crypto'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { base58 } from '@scure/base'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction as SuiTransaction } from '@mysten/sui/transactions'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair } from 'near-api-js'
import { NEAR } from 'near-api-js/tokens'
import { getBaseBuilderDataSuffix, getBaseExecutorConfig } from '@/lib/server/base-executor'
import { getBscExecutorConfig } from '@/lib/server/bsc-executor'
import { createTonHttpAdapter, getTonExecutorConfig } from '@/lib/server/ton-executor'
import {
  claimCryptoDepositEventSweep,
  getCryptoDepositAddressSecretById,
  markCryptoDepositEventSweepFailed,
  markCryptoDepositEventSwept,
} from '@/lib/server/data'
import type { CryptoDepositEvent, CryptoOrder } from '@/types'

// === Gas / fee reserves for deposit sweeps (hybrid best-practice) ===
// These are treated as minimum floors. For chains where we can estimate (EVM + Sui),
// we take max(floor, real_estimate * safety_multiplier).
// All key tunables are overridable via env vars so you can adjust without redeploy.
//
// Useful env vars (with current defaults):
//   MAFITAPAY_SWEEP_EVM_GAS_MULTIPLIER=1.5
//   MAFITAPAY_SWEEP_SUI_GAS_MULTIPLIER=1.4
//   MAFITAPAY_SWEEP_BASE_GAS_BUFFER=0.00003
//   MAFITAPAY_SWEEP_BSC_GAS_BUFFER=0.00003
//   MAFITAPAY_SWEEP_POL_GAS_BUFFER=0.01
//   MAFITAPAY_SWEEP_TON_GAS_BUFFER=0.05
//   MAFITAPAY_SWEEP_SOLANA_GAS_BUFFER=1000000
//   MAFITAPAY_SWEEP_SOLANA_TOKEN_TOPUP=3000000
//   MAFITAPAY_SWEEP_SUI_GAS_BUFFER=60000000
//   MAFITAPAY_SWEEP_NEAR_GAS_BUFFER=50000000000000000000000
//   MAFITAPAY_SWEEP_MIN_EVM_GAS=0.00001
//   MAFITAPAY_SWEEP_POLYGON_TOKEN_TOPUP=0.01
//   (and similar for *_TOKEN_TOPUP on base/bsc)

const EVM_GAS_SAFETY_MULTIPLIER = Number(process.env.MAFITAPAY_SWEEP_EVM_GAS_MULTIPLIER ?? '1.5')
const SUI_GAS_SAFETY_MULTIPLIER = Number(process.env.MAFITAPAY_SWEEP_SUI_GAS_MULTIPLIER ?? '1.4')

const BASE_GAS_BUFFER_WEI = parseUnits(process.env.MAFITAPAY_SWEEP_BASE_GAS_BUFFER ?? '0.00003', 18)
const BSC_GAS_BUFFER_WEI = parseUnits(process.env.MAFITAPAY_SWEEP_BSC_GAS_BUFFER ?? '0.00003', 18)
const POL_GAS_BUFFER_WEI = parseUnits(process.env.MAFITAPAY_SWEEP_POL_GAS_BUFFER ?? '0.01', 18)
const POLYGON_TOKEN_GAS_TOPUP_WEI = parseUnits(process.env.MAFITAPAY_SWEEP_POLYGON_TOKEN_TOPUP ?? '0.01', 18)

const TON_GAS_BUFFER_NANO = toNano(process.env.MAFITAPAY_SWEEP_TON_GAS_BUFFER ?? '0.05')

const SOLANA_GAS_BUFFER_LAMPORTS = BigInt(process.env.MAFITAPAY_SWEEP_SOLANA_GAS_BUFFER ?? '1000000')
const SOLANA_TOKEN_SWEEP_GAS_TOPUP_LAMPORTS = BigInt(process.env.MAFITAPAY_SWEEP_SOLANA_TOKEN_TOPUP ?? '3000000')

const BASE_TOKEN_GAS_TOPUP_WEI = parseUnits(process.env.MAFITAPAY_SWEEP_BASE_TOKEN_TOPUP ?? '0.00002', 18)
const BSC_TOKEN_GAS_TOPUP_WEI = parseUnits(process.env.MAFITAPAY_SWEEP_BSC_TOKEN_TOPUP ?? '0.00002', 18)

const SUI_GAS_BUFFER_MIST = BigInt(process.env.MAFITAPAY_SWEEP_SUI_GAS_BUFFER ?? '60000000')
const NEAR_GAS_BUFFER_YOCTO = BigInt(process.env.MAFITAPAY_SWEEP_NEAR_GAS_BUFFER ?? '50000000000000000000000')

const MIN_EVM_GAS_BUFFER_WEI = parseUnits(process.env.MAFITAPAY_SWEEP_MIN_EVM_GAS ?? '0.00001', 18)

export interface SweepGasStat {
  timestamp: string
  pairId: string
  received: string
  reserved: string
  sent: string
  chain?: string
}

const recentSweepGasStats: SweepGasStat[] = []
const MAX_RECENT_SWEEP_STATS = 30

function recordSweepGasStat(stat: Omit<SweepGasStat, 'timestamp'>) {
  recentSweepGasStats.unshift({
    timestamp: new Date().toISOString(),
    ...stat,
  })
  if (recentSweepGasStats.length > MAX_RECENT_SWEEP_STATS) {
    recentSweepGasStats.length = MAX_RECENT_SWEEP_STATS
  }
}

export function getRecentSweepGasStats(): SweepGasStat[] {
  return [...recentSweepGasStats]
}

type SweepAsset = {
  chain: 'base' | 'bsc' | 'polygon' | 'ton' | 'solana' | 'sui' | 'near'
  pairId: CryptoOrder['pairId']
  kind: 'erc20' | 'native'
  tokenAddress?: Address
  gasBufferWei: bigint
  tokenGasTopupWei: bigint
}

function createBaseClientsFromPrivateKey(privateKey: Hex) {
  const config = getBaseExecutorConfig()
  const transport = config.rpcUrls.length > 1
    ? fallback(config.rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(config.rpcUrl, { retryCount: 1, timeout: 10_000 })
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    config,
    publicClient: createPublicClient({ chain: base, transport }),
    walletClient: createWalletClient({
      account,
      chain: base,
      transport,
      dataSuffix: getBaseBuilderDataSuffix(),
    }),
  }
}

function createBscClientsFromPrivateKey(privateKey: Hex) {
  const config = getBscExecutorConfig()
  const transport = config.rpcUrls.length > 1
    ? fallback(config.rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(config.rpcUrl, { retryCount: 1, timeout: 10_000 })
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    config,
    publicClient: createPublicClient({ chain: bsc, transport }),
    walletClient: createWalletClient({ account, chain: bsc, transport }),
  }
}

function createPolygonClientsFromPrivateKey(privateKey: Hex) {
  let raw = (process.env.MAFITAPAY_POLYGON_RPC_URLS?.trim() || process.env.MAFITAPAY_POLYGON_RPC_URL?.trim() || '')
  if (!raw) {
    const alchemyKey = process.env.ALCHEMY_API_KEY?.trim()
    if (alchemyKey) {
      raw = `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
    } else {
      raw = 'https://rpc.ankr.com/polygon'
    }
  }
  let rpcUrls = raw.split(',').map(item => item.trim()).filter(Boolean)
  const BROKEN_POLYGON_DEFAULT = 'https://polygon-rpc.com'
  if (rpcUrls.length > 1) {
    rpcUrls = rpcUrls.filter(u => !u.toLowerCase().includes('polygon-rpc.com'))
    if (rpcUrls.length === 0) rpcUrls = [BROKEN_POLYGON_DEFAULT]
  }
  const transport = rpcUrls.length > 1
    ? fallback(rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(rpcUrls[0] || 'https://rpc.ankr.com/polygon', { retryCount: 1, timeout: 10_000 })
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    publicClient: createPublicClient({ chain: polygon, transport }),
    walletClient: createWalletClient({ account, chain: polygon, transport }),
  }
}

/**
 * Best-practice hybrid gas reserve calculator for EVM sweeps.
 * Real estimateGas + current gas price + safety margin,
 * but never below a conservative minimum floor.
 */
async function calculateEvmGasReserve(
  publicClient: any, // viem PublicClient with chain-specific types — we use any to keep the hybrid logic simple across base/bsc/polygon creators
  tx: { to: Address; value?: bigint; data?: Hex; account: Address }
): Promise<bigint> {
  try {
    const gasLimit = await publicClient.estimateGas(tx)
    const gasPrice = await publicClient.getGasPrice().catch(() => BigInt(0))
    const estimatedCost = gasLimit * gasPrice
    const withMargin = (estimatedCost * BigInt(Math.floor(EVM_GAS_SAFETY_MULTIPLIER * 100))) / BigInt(100)

    return withMargin > MIN_EVM_GAS_BUFFER_WEI ? withMargin : MIN_EVM_GAS_BUFFER_WEI
  } catch (err) {
    console.warn('[crypto-deposit-sweeper] EVM gas estimation failed, using safe fallback buffer:', err)
    return MIN_EVM_GAS_BUFFER_WEI * BigInt(2)
  }
}

/**
 * Light dynamic improvement for Solana (worth it for completeness).
 * Base buffer + small dynamic component from recent prioritization fees.
 * Keeps things simple and cheap.
 */
async function getSolanaEffectiveGasBuffer(connection: Connection, isToken: boolean): Promise<bigint> {
  const base = isToken ? SOLANA_TOKEN_SWEEP_GAS_TOPUP_LAMPORTS : SOLANA_GAS_BUFFER_LAMPORTS

  try {
    const recent = await connection.getRecentPrioritizationFees({ limit: 10 })
    if (!recent.length) return base

    // Take a conservative percentile of recent priority fees (in micro-lamports per CU)
    const fees = recent.map(r => r.prioritizationFee).sort((a, b) => a - b)
    const p80 = fees[Math.floor(fees.length * 0.8)] || 0

    // Rough: a simple transfer uses ~ few hundred CUs. We add a tiny dynamic priority bump.
    const dynamicExtra = BigInt(Math.min(p80 * 300, 2_000_000)) // cap the extra

    return base + dynamicExtra
  } catch (err) {
    console.warn('[crypto-deposit-sweeper] Solana priority fee lookup failed, using base buffer:', err)
    return base
  }
}

async function createTonSweepFromMnemonic(mnemonic: string) {
  const words = mnemonic.trim().split(/\s+/)
  if (words.length !== 24) {
    throw new Error('TON deposit secret must be a 24-word mnemonic.')
  }
  const keyPair = await mnemonicToPrivateKey(words)
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })
  const config = getTonExecutorConfig()
  const httpAdapter = createTonHttpAdapter() as any
  const tonClient = new TonClient({
    endpoint: config.rpcUrl,
    apiKey: config.apiKeyConfigured ? config.apiKey : undefined,
    timeout: 12_000,
    httpAdapter,
  })
  const contract = tonClient.open(wallet)
  return {
    keyPair,
    wallet,
    tonClient,
    contract,
    depositAddress: wallet.address.toString({ bounceable: false, urlSafe: true }),
  }
}

function parseSolanaKeypairSecret(secret: string) {
  const trimmed = secret.trim()
  let decoded: Uint8Array
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as number[]
    decoded = Uint8Array.from(parsed)
  } else {
    decoded = base58.decode(trimmed)
  }

  if (decoded.length === 32) return Keypair.fromSeed(decoded)
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded)
  throw new Error('Solana private key must be a 32-byte seed or 64-byte secret key.')
}

async function createSolanaSweepFromSecret(secret: string) {
  const keypair = parseSolanaKeypairSecret(secret)
  const conn = new Connection(process.env.MAFITAPAY_SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com', 'confirmed')
  return {
    keypair,
    connection: conn,
    publicKey: keypair.publicKey,
  }
}

function parseSuiKeypairSecret(secret: string) {
  const trimmed = secret.trim()
  // getSecretKey() from generation or env string may be raw bytes as array-string, base64, or the suiprivkey format.
  try {
    if (trimmed.startsWith('suiprivkey') || trimmed.length > 60) {
      return Ed25519Keypair.fromSecretKey(trimmed)
    }
    if (trimmed.startsWith('[')) {
      const bytes = Uint8Array.from(JSON.parse(trimmed))
      return Ed25519Keypair.fromSecretKey(bytes)
    }
    // try base64 or hex
    let bytes: Uint8Array
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length >= 64) {
      bytes = Uint8Array.from(Buffer.from(trimmed, 'hex'))
    } else {
      bytes = Uint8Array.from(Buffer.from(trimmed, 'base64'))
    }
    if (bytes.length === 32 || bytes.length === 64) {
      return Ed25519Keypair.fromSecretKey(bytes)
    }
    return Ed25519Keypair.fromSecretKey(trimmed as any)
  } catch {
    return Ed25519Keypair.fromSecretKey(trimmed as any)
  }
}

function parseNearKeypairSecret(secret: string): KeyPair {
  const trimmed = secret.trim()
  if (trimmed.includes(':')) {
    return KeyPair.fromString(trimmed as any)
  }
  try {
    return KeyPair.fromString(`ed25519:${trimmed}` as any)
  } catch {
    return KeyPair.fromString(trimmed as any)
  }
}

function createSuiScannerClientForSweep() {
  const raw = (process.env.MAFITAPAY_SUI_RPC_URLS?.trim() || process.env.MAFITAPAY_SUI_RPC_URL?.trim() || 'https://fullnode.mainnet.sui.io:443')
  const url = raw.split(',')[0].trim() || 'https://fullnode.mainnet.sui.io:443'
  return new SuiJsonRpcClient({ network: 'mainnet', url })
}

function createNearSweepProvider() {
  let raw = (process.env.MAFITAPAY_NEAR_RPC_URLS?.trim() || process.env.MAFITAPAY_NEAR_RPC_URL?.trim() || '')
  let urls: string[] = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
  const shorthand: Record<string, string> = {
    'https://fastnear.com': 'https://free.rpc.fastnear.com',
    'http://fastnear.com': 'https://free.rpc.fastnear.com',
  }
  urls = urls.map((u) => shorthand[u] || u)
  if (urls.length === 0) urls = ['https://near.drpc.org', 'https://near.lava.build']
  if (urls.length > 1) {
    return new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url })))
  }
  return new JsonRpcProvider({ url: urls[0] })
}

async function getSolanaTreasuryKeypair() {
  const secret = process.env.MAFITAPAY_SOLANA_EXECUTOR_PRIVATE_KEY?.trim()
  if (!secret) return null
  return parseSolanaKeypairSecret(secret)
}

function getSweepAsset(pairId: CryptoOrder['pairId']): SweepAsset | null {
  const baseConfig = getBaseExecutorConfig()
  const bscConfig = getBscExecutorConfig()

  if (pairId === 'USDC_BASE') {
    return {
      chain: 'base',
      pairId,
      kind: 'erc20',
      tokenAddress: baseConfig.usdcAddress,
      gasBufferWei: BASE_GAS_BUFFER_WEI,
      tokenGasTopupWei: BASE_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'ETH_BASE') {
    return {
      chain: 'base',
      pairId,
      kind: 'native',
      gasBufferWei: BASE_GAS_BUFFER_WEI,
      tokenGasTopupWei: BASE_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'USDT_BSC') {
    return {
      chain: 'bsc',
      pairId,
      kind: 'erc20',
      tokenAddress: bscConfig.usdtAddress,
      gasBufferWei: BSC_GAS_BUFFER_WEI,
      tokenGasTopupWei: BSC_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'BNB_BSC') {
    return {
      chain: 'bsc',
      pairId,
      kind: 'native',
      gasBufferWei: BSC_GAS_BUFFER_WEI,
      tokenGasTopupWei: BSC_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'POL_POLYGON') {
    return {
      chain: 'polygon',
      pairId,
      kind: 'native',
      gasBufferWei: POL_GAS_BUFFER_WEI,
      tokenGasTopupWei: parseUnits('0', 18),
    }
  }

  if (pairId === 'USDC_POLYGON') {
    return {
      chain: 'polygon',
      pairId,
      kind: 'erc20',
      tokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as any,
      gasBufferWei: POL_GAS_BUFFER_WEI,
      tokenGasTopupWei: POLYGON_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'USDT_POLYGON') {
    return {
      chain: 'polygon',
      pairId,
      kind: 'erc20',
      tokenAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as any,
      gasBufferWei: POL_GAS_BUFFER_WEI,
      tokenGasTopupWei: POLYGON_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'TON_TON') {
    return {
      chain: 'ton',
      pairId,
      kind: 'native',
      gasBufferWei: TON_GAS_BUFFER_NANO,
      tokenGasTopupWei: toNano('0'),
    }
  }

  if (pairId === 'SOL_SOLANA') {
    return {
      chain: 'solana',
      pairId,
      kind: 'native',
      gasBufferWei: SOLANA_GAS_BUFFER_LAMPORTS,
      tokenGasTopupWei: BigInt(0),
    }
  }

  if (pairId === 'USDC_SOLANA') {
    return {
      chain: 'solana',
      pairId,
      kind: 'erc20',
      tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as any,
      gasBufferWei: SOLANA_GAS_BUFFER_LAMPORTS,
      tokenGasTopupWei: BigInt(0),
    }
  }

  if (pairId === 'SUI_SUI') {
    return {
      chain: 'sui',
      pairId,
      kind: 'native',
      gasBufferWei: SUI_GAS_BUFFER_MIST,
      tokenGasTopupWei: BigInt(0),
    }
  }

  if (pairId === 'NEAR_NEAR') {
    return {
      chain: 'near',
      pairId,
      kind: 'native',
      gasBufferWei: NEAR_GAS_BUFFER_YOCTO,
      tokenGasTopupWei: BigInt(0),
    }
  }

  return null
}

async function ensureTokenSweepGas(input: {
  asset: SweepAsset
  depositAddress: Address
}) {
  // For EVM chains we now use dynamic estimation (best practice)
  // but still respect a minimum top-up floor.
  if (input.asset.chain === 'base' || input.asset.chain === 'bsc' || input.asset.chain === 'polygon') {
    const config = input.asset.chain === 'base'
      ? getBaseExecutorConfig()
      : input.asset.chain === 'bsc'
        ? getBscExecutorConfig()
        : { privateKey: process.env.MAFITAPAY_POLYGON_EXECUTOR_PRIVATE_KEY?.trim() as Hex | undefined }

    if (!config.privateKey) {
      throw new Error(`MAFITAPAY_${input.asset.chain.toUpperCase()}_EXECUTOR_PRIVATE_KEY is required for token sweep gas top-up.`)
    }

    const clients = input.asset.chain === 'base'
      ? createBaseClientsFromPrivateKey(config.privateKey)
      : input.asset.chain === 'bsc'
        ? createBscClientsFromPrivateKey(config.privateKey)
        : createPolygonClientsFromPrivateKey(config.privateKey as Hex)

    const balance = await clients.publicClient.getBalance({ address: input.depositAddress })

    // Dynamic estimate for a simple ETH transfer (the top-up tx itself)
    const dynamicTopup = await calculateEvmGasReserve(clients.publicClient, {
      to: input.depositAddress,
      value: BigInt(1), // dummy small value for estimation
      account: clients.account.address,
    })

    const neededTopup = dynamicTopup > input.asset.tokenGasTopupWei ? dynamicTopup : input.asset.tokenGasTopupWei

    if (balance >= neededTopup) return null

    const hash = await clients.walletClient.sendTransaction({
      account: clients.account,
      chain: input.asset.chain === 'base' ? base : input.asset.chain === 'bsc' ? bsc : polygon,
      to: input.depositAddress,
      value: neededTopup,
    })
    await clients.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  // ton native also no gas topup from treasury (deposit pays its own)
  return null
}

async function sweepNative(input: {
  asset: SweepAsset
  privateKey: Hex
  treasuryAddress: Address
  amountUnits: bigint
}) {
  if (input.asset.chain === 'base' || input.asset.chain === 'bsc' || input.asset.chain === 'polygon') {
    const clients = input.asset.chain === 'base'
      ? createBaseClientsFromPrivateKey(input.privateKey)
      : input.asset.chain === 'bsc'
        ? createBscClientsFromPrivateKey(input.privateKey)
        : createPolygonClientsFromPrivateKey(input.privateKey)

    // Best hybrid approach: use real estimation + safety margin, fall back to floor
    const dynamicReserve = await calculateEvmGasReserve(clients.publicClient, {
      to: input.treasuryAddress,
      value: input.amountUnits, // upper bound for estimation
      account: clients.account.address,
    })

    const gasReserve = dynamicReserve > input.asset.gasBufferWei ? dynamicReserve : input.asset.gasBufferWei

    if (input.amountUnits <= gasReserve) {
      throw new Error('Native deposit is too small to sweep after reserving gas.')
    }

    const value = input.amountUnits - gasReserve
    recordSweepGasStat({
      pairId: input.asset.pairId,
      received: input.amountUnits.toString(),
      reserved: gasReserve.toString(),
      sent: value.toString(),
      chain: input.asset.chain,
    })
    console.log(`[crypto-deposit-sweeper] EVM sweep gas-reserve pair=${input.asset.pairId} received=${input.amountUnits} reserved=${gasReserve} sent=${value}`)

    return clients.walletClient.sendTransaction({
      account: clients.account,
      chain: input.asset.chain === 'base' ? base : input.asset.chain === 'bsc' ? bsc : polygon,
      to: input.treasuryAddress,
      value,
    })
  }

  // Non-EVM native (TON / Solana / Sui / Near handled in their own dedicated functions)
  // We treat the per-asset gasBufferWei as a hard minimum floor.
  if (input.amountUnits <= input.asset.gasBufferWei) {
    throw new Error('Native deposit is too small to sweep after reserving gas.')
  }

  const value = input.amountUnits - input.asset.gasBufferWei

  // This path is only for legacy EVM calls that fell through — in practice EVM is handled above.
  const clients = createPolygonClientsFromPrivateKey(input.privateKey)
  return clients.walletClient.sendTransaction({ account: clients.account, chain: polygon, to: input.treasuryAddress, value })
}

async function sweepTonNative(input: {
  mnemonic: string
  treasuryAddress: string
  amountUnits: bigint
}) {
  const gasBuffer = TON_GAS_BUFFER_NANO
  if (input.amountUnits <= gasBuffer) {
    throw new Error('Native TON deposit is too small to sweep after reserving gas.')
  }

  const value = input.amountUnits - gasBuffer
  const sweep = await createTonSweepFromMnemonic(input.mnemonic)
  const seqno = await sweep.contract.getSeqno()
  await sweep.contract.sendTransfer({
    seqno,
    secretKey: sweep.keyPair.secretKey,
    messages: [internal({
      to: TonAddress.parse(input.treasuryAddress),
      value: value,
      bounce: true,
    })],
  })
  // TON sendTransfer is async fire, no immediate hash. Use a pseudo identifier based on seqno.
  // In practice, the tx can be looked up via toncenter or ston using the wallet + seqno.
  // For the deposit event, we record this pseudo as sweepTxHash.
  const pseudoHash = `ton-sweep-seq${seqno}-${Date.now().toString(36)}`
  return pseudoHash
}

async function sweepSolanaNative(input: {
  secret: string
  treasuryAddress: string
  amountUnits: bigint
  isToken?: boolean // for USDC
  mint?: string
}) {
  const sweep = await createSolanaSweepFromSecret(input.secret)
  const fromPubkey = sweep.publicKey
  const toPubkey = new PublicKey(input.treasuryAddress)

  // Use light dynamic buffer for Solana (base + recent priority fees)
  const effectiveBuffer = await getSolanaEffectiveGasBuffer(sweep.connection, !!input.isToken)

  let transaction: Transaction
  if (input.isToken && input.mint) {
    const value = input.amountUnits
    if (value <= BigInt(0)) {
      throw new Error('Token Solana deposit is too small to sweep.')
    }
    await ensureSolanaSweepGas({
      connection: sweep.connection,
      depositPublicKey: fromPubkey,
    })
    const mintPubkey = new PublicKey(input.mint)
    const fromAta = getAssociatedTokenAddressSync(mintPubkey, fromPubkey)
    const toAta = getAssociatedTokenAddressSync(mintPubkey, toPubkey)

    transaction = new Transaction()
    const toAtaInfo = await sweep.connection.getAccountInfo(toAta)
    if (!toAtaInfo) {
      transaction.add(createAssociatedTokenAccountInstruction(
        fromPubkey,
        toAta,
        toPubkey,
        mintPubkey,
      ))
    }
    transaction.add(
      createTransferInstruction(fromAta, toAta, fromPubkey, value)
    )
  } else {
    if (input.amountUnits <= effectiveBuffer) {
      throw new Error('Native Solana deposit is too small to sweep after reserving gas.')
    }
    const value = input.amountUnits - effectiveBuffer
    transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: Number(value),
      })
    )
  }

  const { blockhash } = await sweep.connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = blockhash
  transaction.feePayer = fromPubkey
  transaction.sign(sweep.keypair)

  const signature = await sweep.connection.sendRawTransaction(transaction.serialize())
  await sweep.connection.confirmTransaction(signature, 'confirmed')

  const sentSol = input.isToken ? input.amountUnits : (input.amountUnits - effectiveBuffer)
  recordSweepGasStat({
    pairId: input.isToken ? 'USDC_SOLANA' : 'SOL_SOLANA',
    received: input.amountUnits.toString(),
    reserved: effectiveBuffer.toString(),
    sent: sentSol.toString(),
    chain: 'solana',
  })
  console.log(`[crypto-deposit-sweeper] Solana sweep gas-reserve pair=${input.isToken ? 'USDC_SOLANA' : 'SOL_SOLANA'} received=${input.amountUnits} effectiveBuffer=${effectiveBuffer} sent=${sentSol}`)
  return signature
}

async function sweepSuiNative(input: {
  secret: string
  treasuryAddress: string
  amountUnits: bigint
}) {
  const depositKeypair = parseSuiKeypairSecret(input.secret)
  const depositAddress = depositKeypair.getPublicKey().toSuiAddress()
  const client = createSuiScannerClientForSweep()

  // Hybrid: try to get a better gas budget via dry-run when possible
  let gasReserve = SUI_GAS_BUFFER_MIST
  try {
    const tx = new SuiTransaction()
    tx.setSender(depositAddress)
    tx.setGasBudget(50_000_000)
    const [sendCoin] = tx.splitCoins(tx.gas, [input.amountUnits - SUI_GAS_BUFFER_MIST])
    tx.transferObjects([sendCoin], input.treasuryAddress)

    const dryRun = await client.dryRunTransactionBlock({
      transactionBlock: tx,
      sender: depositAddress,
    } as any).catch(() => null)

    if (dryRun?.effects?.gasUsed) {
      const gasUsed = BigInt(dryRun.effects.gasUsed.computationCost || 0) +
                      BigInt(dryRun.effects.gasUsed.storageCost || 0) -
                      BigInt(dryRun.effects.gasUsed.storageRebate || 0)
      const multiplier = BigInt(Math.floor(SUI_GAS_SAFETY_MULTIPLIER * 100))
      const withMargin = (gasUsed * multiplier) / BigInt(100)
      if (withMargin > gasReserve) gasReserve = withMargin
      if (withMargin > gasReserve) gasReserve = withMargin
    }
  } catch {
    // dry-run failed — stick with the safe hardcoded floor
  }

  if (input.amountUnits <= gasReserve) {
    throw new Error('Sui deposit is too small to sweep after reserving gas.')
  }
  const toSend = input.amountUnits - gasReserve
  recordSweepGasStat({
    pairId: 'SUI_SUI',
    received: input.amountUnits.toString(),
    reserved: gasReserve.toString(),
    sent: toSend.toString(),
    chain: 'sui',
  })
  console.log(`[crypto-deposit-sweeper] Sui sweep gas-reserve pair=SUI_SUI received=${input.amountUnits} reserved=${gasReserve} sent=${toSend}`)

  // Fetch owned SUI coins...
  const coinsResp = await client.getCoins({ owner: depositAddress, coinType: '0x2::sui::SUI', limit: 50 })
  const coins = coinsResp.data || []
  if (coins.length === 0) {
    const balance = await client.getBalance({ owner: depositAddress })
    if (BigInt(balance.totalBalance) < toSend + gasReserve) {
      throw new Error('No SUI coins or insufficient balance to sweep on Sui deposit address.')
    }
  }

  const tx = new SuiTransaction()
  tx.setSender(depositAddress)
  tx.setGasBudget(Number(gasReserve) + 10_000_000) // give a bit extra headroom

  if (coins.length > 0) {
    const primary = coins[0].coinObjectId
    const [sendCoin] = tx.splitCoins(primary, [toSend])
    tx.transferObjects([sendCoin], input.treasuryAddress)
  } else {
    const [sendCoin] = tx.splitCoins(tx.gas, [toSend])
    tx.transferObjects([sendCoin], input.treasuryAddress)
  }

  const result = await client.signAndExecuteTransaction({
    signer: depositKeypair,
    transaction: tx,
  })
  const hash = (result as any).digest || (result as any).txDigest || 'sui-sweep-digest-missing'
  return String(hash)
}

async function sweepNearNative(input: {
  secret: string
  treasuryAddress: string
  amountUnits: bigint
}) {
  const keyPair = parseNearKeypairSecret(input.secret)
  const pubKey = keyPair.getPublicKey()
  // NEAR implicit account id (as produced by keyToImplicitAddress in provisioning) is the lowercase hex of the 32-byte ed25519 public key.
  const pubBytes: Uint8Array = (pubKey as any).data || (pubKey as any).toBytes?.() || new Uint8Array(32)
  const implicitAccountId = Array.from(pubBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const provider = createNearSweepProvider()
  const depositAccount = new Account(implicitAccountId, provider, keyPair.toString() as any)

  const gasBuffer = NEAR_GAS_BUFFER_YOCTO
  if (input.amountUnits <= gasBuffer) {
    throw new Error('Native NEAR deposit is too small to sweep after reserving gas.')
  }
  const value = input.amountUnits - gasBuffer

  let transferResult: unknown
  try {
    transferResult = await depositAccount.transfer({
      receiverId: input.treasuryAddress,
      amount: value,
      token: NEAR,
    })
  } catch (error) {
    throw new Error(`NEAR native sweep transfer failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const txHash =
    (transferResult as any)?.transaction_outcome?.id ||
    (transferResult as any)?.transaction?.hash ||
    (typeof transferResult === 'string' ? transferResult : `near-sweep-${Date.now()}`)
  return String(txHash)
}

async function ensureSolanaSweepGas(input: {
  connection: Connection
  depositPublicKey: PublicKey
}) {
  const balance = BigInt(await input.connection.getBalance(input.depositPublicKey, 'confirmed'))
  if (balance >= SOLANA_TOKEN_SWEEP_GAS_TOPUP_LAMPORTS) return null

  const treasuryKeypair = await getSolanaTreasuryKeypair()
  if (!treasuryKeypair) {
    throw new Error('MAFITAPAY_SOLANA_EXECUTOR_PRIVATE_KEY is required to top up token sweep gas.')
  }

  const topupAmount = SOLANA_TOKEN_SWEEP_GAS_TOPUP_LAMPORTS - balance
  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: treasuryKeypair.publicKey,
    toPubkey: input.depositPublicKey,
    lamports: Number(topupAmount),
  }))
  return sendAndConfirmTransaction(input.connection, transaction, [treasuryKeypair], { commitment: 'confirmed' })
}

async function sweepErc20(input: {
  asset: SweepAsset
  privateKey: Hex
  depositAddress: Address
  treasuryAddress: Address
  amountUnits: bigint
}) {
  if (!input.asset.tokenAddress) throw new Error('Token contract is missing for sweep.')
  await ensureTokenSweepGas({ asset: input.asset, depositAddress: input.depositAddress })

  if (input.asset.chain === 'base') {
    const clients = createBaseClientsFromPrivateKey(input.privateKey)
    return clients.walletClient.writeContract({
      account: clients.account,
      chain: base,
      address: input.asset.tokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [input.treasuryAddress, input.amountUnits],
    })
  }

  if (input.asset.chain === 'bsc') {
    const clients = createBscClientsFromPrivateKey(input.privateKey)
    return clients.walletClient.writeContract({
      account: clients.account,
      chain: bsc,
      address: input.asset.tokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [input.treasuryAddress, input.amountUnits],
    })
  }

  const clients = createPolygonClientsFromPrivateKey(input.privateKey)
  return clients.walletClient.writeContract({
    account: clients.account,
    chain: polygon,
    address: input.asset.tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [input.treasuryAddress, input.amountUnits],
  })
}

export async function sweepCryptoDepositEvent(event: CryptoDepositEvent) {
  console.log(`[crypto-deposit-sweeper] sweepCryptoDepositEvent called for event=${event.externalEventId} pair=${event.pairId} status=${event.status} sweepStatus=${event.sweepStatus}`)
  if (event.status !== 'matched') {
    console.log(`[crypto-deposit-sweeper] skip sweep: not matched (status=${event.status})`)
    return { swept: false, reason: 'event_not_matched' }
  }
  if (event.sweepStatus === 'swept') {
    console.log(`[crypto-deposit-sweeper] skip sweep: already swept tx=${event.sweepTxHash}`)
    return { swept: false, reason: 'already_swept', txHash: event.sweepTxHash }
  }

  const claimed = await claimCryptoDepositEventSweep(event.externalEventId)
  if (!claimed) {
    console.log(`[crypto-deposit-sweeper] skip sweep: claim failed for ${event.externalEventId}`)
    return { swept: false, reason: 'not_claimed' }
  }

  try {
    console.log(`[crypto-deposit-sweeper] attempting sweep for event=${event.externalEventId} pair=${event.pairId} amount=${event.amountUnits}`)
    const asset = getSweepAsset(event.pairId)
    if (!asset) {
      console.warn(`[crypto-deposit-sweeper] unsupported pairId for sweep: ${event.pairId} (event=${event.externalEventId})`)
      throw new Error(`${event.pairId} is not supported for auto sweep yet.`)
    }

    const secret = await getCryptoDepositAddressSecretById(event.addressId)
    if (!secret) throw new Error('Deposit address secret is unavailable for sweep.')

    const family = secret.record.addressFamily
    let depositAddressStr = secret.record.address
    let privateKeyForEvm: Hex | undefined
    let mnemonicForTon: string | undefined

    if (family === 'evm' || asset.chain === 'base' || asset.chain === 'bsc' || asset.chain === 'polygon') {
      privateKeyForEvm = secret.secret.trim() as Hex
      const depositAccount = privateKeyToAccount(privateKeyForEvm)
      const depositAddress = getAddress(secret.record.address)
      if (depositAccount.address.toLowerCase() !== depositAddress.toLowerCase()) {
        throw new Error('Deposit address private key does not match the stored address.')
      }
      depositAddressStr = depositAddress
    } else if (family === 'ton' || asset.chain === 'ton') {
      mnemonicForTon = secret.secret.trim()
      // verify later in sweep
    } else if (family === 'solana' || asset.chain === 'solana') {
      // Solana secrets are handled by parseSolanaKeypairSecret during sweep.
    } else if (family === 'sui' || asset.chain === 'sui') {
      // Sui secrets handled by parseSuiKeypairSecret in sweepSuiNative.
    } else if (family === 'near' || asset.chain === 'near') {
      // Near secrets handled by parseNearKeypairSecret in sweepNearNative.
    } else {
      throw new Error(`Sweep not supported for address family ${family} yet.`)
    }

    let treasuryAddress: string | Address
    if (asset.chain === 'base') {
      treasuryAddress = getBaseExecutorConfig().configuredAddress
    } else if (asset.chain === 'bsc') {
      const config = getBscExecutorConfig()
      if (config.configuredAddress) treasuryAddress = config.configuredAddress
      else if (!config.privateKey) throw new Error('MAFITAPAY_BSC_EXECUTOR_PRIVATE_KEY is required to resolve BSC treasury address.')
      else treasuryAddress = privateKeyToAccount(config.privateKey).address
    } else if (asset.chain === 'polygon') {
      const addr = process.env.MAFITAPAY_POLYGON_EXECUTOR_ADDRESS?.trim()
      if (addr) treasuryAddress = getAddress(addr)
      else {
        const pk = process.env.MAFITAPAY_POLYGON_EXECUTOR_PRIVATE_KEY?.trim() as Hex | undefined
        if (!pk) throw new Error('MAFITAPAY_POLYGON_EXECUTOR_PRIVATE_KEY or ADDRESS is required to resolve Polygon treasury address.')
        treasuryAddress = privateKeyToAccount(pk).address
      }
    } else if (asset.chain === 'ton') {
      const addr = process.env.MAFITAPAY_TON_EXECUTOR_ADDRESS?.trim()
      if (addr) {
        treasuryAddress = TonAddress.parse(addr).toString({ bounceable: false, urlSafe: true })
      } else {
        throw new Error('MAFITAPAY_TON_EXECUTOR_ADDRESS is required to resolve TON treasury address.')
      }
    } else if (asset.chain === 'solana') {
      const addr = process.env.MAFITAPAY_SOLANA_EXECUTOR_ADDRESS?.trim()
      if (addr) {
        treasuryAddress = addr // base58 pubkey
      } else {
        throw new Error('MAFITAPAY_SOLANA_EXECUTOR_ADDRESS is required to resolve Solana treasury address.')
      }
    } else if (asset.chain === 'sui') {
      const addr = process.env.MAFITAPAY_SUI_TREASURY_ADDRESS?.trim()
      if (addr) {
        treasuryAddress = addr
      } else {
        throw new Error('MAFITAPAY_SUI_TREASURY_ADDRESS is required to resolve Sui treasury address for sweeps.')
      }
    } else if (asset.chain === 'near') {
      const addr = process.env.MAFITAPAY_NEAR_TREASURY_ACCOUNT_ID?.trim()
      if (addr) {
        treasuryAddress = addr
      } else {
        throw new Error('MAFITAPAY_NEAR_TREASURY_ACCOUNT_ID is required to resolve NEAR treasury account for sweeps.')
      }
    } else {
      throw new Error(`No treasury resolution for chain ${asset.chain}`)
    }
    const amountUnits = BigInt(event.amountUnits)
    let hash: any
    if (asset.chain === 'solana') {
      const isToken = asset.pairId === 'USDC_SOLANA'
      const mint = isToken ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : undefined
      hash = await sweepSolanaNative({
        secret: secret.secret,
        treasuryAddress: treasuryAddress as string,
        amountUnits,
        isToken,
        mint,
      })
    } else if (asset.chain === 'sui') {
      hash = await sweepSuiNative({
        secret: secret.secret,
        treasuryAddress: treasuryAddress as string,
        amountUnits,
      })
    } else if (asset.chain === 'near') {
      hash = await sweepNearNative({
        secret: secret.secret,
        treasuryAddress: treasuryAddress as string,
        amountUnits,
      })
    } else if (asset.kind === 'erc20') {
      if (!privateKeyForEvm) throw new Error('EVM private key required for ERC20 sweep.')
      hash = await sweepErc20({ asset, privateKey: privateKeyForEvm, depositAddress: getAddress(depositAddressStr), treasuryAddress: getAddress(treasuryAddress as string), amountUnits })
    } else if (asset.chain === 'ton') {
      if (!mnemonicForTon) throw new Error('TON mnemonic required for sweep.')
      // treasuryAddress for ton is string
      hash = await sweepTonNative({ mnemonic: mnemonicForTon, treasuryAddress: treasuryAddress as string, amountUnits })
    } else {
      if (!privateKeyForEvm) throw new Error('EVM private key required for native sweep.')
      hash = await sweepNative({ asset, privateKey: privateKeyForEvm, treasuryAddress: getAddress(treasuryAddress as string), amountUnits })
    }

    await markCryptoDepositEventSwept({
      externalEventId: event.externalEventId,
      txHash: hash,
    })
    console.info('[crypto-deposit-sweeper] swept', JSON.stringify({
      eventId: event.id,
      externalEventId: event.externalEventId,
      pairId: event.pairId,
      amountUnits: event.amountUnits,
      txHash: hash,
      treasuryAddress,
    }))
    return { swept: true, txHash: hash }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sweep failed.'
    await markCryptoDepositEventSweepFailed({
      externalEventId: event.externalEventId,
      error: message,
    })
    console.warn('[crypto-deposit-sweeper] failed', JSON.stringify({
      eventId: event.id,
      externalEventId: event.externalEventId,
      pairId: event.pairId,
      reason: message,
    }))
    return { swept: false, reason: message }
  }
}
