import {
  createPublicClient,
  erc20Abi,
  fallback,
  formatUnits,
  getAddress,
  http,
  parseAbiItem,
  type Address,
} from 'viem'
import { base, bsc, polygon } from 'viem/chains'
import { Address as TonAddress, TonClient } from '@ton/ton'
import { getBaseExecutorConfig } from '@/lib/server/base-executor'
import { getBscExecutorConfig } from '@/lib/server/bsc-executor'
import { sanitizeEvmRpcUrls } from '@/lib/server/evm-rpc'
import { createTonHttpAdapter, getTonExecutorConfig } from '@/lib/server/ton-executor'
import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { FailoverRpcProvider, JsonRpcProvider } from 'near-api-js'
import { sweepCryptoDepositEvent } from '@/lib/server/crypto-deposit-sweeper'
import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  applyWalletMutation,
  createCryptoDepositEvent,
  findPendingCryptoSellOrderForDeposit,
  getCryptoAssets,
  getCryptoDepositEventByExternalId,
  getCryptoDepositAddressByAddress,
  getTransactionById,
  listCryptoDepositAddressesByFamily,
  markCryptoDepositEventMatched,
  markCryptoDepositEventSweepFailed,
  updateCryptoOrderExecution,
  updateCryptoOrderProviderState,
  getLastScannedBlock,
  setLastScannedBlock as persistLastScannedBlock,
} from '@/lib/server/data'
import { formatCrypto, sanitizeUrlForLogs } from '@/lib/utils'
import type { CryptoDepositAddress, CryptoDepositEvent, CryptoOrder } from '@/types'

const SCAN_BLOCK_WINDOW = BigInt(256) // larger window for native EVM deposits (Base ETH etc) to reduce risk of missing txs due to timing/RPC lag in small incremental scans. ERC20 still uses chunked getLogs. For prod prefer dedicated RPCs.
const POLYGON_NATIVE_INITIAL_SCAN_WINDOW = BigInt(
  Number(process.env.MAFITAPAY_POLYGON_NATIVE_INITIAL_SCAN_BLOCKS ?? 900) || 900
)
const WATCHDOG_INTERVAL_MS = 15_000 // more frequent scans so on-chain deposits (especially small test ones) reflect faster in NGN balance. With persisted state + min-recent coverage we avoid excessive RPC load.
const MIN_SYNC_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.MAFITAPAY_CRYPTO_DEPOSIT_SCAN_INTERVAL_MS ?? 15_000) || 15_000
)
const ASSET_SCAN_TIMEOUT_MS = Math.max(
  45_000,
  Number(process.env.MAFITAPAY_CRYPTO_DEPOSIT_ASSET_TIMEOUT_MS ?? 120_000) || 120_000
)
// When the persisted cursor is far behind, scan this many recent blocks so deposits that
// landed while the scanner was stuck are still found (without replaying the entire chain).
const GAP_LOOKBACK_BLOCKS = BigInt(
  Math.max(128, Number(process.env.MAFITAPAY_CRYPTO_DEPOSIT_GAP_LOOKBACK_BLOCKS ?? 512) || 512)
)
// BSC/Polygon/Solana etc. use a smaller catch-up window so one sync cycle does not spend
// 2+ minutes on non-Base chains while you are testing Base deposits locally.
const SECONDARY_GAP_LOOKBACK_BLOCKS = BigInt(
  Math.max(256, Number(process.env.MAFITAPAY_CRYPTO_DEPOSIT_SECONDARY_GAP_LOOKBACK_BLOCKS ?? 512) || 512)
)
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

const DEFAULT_POLYGON_RPC_URL = 'https://rpc.ankr.com/polygon' // fallback only; prefer MAFITAPAY_POLYGON_RPC_URLS with Alchemy

// Control verbose on-chain deposit scanner logs (matched, persistAndSettle etc.)
// Set MAFITAPAY_VERBOSE_DEPOSIT_SCANNER=1 to re-enable full on-chain spam (including TON).
// Default is quiet (TON logger removed) so cex-binance logs and your manual tests stand out.
const VERBOSE_DEPOSIT_SCANNER = process.env.MAFITAPAY_VERBOSE_DEPOSIT_SCANNER === '1'

// Known-dead / permanently unreliable Polygon public RPC hosts.
// We ALWAYS strip these, even if the user has them in MAFITAPAY_POLYGON_RPC_URLS.
// The public Blast API is dead and will never come back.
const DEAD_POLYGON_RPC_HOSTS = [
  'blastapi.io',
  'public.blastapi.io',
  'polygon-rpc.com',
];

export function sanitizePolygonRpcUrls(raw: string): string[] {
  if (!raw?.trim()) return [];
  let urls = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Remove any dead hosts (blast, old polygon-rpc.com, etc.)
  urls = urls.filter(u => {
    const lower = u.toLowerCase();
    return !DEAD_POLYGON_RPC_HOSTS.some(dead => lower.includes(dead));
  });

  return urls;
}
const warnedOnce = new Set<string>()

async function getLogsChunked(
  client: AnyClient,
  baseParams: { address: Address; event: any; fromBlock: bigint; toBlock: bigint },
  chunkSize = BigInt(25)
): Promise<{ logs: any[]; coveredTo: bigint }> {
  const logs: any[] = []
  let current = baseParams.fromBlock
  const { fromBlock: _f, toBlock: _t, ...filter } = baseParams
  let coveredTo = baseParams.fromBlock - BigInt(1)
  let consecutiveFailures = 0
  const MAX_CONSECUTIVE_FAILURES = 5
  while (current <= baseParams.toBlock) {
    const end = current + chunkSize > baseParams.toBlock ? baseParams.toBlock : current + chunkSize
    try {
      const chunk = await client.getLogs({ ...filter, fromBlock: current, toBlock: end })
      logs.push(...chunk)
      consecutiveFailures = 0
      const expected = coveredTo + BigInt(1)
      if (current === expected) {
        coveredTo = end
      }
      // only advance covered for contiguous successful prefix from window start (prevents skipping holes on flaky RPCs)
    } catch (err) {
      consecutiveFailures += 1
      console.warn(`[crypto-deposit-scanner] getLogs chunk ${current}-${end} failed (will continue):`, err instanceof Error ? err.message : err)
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[crypto-deposit-scanner] getLogs aborting after ${MAX_CONSECUTIVE_FAILURES} consecutive chunk failures — check RPC URLs for this chain`)
        break
      }
      // continue; do not advance coveredTo so tail (incl this chunk) gets retried next sync
    }
    current = end + BigInt(1)
  }
  return { logs, coveredTo }
}

type ScanChain = 'base' | 'bsc' | 'polygon' | 'solana' | 'ton' | 'sui' | 'near'
type ScanState = {
  lastBlockByKey: Partial<Record<string, bigint>>
  running: boolean
  interval?: NodeJS.Timeout
  lastSyncAt?: number
}
type SupportedDepositAsset = {
  chain: ScanChain
  pairId: CryptoOrder['pairId']
  network: string
  symbol: string
  decimals: number
  kind: 'erc20' | 'native' | 'spl' | 'jetton' | 'coin' | 'token' // extended for non-EVM
  tokenAddress?: Address | string
}

type AnyClient = ReturnType<typeof createBaseClient> | ReturnType<typeof createBscClient> | ReturnType<typeof createPolygonClient>

declare global {
  var __mafitapayCryptoDepositScanner: ScanState | undefined
}

function getScannerState() {
  if (!globalThis.__mafitapayCryptoDepositScanner) {
    globalThis.__mafitapayCryptoDepositScanner = {
      lastBlockByKey: {},
      running: false,
    }
  }
  return globalThis.__mafitapayCryptoDepositScanner
}

function createBaseClient() {
  const config = getBaseExecutorConfig()
  const transport = config.rpcUrls.length > 1
    ? fallback(config.rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(config.rpcUrl, { retryCount: 1, timeout: 10_000 })
  return createPublicClient({ chain: base, transport })
}

function createBscClient() {
  const config = getBscExecutorConfig()
  const transport = config.rpcUrls.length > 1
    ? fallback(config.rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(config.rpcUrl, { retryCount: 1, timeout: 10_000 })
  return createPublicClient({ chain: bsc, transport })
}

function createPolygonClient() {
  let raw = (process.env.MAFITAPAY_POLYGON_RPC_URLS?.trim() || process.env.MAFITAPAY_POLYGON_RPC_URL?.trim() || '')

  // Drop dead hosts (Blast, llamarpc) and bare Ankr endpoints that now require API keys.
  let rpcUrls = sanitizePolygonRpcUrls(raw)
  const { rpcUrls: sanitized, dropped } = sanitizeEvmRpcUrls(rpcUrls.join(','), DEFAULT_POLYGON_RPC_URL)
  rpcUrls = sanitized.filter((url) => url.startsWith('http'))
  if (dropped.length > 0) {
    console.warn('[crypto-deposit-scanner] dropped invalid Polygon RPC URLs:', dropped.map(url => url.replace(/\/v2\/[^/]+/, '/v2/[REDACTED]')))
  }

  if (rpcUrls.length === 0) {
    // Fall back to Alchemy (preferred) or authenticated Ankr multichain URL from env
    const alchemyKey = process.env.ALCHEMY_API_KEY?.trim()
    const polygonRpc = process.env.MAFITAPAY_POLYGON_RPC_URL?.trim()
    if (alchemyKey) {
      rpcUrls = [`https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`]
    } else if (polygonRpc && polygonRpc.includes('/multichain/')) {
      rpcUrls = [polygonRpc]
    } else {
      rpcUrls = [DEFAULT_POLYGON_RPC_URL]
    }
  }

  const transport = rpcUrls.length > 1
    ? fallback(rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(rpcUrls[0], { retryCount: 1, timeout: 10_000 })

  console.log(`[crypto-deposit-scanner] polygon RPCs configured (after removing dead endpoints incl. Blast): ${rpcUrls.map(sanitizeUrlForLogs).join(' | ')}`)
  return createPublicClient({ chain: polygon, transport })
}

function createTonClient() {
  // Reuse ton executor config for RPC (read-only for deposit scans; no mnemonic needed)
  const config = getTonExecutorConfig()
  const httpAdapter = createTonHttpAdapter() as any
  return new TonClient({
    endpoint: config.rpcUrl,
    apiKey: config.apiKeyConfigured ? config.apiKey : undefined,
    timeout: 12_000,
    httpAdapter,
  })
}

function createSolanaConnection() {
  const rpcUrl = process.env.MAFITAPAY_SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com'
  return new Connection(rpcUrl, 'confirmed')
}

const DEFAULT_SUI_RPC_URL = 'https://fullnode.mainnet.sui.io:443'

function createSuiScannerClient() {
  const raw = (process.env.MAFITAPAY_SUI_RPC_URLS?.trim() || process.env.MAFITAPAY_SUI_RPC_URL?.trim() || DEFAULT_SUI_RPC_URL)
  const url = raw.split(',')[0].trim() || DEFAULT_SUI_RPC_URL
  return new SuiJsonRpcClient({ network: 'mainnet', url })
}

const NEAR_RPC_SHORTHAND_MAP: Record<string, string> = {
  'https://fastnear.com': 'https://free.rpc.fastnear.com',
  'http://fastnear.com': 'https://free.rpc.fastnear.com',
}
const DEFAULT_NEAR_RPC_URLS = ['https://near.drpc.org', 'https://near.lava.build']

function createNearScannerProvider() {
  let raw = (process.env.MAFITAPAY_NEAR_RPC_URLS?.trim() || process.env.MAFITAPAY_NEAR_RPC_URL?.trim() || '')
  let rpcUrls: string[] = []
  if (raw) {
    rpcUrls = raw.split(',').map((s) => s.trim()).filter(Boolean).map((u) => NEAR_RPC_SHORTHAND_MAP[u] || u)
  }
  if (rpcUrls.length === 0) rpcUrls = [...DEFAULT_NEAR_RPC_URLS]
  rpcUrls = [...rpcUrls, ...DEFAULT_NEAR_RPC_URLS]
    .map((u) => NEAR_RPC_SHORTHAND_MAP[u] || u)
    .filter((v, i, a) => a.indexOf(v) === i)
  if (rpcUrls.length > 1) {
    return new FailoverRpcProvider(rpcUrls.map((url) => new JsonRpcProvider({ url })))
  }
  return new JsonRpcProvider({ url: rpcUrls[0] })
}

function getSupportedAssets(): SupportedDepositAsset[] {
  const baseConfig = getBaseExecutorConfig()
  const bscConfig = getBscExecutorConfig()
  const assets: SupportedDepositAsset[] = [
    {
      chain: 'base',
      pairId: 'ETH_BASE',
      network: 'Base',
      symbol: 'ETH',
      decimals: 18,
      kind: 'native',
    },
    {
      chain: 'base',
      pairId: 'USDC_BASE',
      network: 'Base',
      symbol: 'USDC',
      decimals: 6,
      kind: 'erc20',
      tokenAddress: baseConfig.usdcAddress,
    },
    {
      chain: 'bsc',
      pairId: 'BNB_BSC',
      network: 'BSC',
      symbol: 'BNB',
      decimals: 18,
      kind: 'native',
    },
    {
      chain: 'bsc',
      pairId: 'USDT_BSC',
      network: 'BSC',
      symbol: 'USDT',
      decimals: 18,
      kind: 'erc20',
      tokenAddress: bscConfig.usdtAddress,
    },
    {
      chain: 'polygon',
      pairId: 'POL_POLYGON',
      network: 'Polygon',
      symbol: 'POL',
      decimals: 18,
      kind: 'native',
    },
    {
      chain: 'polygon',
      pairId: 'USDC_POLYGON',
      network: 'Polygon',
      symbol: 'USDC',
      decimals: 6,
      kind: 'erc20',
      tokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as any,
    },
    {
      chain: 'polygon',
      pairId: 'USDT_POLYGON',
      network: 'Polygon',
      symbol: 'USDT',
      decimals: 6,
      kind: 'erc20',
      tokenAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as any,
    },
    // Additional Polygon ERC20s and non-EVM fully supported for deposits + sweeps
    {
      chain: 'solana',
      pairId: 'USDC_SOLANA',
      network: 'Solana',
      symbol: 'USDC',
      decimals: 6,
      kind: 'spl',
      tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as any,
    },
    {
      chain: 'solana',
      pairId: 'SOL_SOLANA',
      network: 'Solana',
      symbol: 'SOL',
      decimals: 9,
      kind: 'native',
    },
    {
      chain: 'ton',
      pairId: 'TON_TON',
      network: 'TON',
      symbol: 'TON',
      decimals: 9,
      kind: 'native',
    },
    {
      chain: 'sui',
      pairId: 'SUI_SUI',
      network: 'Sui',
      symbol: 'SUI',
      decimals: 9,
      kind: 'native',
    },
    {
      chain: 'near',
      pairId: 'NEAR_NEAR',
      network: 'NEAR',
      symbol: 'NEAR',
      decimals: 24,
      kind: 'native',
    },
  ]

  const chainOrder = ['base', 'bsc', 'polygon', 'solana', 'ton', 'sui', 'near'] as const
  const kindOrder: Record<SupportedDepositAsset['kind'], number> = {
    native: 0,
    spl: 0,
    coin: 0,
    token: 0,
    jetton: 0,
    erc20: 1,
  }

  return assets.sort((a, b) => {
    const chainDiff = chainOrder.indexOf(a.chain) - chainOrder.indexOf(b.chain)
    if (chainDiff !== 0) return chainDiff
    return kindOrder[a.kind] - kindOrder[b.kind]
  })
}

async function withAssetScanTimeout<T>(label: string, fn: () => Promise<T>) {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${ASSET_SCAN_TIMEOUT_MS}ms`))
        }, ASSET_SCAN_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function buildAddressLookup(addresses: CryptoDepositAddress[]) {
  const lookup = new Map<string, CryptoDepositAddress>()
  for (const item of addresses) {
    try {
      if (item.addressFamily === 'evm') {
        lookup.set(getAddress(item.address).toLowerCase(), item)
      } else {
        // Other families use their native address format (base58 etc); store normalized lower for matching
        lookup.set(item.address.toLowerCase(), item)
      }
    } catch {
      // Ignore malformed historical rows.
    }
  }
  return lookup
}

async function getScanRange(key: string, latestBlock: bigint, window = SCAN_BLOCK_WINDOW) {
  const state = getScannerState()
  let previous: bigint | null | undefined = state.lastBlockByKey[key]
  if (previous === undefined) {
    previous = await getLastScannedBlock(key)
    if (previous !== null) {
      state.lastBlockByKey[key] = previous
    }
  }

  const recentFrom = latestBlock > window ? latestBlock - window : BigInt(0)
  let fromBlock = previous !== null && previous !== undefined
    ? previous + BigInt(1)
    : recentFrom

  // If persisted cursor fell far behind (timeouts, RPC failures, long downtime), do not try to
  // catch up hundreds of thousands of blocks in one sync — that blocks the recent tail where
  // live deposits land. Jump to the recent window instead.
  const chain = (key.split(':')[0] || 'base') as ScanChain
  const gapLookback = chain === 'base' ? GAP_LOOKBACK_BLOCKS : SECONDARY_GAP_LOOKBACK_BLOCKS
  const gap = latestBlock - fromBlock
  if (gap > window) {
    const lookbackFrom = latestBlock > gapLookback ? latestBlock - gapLookback : BigInt(0)
    if (VERBOSE_DEPOSIT_SCANNER || gap > window * BigInt(4)) {
      console.warn(
        `[crypto-deposit-scanner] ${key}: scan cursor ${previous?.toString() ?? 'none'} is ${gap.toString()} blocks behind head ${latestBlock.toString()}; scanning last ${(latestBlock - lookbackFrom).toString()} blocks (gap lookback)`
      )
    }
    fromBlock = lookbackFrom
  }

  // Pull back if cursor is ahead of the recent window (restart / state skew).
  if (fromBlock > recentFrom) fromBlock = recentFrom

  return { fromBlock, toBlock: latestBlock }
}

async function setLastScannedBlock(key: string, block: bigint) {
  const state = getScannerState()
  state.lastBlockByKey[key] = block
  await persistLastScannedBlock(key, block)
}

function normalizeTonBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)) : BigInt(0)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return /^\d+$/.test(trimmed) ? BigInt(trimmed) : BigInt(0)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('coins' in record) return normalizeTonBigInt(record.coins)
    if ('value' in record) return normalizeTonBigInt(record.value)
    if ('amount' in record) return normalizeTonBigInt(record.amount)
  }
  return BigInt(0)
}

async function sweepCryptoDepositEventSafely(event: CryptoDepositEvent) {
  try {
    const result = await sweepCryptoDepositEvent(event)
    // Re-fetch to confirm latest sweep status/tx for observability
    const refreshed = await getCryptoDepositEventByExternalId(event.externalEventId)
    console.log(`[crypto-deposit-scanner] sweep after credit completed for ${event.externalEventId}: swept=${result?.swept} sweepTx=${refreshed?.sweepTxHash || 'n/a'} sweepStatus=${refreshed?.sweepStatus || 'n/a'}`)
    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn('[crypto-deposit-scanner] sweep failed after deposit settlement; NGN credit remains recorded. Marking sweep failure for visibility.', {
      externalEventId: event.externalEventId,
      pairId: event.pairId,
      message: msg,
    })
    try {
      await markCryptoDepositEventSweepFailed({
        externalEventId: event.externalEventId,
        error: `post_credit_sweep_failed: ${msg}`,
      })
    } catch (markErr) {
      console.warn('[crypto-deposit-scanner] also failed to mark sweep failure', markErr)
    }
    return { swept: false, reason: 'sweep_failed_after_settlement' }
  }
}

async function persistAndSettleDeposit(input: {
  asset: SupportedDepositAsset
  address: CryptoDepositAddress
  externalEventId: string
  amountUnits: bigint
  txHash: string
  blockNumber?: bigint
  logIndex?: number
  payload?: Record<string, unknown>
}) {
  if (VERBOSE_DEPOSIT_SCANNER) {
    console.log(`[crypto-deposit-scanner] persistAndSettleDeposit external=${input.externalEventId} pair=${input.asset.pairId} amountUnits=${input.amountUnits.toString()} tx=${input.txHash} user=${input.address.userId}`)
  }
  const existing = await getCryptoDepositEventByExternalId(input.externalEventId)
  if (existing) {
    if (existing.status !== 'unmatched') {
      return { event: existing, settled: false, duplicate: true }
    }

    const order = await findPendingCryptoSellOrderForDeposit({
      userId: existing.userId,
      pairId: existing.pairId,
      amountCrypto: existing.amountCrypto,
    })
    if (!order) {
      console.log(`[crypto-deposit-scanner] re-processing unmatched event ${input.externalEventId} — attempting direct NGN credit now`)
      const direct = await settleDirectCryptoDeposit({
        event: existing,
        asset: input.asset,
      })
      const sweepResult = await sweepCryptoDepositEventSafely(direct)
      console.log(`[crypto-deposit-scanner] re-try direct credit + sweep for ${input.externalEventId}: credited=${direct?.status !== 'unmatched'} sweep=${JSON.stringify(sweepResult)}`)
      return { event: direct, settled: true, duplicate: true }
    }

    await settleCryptoSellDeposit({
      order,
      event: existing,
      txHash: existing.txHash ?? existing.externalEventId,
      blockNumber: existing.blockNumber,
      logIndex: existing.logIndex,
      amountUnits: existing.amountUnits,
      amountCrypto: existing.amountCrypto,
    })
    const matched = await markCryptoDepositEventMatched({
      externalEventId: existing.externalEventId,
      cryptoOrderId: order.id,
      transactionId: order.transactionId,
    })
    await sweepCryptoDepositEventSafely(matched ?? existing)
    return { event: matched ?? existing, settled: true, duplicate: true }
  }

  const amountCrypto = Number(formatUnits(input.amountUnits, input.asset.decimals))
  if (!Number.isFinite(amountCrypto) || amountCrypto <= 0) {
    console.log(`[crypto-deposit-scanner] ignoring zero/ invalid amount for ${input.externalEventId}`)
    const event = await createCryptoDepositEvent({
      externalEventId: input.externalEventId,
      userId: input.address.userId,
      addressId: input.address.id,
      addressFamily: input.address.addressFamily,
      pairId: input.asset.pairId,
      network: input.asset.network,
      assetSymbol: input.asset.symbol,
      amountCrypto: 0,
      amountUnits: input.amountUnits.toString(),
      txHash: input.txHash,
      blockNumber: input.blockNumber?.toString(),
      logIndex: input.logIndex,
      status: 'ignored',
      payload: input.payload,
    })
    return { event, settled: false, duplicate: false }
  }

  const order = await findPendingCryptoSellOrderForDeposit({
    userId: input.address.userId,
    pairId: input.asset.pairId,
    amountCrypto,
  })

  const eventStatus: CryptoDepositEvent['status'] = order ? 'matched' : 'unmatched'
  const event = await createCryptoDepositEvent({
    externalEventId: input.externalEventId,
    userId: input.address.userId,
    addressId: input.address.id,
    addressFamily: input.address.addressFamily,
    pairId: input.asset.pairId,
    network: input.asset.network,
    assetSymbol: input.asset.symbol,
    amountCrypto,
    amountUnits: input.amountUnits.toString(),
    txHash: input.txHash,
    blockNumber: input.blockNumber?.toString(),
    logIndex: input.logIndex,
    status: eventStatus,
    cryptoOrderId: order?.id,
    transactionId: order?.transactionId,
    payload: input.payload,
  })
  console.log(`[crypto-deposit-scanner] created deposit event ${event.id} status=${eventStatus} amountCrypto=${amountCrypto} for pair=${input.asset.pairId}`)

  if (!order) {
    console.log(`[crypto-deposit-scanner] no pending sell order for ${input.externalEventId} — will attempt direct NGN credit (POL and other EVM deposits go through this path)`)
    const direct = await settleDirectCryptoDeposit({
      event,
      asset: input.asset,
    })
    const sweepResult = await sweepCryptoDepositEventSafely(direct)
    // Extra visibility for the exact case the user reported (POL credit + sweep uncertainty)
    console.log(`[crypto-deposit-scanner] direct NGN credit + sweep path completed for ${input.externalEventId}: credited=${direct?.status !== 'unmatched'} sweepResult=${JSON.stringify(sweepResult)}`)
    return { event: direct, settled: true, duplicate: false }
  }

  console.log(`[crypto-deposit-scanner] matched pending sell order ${order.id} for deposit ${input.externalEventId}`)
  await settleCryptoSellDeposit({
    order,
    event,
    txHash: input.txHash,
    blockNumber: input.blockNumber?.toString(),
    logIndex: input.logIndex,
    amountUnits: input.amountUnits.toString(),
    amountCrypto,
  })
  await sweepCryptoDepositEventSafely(event)

  return { event, settled: true, duplicate: false }
}

export async function settleDirectCryptoDeposit(input: {
  event: CryptoDepositEvent
  asset: SupportedDepositAsset
}) {
  if (VERBOSE_DEPOSIT_SCANNER || input.asset.pairId !== 'TON_TON') {
    console.log(`[crypto-deposit-scanner] settleDirectCryptoDeposit for event=${input.event.externalEventId} pair=${input.asset.pairId} cryptoAmount=${input.event.amountCrypto}`)
  }
  // Use non-liveOnly so we reliably get the configured sellRate for direct credits (important for POL and other assets where live market may be temporarily missing)
  const assets = await getCryptoAssets({ forceRefresh: true })
  // For cex deposits, pairId may be short symbol like "USDT" (not full "USDT_BSC").
  // Prefer exact id match, fallback to symbol match (for cex short names in manual tests).
  let assetForRate = assets.find(item => item.id === input.asset.pairId)
  if (!assetForRate) {
    const symbol = (input.asset.pairId || '').split('_')[0].toUpperCase()
    assetForRate = assets.find(item => 
      item.symbol.toUpperCase() === symbol || 
      item.id.toUpperCase() === symbol || 
      item.id.toUpperCase().startsWith(symbol + '_')
    )
  }
  let sellRate = typeof assetForRate?.sellRate === 'number' ? assetForRate.sellRate : 0

  if (!Number.isFinite(sellRate) || sellRate <= 0) {
    // Last resort: try the asset's own configured rate if present on the SupportedDepositAsset (some paths carry it)
    // @ts-expect-error - optional on the local asset type
    sellRate = typeof input.asset.sellRate === 'number' ? input.asset.sellRate : sellRate
  }

  if (!Number.isFinite(sellRate) || sellRate <= 0) {
    console.error(`[crypto-deposit-scanner] No usable sell rate for direct NGN credit of ${input.asset.pairId}. For CEX deposits, use a valid full pairId with configured sellRate (e.g. USDT_BSC) or the base symbol (fallback will attempt to resolve). Event left unmatched.`)
    return input.event
  }

  if (VERBOSE_DEPOSIT_SCANNER || input.asset.pairId !== 'TON_TON') {
    console.log(`[crypto-deposit-scanner] rate for ${input.asset.pairId} (direct credit): ${sellRate} (assetFound=${!!assetForRate})`)
  }

  const amountNgn = Number((input.event.amountCrypto * sellRate).toFixed(2))
  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    console.error(`[crypto-deposit-scanner] Calculated NGN credit invalid for ${input.asset.pairId} (amountCrypto=${input.event.amountCrypto}, rate=${sellRate}). Leaving unmatched.`)
    return input.event
  }

  if (VERBOSE_DEPOSIT_SCANNER || input.asset.pairId !== 'TON_TON') {
    console.log(`[crypto-deposit-scanner] crediting user=${input.event.userId} NGN +${amountNgn} for ${input.event.amountCrypto} ${input.asset.symbol} (rate=${sellRate})`)
  }
  const now = new Date().toISOString()
  const transactionId = `tx_${input.event.externalEventId.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`
  const existingTransaction = await getTransactionById(input.event.userId, transactionId)
  if (!existingTransaction) {
    await applyWalletMutation({
      userId: input.event.userId,
      asset: 'NGN',
      balanceDelta: amountNgn,
      transaction: {
        id: transactionId,
        type: 'crypto_sell',
        status: 'success',
        amount: amountNgn,
        fee: 0,
        description: `Sell ${formatCrypto(input.event.amountCrypto, input.asset.symbol)}`,
        reference: transactionId,
        recipient: 'MafitaPay crypto deposit',
        narration: `${input.asset.symbol} deposit auto-credited`,
        createdAt: now,
        icon: '₿',
        metadata: {
          pairId: input.asset.pairId,
          symbol: input.asset.symbol,
          network: input.asset.network,
          settlementFlow: 'direct_crypto_deposit',
          settlementKind: 'crypto_sell_auto_credit',
          walletAsset: 'NGN',
          depositEventId: input.event.id,
          depositTxHash: input.event.txHash,
          depositAddressId: input.event.addressId,
          amountCrypto: input.event.amountCrypto,
          amountUnits: input.event.amountUnits,
          unitRate: sellRate,
          liveRate: sellRate,
        },
      },
    })
  } else {
    console.log(`[crypto-deposit-scanner] direct credit transaction already exists for event=${input.event.externalEventId}; marking event matched without duplicating NGN credit`)
  }

  const matched = await markCryptoDepositEventMatched({
    externalEventId: input.event.externalEventId,
    transactionId,
  })

  await appendNotification(input.event.userId, createNotification({
    userId: input.event.userId,
    title: 'Crypto deposit credited',
    message: `${formatCrypto(input.event.amountCrypto, input.asset.symbol)} was received and credited to your NGN balance.`,
    type: 'success',
  }))

  if (VERBOSE_DEPOSIT_SCANNER || input.asset.pairId !== 'TON_TON') {
    console.log(`[crypto-deposit-scanner] direct credit successful for event=${input.event.externalEventId} tx=${transactionId} NGN=${amountNgn}`)
  }
  return matched ?? input.event
}

export async function settleCryptoSellDeposit(input: {
  order: CryptoOrder
  event: CryptoDepositEvent
  txHash: string
  blockNumber?: string
  logIndex?: number
  amountUnits: string
  amountCrypto: number
}) {
  console.log(`[crypto-deposit-scanner] settleCryptoSellDeposit for order=${input.order.id} event=${input.event.externalEventId} tx=${input.txHash}`)
  await updateCryptoOrderExecution({
    id: input.order.id,
    destinationTxHash: input.txHash,
  })
  await updateCryptoOrderProviderState({
    id: input.order.id,
    providerStatus: 'DEPOSIT_CONFIRMED',
    providerReference: input.txHash,
    providerPayload: {
      ...(input.order.providerPayload ?? {}),
      depositEventId: input.event.id,
      depositTxHash: input.txHash,
      depositAmountUnits: input.amountUnits,
      depositAmountCrypto: input.amountCrypto,
      depositBlockNumber: input.blockNumber,
      depositLogIndex: input.logIndex,
    },
  })

  await settleCryptoOrderTerminalState({
    order: input.order,
    outcome: 'fulfilled',
    actorUserId: input.order.userId,
    source: 'chain_receipt',
    metadata: {
      txHash: input.txHash,
      blockNumber: input.blockNumber,
      logIndex: input.logIndex,
      amountUnits: input.amountUnits,
      amountCrypto: input.amountCrypto,
      asset: input.order.pairId,
    },
  })
}

async function scanErc20Deposits(input: {
  asset: SupportedDepositAsset
  client: AnyClient
  lookup: Map<string, CryptoDepositAddress>
}) {
  if (!input.asset.tokenAddress) return { detected: 0, settled: 0 }

  const latestBlock = await input.client.getBlockNumber()
  const rangeKey = `${input.asset.chain}:${input.asset.pairId}:erc20`
  const { fromBlock, toBlock } = await getScanRange(rangeKey, latestBlock)
  const erc20ChunkSize = input.asset.chain === 'bsc'
    ? BigInt(16)
    : input.asset.chain === 'base'
      ? BigInt(25)
      : BigInt(50)
  const { logs, coveredTo } = await getLogsChunked(input.client, {
    address: input.asset.tokenAddress as Address,
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock,
  }, erc20ChunkSize)

  let detected = 0
  let settled = 0
  console.log(`[crypto-deposit-scanner] ${input.asset.pairId} erc20: scanning from ${fromBlock} to ${toBlock}, fetched ${logs.length} logs in range (chunked to avoid limits)`)
  for (const log of logs) {
    const to = typeof log.args.to === 'string' ? log.args.to : ''
    const address = input.lookup.get(to.toLowerCase())
    if (!address) continue
    const value = typeof log.args.value === 'bigint' ? log.args.value : BigInt(0)
    const txHash = log.transactionHash
    const externalEventId = `${input.asset.chain}:${input.asset.pairId}:${txHash}:${log.logIndex?.toString() ?? '0'}`
    if (VERBOSE_DEPOSIT_SCANNER) {
      console.log(`[crypto-deposit-scanner] ${input.asset.pairId} matched erc20 deposit: to=${to} value=${value.toString()} tx=${txHash}`)
    }
    const result = await persistAndSettleDeposit({
      asset: input.asset,
      address,
      externalEventId,
      amountUnits: value,
      txHash,
      blockNumber: log.blockNumber,
      logIndex: Number(log.logIndex ?? 0),
      payload: {
        type: 'erc20_transfer',
        tokenAddress: input.asset.tokenAddress,
        from: log.args.from,
        to,
      },
    })
    if (!result.duplicate) detected += 1
    if (result.settled) settled += 1
  }

  // advance only to contiguous covered prefix (from start of this window); tail/holes retried on next sync to avoid permanently skipping blocks when public RPCs rate-limit getLogs
  let advanceTo = coveredTo >= fromBlock ? coveredTo : fromBlock - BigInt(1)
  if (advanceTo < BigInt(0)) advanceTo = BigInt(0)
  await setLastScannedBlock(rangeKey, advanceTo)

  if (input.asset.chain === 'bsc' && input.asset.pairId === 'USDT_BSC' && logs.length === 0 && coveredTo < toBlock) {
    if (!warnedOnce.has('bsc-usdt-logs')) {
      warnedOnce.add('bsc-usdt-logs')
      const bscCfg = getBscExecutorConfig()
      console.warn(`[crypto-deposit-scanner] WARNING: USDT_BSC getLogs returning 0 (limits exceeded) using RPCs starting with ${sanitizeUrlForLogs(bscCfg.rpcUrls[0])}. For reliable detection set MAFITAPAY_BSC_RPC_URLS to include a permissive one e.g. https://bsc-rpc.publicnode.com,https://rpc.ankr.com/bsc (or dedicated). Native BNB works because it uses getBlock not getLogs.`)
    }
  }

  return { detected, settled }
}

async function scanNativeDeposits(input: {
  asset: SupportedDepositAsset
  client: AnyClient
  lookup: Map<string, CryptoDepositAddress>
}) {
  const latestBlock = await input.client.getBlockNumber()
  const nativeKey = `${input.asset.chain}:${input.asset.pairId}:native`
  const scanWindow = input.asset.chain === 'polygon' ? POLYGON_NATIVE_INITIAL_SCAN_WINDOW : SCAN_BLOCK_WINDOW
  let { fromBlock, toBlock } = await getScanRange(nativeKey, latestBlock, scanWindow)
  // Always ensure we cover a decent recent window for native deposits so very recent sends
  // are caught promptly even if incremental state is "ahead" or after restarts.
  const MIN_RECENT_NATIVE = BigInt(256)
  const recentFrom = latestBlock > MIN_RECENT_NATIVE ? latestBlock - MIN_RECENT_NATIVE : BigInt(0)
  if (fromBlock > recentFrom) fromBlock = recentFrom
  let detected = 0
  let settled = 0
  const totalBlocks = Number(toBlock) - Number(fromBlock) + 1
  console.log(`[crypto-deposit-scanner] ${input.asset.pairId} native: scanning ${totalBlocks} blocks newest-first (batched for speed) from ${fromBlock} to ${toBlock} (key=${nativeKey})`)

  const BATCH_SIZE = totalBlocks > 512 ? 16 : 8 // wider batches when recovering a stuck cursor
  let completedFullWindow = true
  for (let end = toBlock; end >= fromBlock; end -= BigInt(BATCH_SIZE)) {
    const start = end - BigInt(BATCH_SIZE) + BigInt(1) < fromBlock ? fromBlock : end - BigInt(BATCH_SIZE) + BigInt(1)
    const promises: Promise<any>[] = []
    for (let b = end; b >= start; b -= BigInt(1)) {
      promises.push( input.client.getBlock({ blockNumber: b, includeTransactions: true }) )
    }
    const processBlock = async (blockNumber: bigint, block: { transactions: unknown[] }) => {
      for (const tx of block.transactions) {
        if (typeof tx === 'string') continue
        const parsed = tx as { to?: string | null; value?: bigint; hash?: string; from?: string }
        if (!parsed.to || !parsed.value || parsed.value <= BigInt(0)) continue
        const address = input.lookup.get(parsed.to.toLowerCase())
        if (!address) continue
        if (VERBOSE_DEPOSIT_SCANNER) {
          console.log(`[crypto-deposit-scanner] ${input.asset.pairId} matched native deposit: to=${parsed.to} value=${parsed.value.toString()} tx=${parsed.hash} block=${blockNumber}`)
        }
        const externalEventId = `${input.asset.chain}:${input.asset.pairId}:${parsed.hash}:native`
        const result = await persistAndSettleDeposit({
          asset: input.asset,
          address,
          externalEventId,
          amountUnits: parsed.value,
          txHash: parsed.hash!,
          blockNumber,
          payload: {
            type: 'native_transfer',
            from: parsed.from,
            to: parsed.to,
          },
        })
        if (!result.duplicate) detected += 1
        if (result.settled) settled += 1
      }
    }

    let batchBlocks: any[] | null = null
    try {
      batchBlocks = await Promise.all(promises)
    } catch (error) {
      console.warn(`[crypto-deposit-scanner] ${input.asset.pairId} native block batch ${start}-${end} failed; retrying block-by-block:`, error instanceof Error ? error.message : error)
    }

    if (batchBlocks) {
      for (let i = 0; i < batchBlocks.length; i++) {
        await processBlock(end - BigInt(i), batchBlocks[i])
      }
      continue
    }

    for (let b = end; b >= start; b -= BigInt(1)) {
      try {
        const block = await input.client.getBlock({ blockNumber: b, includeTransactions: true })
        await processBlock(b, block)
      } catch (error) {
        completedFullWindow = false
        console.warn(`[crypto-deposit-scanner] ${input.asset.pairId} native block ${b} failed; newest blocks were prioritized and this window will retry next sync:`, error instanceof Error ? error.message : error)
        break
      }
    }
    if (!completedFullWindow) break
  }

  if (completedFullWindow) {
    await setLastScannedBlock(nativeKey, toBlock)
  }
  return { detected, settled }
}

async function scanTonDeposits(input: {
  asset: SupportedDepositAsset
  client: TonClient
  lookup: Map<string, CryptoDepositAddress>
}) {
  const tonAddrs = Array.from(input.lookup.values()).filter(a => a.addressFamily === 'ton')
  if (tonAddrs.length === 0) return { detected: 0, settled: 0 }

  let detected = 0
  let settled = 0
  const tonClient = input.client

  for (const addr of tonAddrs) {
    try {
      // Normalize the stored address (from provisioning: bounceable false, urlSafe true)
      const destAddr = TonAddress.parse(addr.address)
      const normalized = destAddr.toString({ bounceable: false, urlSafe: true }).toLowerCase()
      // Fetch recent txs (re-scan ok, duplicate check in persist handles)
      const txs = await tonClient.getTransactions(destAddr, { limit: 50 })
      for (const tx of txs) {
        const inMsg = tx.inMessage
        if (!inMsg || inMsg.info.type !== 'internal') continue
        const info = inMsg.info as any
        const value = normalizeTonBigInt(info.value)
        if (value <= BigInt(0)) continue
        const src = info.src ? info.src.toString() : ''
        const txHash = tx.hash().toString('hex')
        // Use normalized for external id
        const externalEventId = `ton:${input.asset.pairId}:${txHash}:native`
        if (VERBOSE_DEPOSIT_SCANNER) {
          console.log(`[crypto-deposit-scanner] TON_TON matched native deposit: to=${addr.address} value=${value.toString()} tx=${txHash}`)
        }
        const result = await persistAndSettleDeposit({
          asset: input.asset,
          address: addr,
          externalEventId,
          amountUnits: value,
          txHash,
          // TON has lt/utime, no evm block exactly; use 0 for now
          blockNumber: normalizeTonBigInt(tx.lt),
          payload: {
            type: 'ton_internal',
            from: src,
            to: addr.address,
            lt: normalizeTonBigInt(tx.lt).toString(),
            hash: txHash,
          },
        })
        if (!result.duplicate) detected += 1
        if (result.settled) settled += 1
      }
    } catch (e) {
      console.warn(`[crypto-deposit-scanner] TON scan error for ${addr.address}:`, e instanceof Error ? e.message : e)
    }
  }
  return { detected, settled }
}

async function scanSolanaDeposits(input: {
  asset: SupportedDepositAsset
  connection: Connection
  lookup: Map<string, CryptoDepositAddress>
}) {
  const solAddrs = Array.from(input.lookup.values()).filter(a => a.addressFamily === 'solana')
  if (solAddrs.length === 0) return { detected: 0, settled: 0 }

  let detected = 0
  let settled = 0
  const conn = input.connection
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

  for (const addr of solAddrs) {
    try {
      const owner = new PublicKey(addr.address)
      const isNative = input.asset.pairId === 'SOL_SOLANA'
      const target = isNative ? owner : getAssociatedTokenAddressSync(USDC_MINT, owner)

      const sigs = await conn.getSignaturesForAddress(target, { limit: 30 })
      for (const sigInfo of sigs) {
        if (sigInfo.err) continue
        const tx = await conn.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 })
        if (!tx || tx.meta?.err) continue

        let value = BigInt(0)
        let from = ''
        let to = ''

        // Parse instructions
        const instructions = (tx.transaction.message as any).instructions || []
        for (const ix of instructions) {
          if (isNative) {
            // Native SOL: system program transfer
            if (ix.programId?.toBase58() === '11111111111111111111111111111111' && ix.parsed?.type === 'transfer') {
              const info = ix.parsed.info
              if (info.destination === addr.address) {
                value = BigInt(info.lamports || 0)
                from = info.source || ''
                to = info.destination
                break
              }
            }
          } else {
            // SPL USDC transfer to the ATA
            if (ix.programId?.toBase58() === TOKEN_PROGRAM_ID.toBase58() && (ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked')) {
              const info = ix.parsed.info
              if (info.destination === target.toBase58()) {
                value = BigInt(info.amount || info.tokenAmount?.amount || 0)
                from = info.source || ''
                to = info.destination
                break
              }
            }
          }
        }

        if (value <= BigInt(0)) continue

        const txHash = sigInfo.signature
        const externalEventId = `solana:${input.asset.pairId}:${txHash}:${isNative ? 'native' : 'spl'}`
        if (VERBOSE_DEPOSIT_SCANNER) {
          console.log(`[crypto-deposit-scanner] ${input.asset.pairId} matched ${isNative ? 'native' : 'spl'} deposit: to=${addr.address} value=${value.toString()} tx=${txHash}`)
        }
        const result = await persistAndSettleDeposit({
          asset: input.asset,
          address: addr,
          externalEventId,
          amountUnits: value,
          txHash,
          blockNumber: BigInt(sigInfo.slot || 0),
          payload: {
            type: isNative ? 'solana_native_transfer' : 'solana_spl_transfer',
            from,
            to: addr.address,
            signature: txHash,
            slot: sigInfo.slot,
          },
        })
        if (!result.duplicate) detected += 1
        if (result.settled) settled += 1
      }
    } catch (e) {
      console.warn(`[crypto-deposit-scanner] Solana scan error for ${addr.address}:`, e instanceof Error ? e.message : e)
    }
  }
  return { detected, settled }
}

async function scanSuiDeposits(input: {
  asset: SupportedDepositAsset
  client: SuiJsonRpcClient
  lookup: Map<string, CryptoDepositAddress>
}) {
  const suiAddrs = Array.from(input.lookup.values()).filter((a) => a.addressFamily === 'sui')
  if (suiAddrs.length === 0) return { detected: 0, settled: 0 }

  let detected = 0
  let settled = 0
  const client = input.client
  const NATIVE_SUI_TYPE = '0x2::sui::SUI'

  for (const addr of suiAddrs) {
    try {
      const page = await client.queryTransactionBlocks({
        filter: { ToAddress: addr.address },
        limit: 30,
        order: 'descending',
        options: { showBalanceChanges: true, showEffects: true },
      })
      const txs = (page as any).data || []
      for (const tx of txs) {
        const digest: string | undefined = tx?.digest
        if (!digest) continue
        const balanceChanges: any[] = (tx as any).balanceChanges || []
        let value = BigInt(0)
        for (const bc of balanceChanges) {
          const ownerStr =
            typeof bc?.owner === 'string'
              ? bc.owner
              : bc?.owner && typeof bc.owner === 'object'
                ? bc.owner.AddressOwner || bc.owner.ObjectOwner || null
                : null
          if (ownerStr === addr.address && bc?.coinType === NATIVE_SUI_TYPE) {
            const amt = BigInt(bc.amount || '0')
            if (amt > 0) value += amt
          }
        }
        if (value <= BigInt(0)) continue

        const externalEventId = `sui:${input.asset.pairId}:${digest}`
        if (VERBOSE_DEPOSIT_SCANNER) {
          console.log(`[crypto-deposit-scanner] ${input.asset.pairId} matched native deposit: to=${addr.address} value=${value.toString()} tx=${digest}`)
        }
        const result = await persistAndSettleDeposit({
          asset: input.asset,
          address: addr,
          externalEventId,
          amountUnits: value,
          txHash: digest,
          blockNumber: tx?.checkpoint ? BigInt(tx.checkpoint) : undefined,
          payload: {
            type: 'sui_native_transfer',
            digest,
            to: addr.address,
          },
        })
        if (!result.duplicate) detected += 1
        if (result.settled) settled += 1
      }
    } catch (e) {
      console.warn(`[crypto-deposit-scanner] Sui scan error for ${addr.address}:`, e instanceof Error ? e.message : e)
    }
  }
  return { detected, settled }
}

async function scanNearDeposits(input: {
  asset: SupportedDepositAsset
  provider: any
  lookup: Map<string, CryptoDepositAddress>
}) {
  const nearAddrs = Array.from(input.lookup.values()).filter((a) => a.addressFamily === 'near')
  if (nearAddrs.length === 0) return { detected: 0, settled: 0 }

  let detected = 0
  let settled = 0
  const provider = input.provider
  const targetSet = new Set(nearAddrs.map((a) => a.address.toLowerCase()))

  try {
    const status = await provider.status()
    const headHeight = Number(status?.sync_info?.latest_block_height || 0)
    if (!headHeight) return { detected: 0, settled: 0 }

    const SCAN_WINDOW = 180
    const fromHeight = Math.max(0, headHeight - SCAN_WINDOW)
    console.log(`[crypto-deposit-scanner] ${input.asset.pairId} scanning NEAR heights ${fromHeight}-${headHeight}`)

    const BATCH = 12
    for (let h = headHeight; h >= fromHeight; h -= BATCH) {
      const heights: number[] = []
      for (let i = 0; i < BATCH && h - i >= fromHeight; i++) heights.push(h - i)
      const blockPromises = heights.map((ht) => provider.block({ blockId: ht }).catch(() => null))
      const blocks = await Promise.all(blockPromises)

      for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi]
        const blockHeight = heights[bi]
        if (!block || !block.chunks) continue

        for (const ch of block.chunks) {
          try {
            const chunk = await provider.chunk({ chunk_id: ch.chunk_hash }).catch(() => null)
            if (!chunk) continue

            const receipts = chunk.receipts || []
            for (const rec of receipts) {
              if (!rec || !rec.receiver_id) continue
              const receiver = String(rec.receiver_id)
              if (!targetSet.has(receiver.toLowerCase())) continue

              const actions = rec.receipt?.Action?.actions || []
              for (const act of actions) {
                if (act?.Transfer?.deposit) {
                  const depositStr = String(act.Transfer.deposit)
                  const value = BigInt(depositStr)
                  if (value <= BigInt(0)) continue

                  const receiptId = rec.receipt_id || rec.receipt?.receipt_id || String(blockHeight)
                  const txHash = rec.transaction_hash || receiptId
                  const externalEventId = `near:${input.asset.pairId}:${txHash}:native`
                  const addressRec = nearAddrs.find((a) => a.address.toLowerCase() === receiver.toLowerCase())
                  if (!addressRec) continue

                  if (VERBOSE_DEPOSIT_SCANNER) {
                    console.log(`[crypto-deposit-scanner] ${input.asset.pairId} matched native deposit: to=${receiver} value=${value.toString()} tx=${txHash}`)
                  }
                  const result = await persistAndSettleDeposit({
                    asset: input.asset,
                    address: addressRec,
                    externalEventId,
                    amountUnits: value,
                    txHash: String(txHash),
                    blockNumber: BigInt(blockHeight),
                    payload: {
                      type: 'near_native_transfer',
                      from: rec.predecessor_id,
                      to: receiver,
                      receipt_id: rec.receipt_id,
                      block: blockHeight,
                    },
                  })
                  if (!result.duplicate) detected += 1
                  if (result.settled) settled += 1
                }
              }
            }
          } catch (e) {
            // per-chunk soft fail
          }
        }
      }
    }
  } catch (e) {
    console.warn(`[crypto-deposit-scanner] NEAR scan top-level error:`, e instanceof Error ? e.message : e)
  }

  return { detected, settled }
}

export async function syncCryptoDepositEventsOnce() {
  const state = getScannerState()
  if (state.running) {
    // sync skipped (already running) - too noisy, only log start when actually runs
    return { skipped: true, detected: 0, settled: 0, errors: [] as string[] }
  }
  const now = Date.now()
  if (state.lastSyncAt && now - state.lastSyncAt < MIN_SYNC_INTERVAL_MS) {
    // too frequent
    return { skipped: true, detected: 0, settled: 0, errors: [] as string[] }
  }
  state.lastSyncAt = now
  state.running = true
  console.log('[crypto-deposit-scanner] syncCryptoDepositEventsOnce starting...')

  try {
    const evmAddresses = await listCryptoDepositAddressesByFamily('evm')
    const solanaAddresses = await listCryptoDepositAddressesByFamily('solana')
    const tonAddresses = await listCryptoDepositAddressesByFamily('ton')
    const nearAddresses = await listCryptoDepositAddressesByFamily('near')
    const suiAddresses = await listCryptoDepositAddressesByFamily('sui')
    const allAddresses = [...evmAddresses, ...solanaAddresses, ...tonAddresses, ...nearAddresses, ...suiAddresses]
    const lookup = buildAddressLookup(allAddresses)
    console.log(`[crypto-deposit-scanner] loaded ${allAddresses.length} addresses (evm=${evmAddresses.length}, solana=${solanaAddresses.length}, ton=${tonAddresses.length}, near=${nearAddresses.length}, sui=${suiAddresses.length}), lookup.size=${lookup.size}`)
    if (lookup.size === 0) {
      console.log('[crypto-deposit-scanner] no deposit addresses, skipping scans')
      return { skipped: false, detected: 0, settled: 0, errors: [] as string[] }
    }

    const baseClient = createBaseClient()
    const bscClient = createBscClient()
    const polygonClient = createPolygonClient()
    const tonClient = createTonClient()
    const solanaConnection = createSolanaConnection()
    const suiClient = createSuiScannerClient()
    const nearProvider = createNearScannerProvider()
    // log effective RPCs for diagnosis (especially when public nodes limit logs or return 401)
    const baseCfg = getBaseExecutorConfig()
    const bscCfg = getBscExecutorConfig()
    const polyRpcRaw = (process.env.MAFITAPAY_POLYGON_RPC_URLS?.trim() || process.env.MAFITAPAY_POLYGON_RPC_URL?.trim() || DEFAULT_POLYGON_RPC_URL)
    const suiRpcRaw = (process.env.MAFITAPAY_SUI_RPC_URLS?.trim() || process.env.MAFITAPAY_SUI_RPC_URL?.trim() || DEFAULT_SUI_RPC_URL)
    const nearRpcRaw = (process.env.MAFITAPAY_NEAR_RPC_URLS?.trim() || process.env.MAFITAPAY_NEAR_RPC_URL?.trim() || DEFAULT_NEAR_RPC_URLS[0])
    const sanitizedPolygon = sanitizePolygonRpcUrls(polyRpcRaw)
    console.log(`[crypto-deposit-scanner] RPCs base(${baseCfg.rpcUrls.length})=${baseCfg.rpcUrls.map(sanitizeUrlForLogs).join(' | ')} bsc[0]=${sanitizeUrlForLogs(bscCfg.rpcUrls[0])} polygon[0]=${sanitizeUrlForLogs(sanitizedPolygon[0] || polyRpcRaw.split(',')[0])} (raw had ${polyRpcRaw.split(',').length} entries) sui[0]=${sanitizeUrlForLogs(suiRpcRaw.split(',')[0])} near[0]=${sanitizeUrlForLogs(nearRpcRaw)}`)
    let detected = 0
    let settled = 0
    const errors: string[] = []

    // Scan assets sequentially. Public RPCs throttle hard when every chain is scanned in parallel.
    const assetResults: Array<{ detected: number; settled: number; error: string | null }> = []
    for (const asset of getSupportedAssets()) {
      try {
        console.log(`[crypto-deposit-scanner] scanning ${asset.pairId} on ${asset.chain} (${asset.kind})`)
        const result = await withAssetScanTimeout(asset.pairId, async () => {
          const isEvm = asset.chain === 'base' || asset.chain === 'bsc' || asset.chain === 'polygon'
          if (isEvm) {
            const client: AnyClient = asset.chain === 'base' ? baseClient : asset.chain === 'bsc' ? bscClient : polygonClient
            return asset.kind === 'erc20'
              ? await scanErc20Deposits({ asset, client, lookup })
              : await scanNativeDeposits({ asset, client, lookup })
          }
          if (asset.chain === 'ton') {
            return await scanTonDeposits({ asset, client: tonClient, lookup })
          }
          if (asset.chain === 'solana') {
            return await scanSolanaDeposits({ asset, connection: solanaConnection, lookup })
          }
          if (asset.chain === 'sui') {
            return await scanSuiDeposits({ asset, client: suiClient, lookup })
          }
          if (asset.chain === 'near') {
            return await scanNearDeposits({ asset, provider: nearProvider, lookup })
          }
          console.log(`[crypto-deposit-scanner] ${asset.pairId} on ${asset.chain}: no scanner configured`)
          return { detected: 0, settled: 0 }
        })
        console.log(`[crypto-deposit-scanner] ${asset.pairId} result: detected=${result.detected} settled=${result.settled}`)
        assetResults.push({ detected: result.detected, settled: result.settled, error: null })
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'scan failed'
        console.error(`[crypto-deposit-scanner] error for ${asset.pairId}:`, error)
        if (asset.chain === 'polygon' && !warnedOnce.has('polygon-rpc')) {
          warnedOnce.add('polygon-rpc')
          console.warn(`[crypto-deposit-scanner] Polygon RPC failed. We now aggressively drop dead endpoints (especially the permanently dead public.blastapi.io / Blast API). Check the "polygon RPCs configured (after removing dead endpoints incl. Blast)" line. Prefer MAFITAPAY_POLYGON_RPC_URLS with your Alchemy key. Falling back to Ankr if needed.`)
        }
        assetResults.push({ detected: 0, settled: 0, error: `${asset.pairId}: ${msg}` })
      }
    }

    for (const r of assetResults) {
      detected += r.detected
      settled += r.settled
      if (r.error) errors.push(r.error)
    }

    console.log(`[crypto-deposit-scanner] sync complete: totalDetected=${detected} totalSettled=${settled} errors=${errors.length}`)
    return { skipped: false, detected, settled, errors }
  } finally {
    state.running = false
  }
}

export function ensureCryptoDepositScannerWatchdog() {
  const state = getScannerState()
  if (state.interval) return
  state.interval = setInterval(() => {
    void syncCryptoDepositEventsOnce().catch(error => {
      console.warn('[crypto-deposit-scanner] watchdog_error', error instanceof Error ? error.message : error)
    })
  }, WATCHDOG_INTERVAL_MS)

  // CEX Binance internal poller (UID transfers) is temporarily disabled / parked
  // while we focus exclusively on on-chain deposit testing for the other assets
  // (Sui, NEAR, Polygon, TON, different networks, etc.).
  // The auto watchdog and its [cex-binance] logs are silenced to reduce noise.
  // Re-enable by uncommenting below when ready to resume CEX work.
  // import('@/lib/server/data').then(({ ensureBinanceCexDepositSyncWatchdog }) => {
  //   ensureBinanceCexDepositSyncWatchdog()
  // }).catch(() => {})
}

export async function kickCryptoDepositScanner() {
  ensureCryptoDepositScannerWatchdog()
  return syncCryptoDepositEventsOnce()
}

export async function forceScanDepositAddress(input: { address: string; pairId?: string }) {
  const addr = input.address.trim()
  if (!addr) throw new Error('address is required')
  const record = await getCryptoDepositAddressByAddress(addr)
  if (!record) {
    throw new Error('Address is not a known active crypto deposit address in the system.')
  }
  const family = record.addressFamily
  const assetsToScan = getSupportedAssets().filter((a) => {
    if (input.pairId) return a.pairId === input.pairId
    if (family === 'evm' && (a.chain === 'base' || a.chain === 'bsc' || a.chain === 'polygon')) return true
    if (family === 'solana' && a.chain === 'solana') return true
    if (family === 'ton' && a.chain === 'ton') return true
    if (family === 'sui' && a.chain === 'sui') return true
    if (family === 'near' && a.chain === 'near') return true
    return false
  })
  if (assetsToScan.length === 0) {
    return { record, scanned: 0, message: 'No matching supported assets for this address family.' }
  }
  const lookup = buildAddressLookup([record])
  const perAsset: Array<{ pairId: string; detected: number; settled: number; error?: string }> = []
  for (const asset of assetsToScan) {
    try {
      let result: { detected: number; settled: number }
      if (asset.chain === 'base' || asset.chain === 'bsc' || asset.chain === 'polygon') {
        const client: AnyClient = asset.chain === 'base' ? createBaseClient() : asset.chain === 'bsc' ? createBscClient() : createPolygonClient()
        result = asset.kind === 'erc20'
          ? await scanErc20Deposits({ asset, client, lookup })
          : await scanNativeDeposits({ asset, client, lookup })
      } else if (asset.chain === 'ton') {
        result = await scanTonDeposits({ asset, client: createTonClient(), lookup })
      } else if (asset.chain === 'solana') {
        result = await scanSolanaDeposits({ asset, connection: createSolanaConnection(), lookup })
      } else if (asset.chain === 'sui') {
        result = await scanSuiDeposits({ asset, client: createSuiScannerClient(), lookup })
      } else if (asset.chain === 'near') {
        result = await scanNearDeposits({ asset, provider: createNearScannerProvider(), lookup })
      } else {
        result = { detected: 0, settled: 0 }
      }
      perAsset.push({ pairId: asset.pairId, detected: result.detected, settled: result.settled })
    } catch (error) {
      perAsset.push({ pairId: asset.pairId, detected: 0, settled: 0, error: error instanceof Error ? error.message : 'scan error' })
    }
  }
  // Also kick a full background sync for good measure (covers any state advancement)
  void syncCryptoDepositEventsOnce().catch(() => {})
  return { record: { id: record.id, userId: record.userId, address: record.address, addressFamily: record.addressFamily }, scannedAssets: perAsset }
}
