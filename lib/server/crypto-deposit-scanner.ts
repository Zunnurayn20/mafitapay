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
import { createTonHttpAdapter, getTonExecutorConfig } from '@/lib/server/ton-executor'
import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { sweepCryptoDepositEvent } from '@/lib/server/crypto-deposit-sweeper'
import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { appendNotification, createNotification } from '@/lib/server/auth'
import {
  applyWalletMutation,
  createCryptoDepositEvent,
  findPendingCryptoSellOrderForDeposit,
  getCryptoAssets,
  getCryptoDepositEventByExternalId,
  listCryptoDepositAddressesByFamily,
  markCryptoDepositEventMatched,
  updateCryptoOrderExecution,
  updateCryptoOrderProviderState,
} from '@/lib/server/data'
import { formatCrypto, sanitizeUrlForLogs } from '@/lib/utils'
import type { CryptoDepositAddress, CryptoDepositEvent, CryptoOrder } from '@/types'

const SCAN_BLOCK_WINDOW = BigInt(64) // reduced to avoid RPC log query limits on public nodes and speed up native scans
const WATCHDOG_INTERVAL_MS = 30_000
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

const DEFAULT_POLYGON_RPC_URL = 'https://rpc.ankr.com/polygon'
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
  while (current <= baseParams.toBlock) {
    const end = current + chunkSize > baseParams.toBlock ? baseParams.toBlock : current + chunkSize
    try {
      const chunk = await client.getLogs({ ...filter, fromBlock: current, toBlock: end })
      logs.push(...chunk)
      const expected = coveredTo + BigInt(1)
      if (current === expected) {
        coveredTo = end
      }
      // only advance covered for contiguous successful prefix from window start (prevents skipping holes on flaky RPCs)
    } catch (err) {
      console.warn(`[crypto-deposit-scanner] getLogs chunk ${current}-${end} failed (will continue):`, err instanceof Error ? err.message : err)
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
  if (!raw) {
    const alchemyKey = process.env.ALCHEMY_API_KEY?.trim()
    if (alchemyKey) {
      raw = `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
    } else {
      raw = DEFAULT_POLYGON_RPC_URL
    }
  }
  let rpcUrls = raw.split(',').map(item => item.trim()).filter(Boolean)
  // Avoid falling back all the way to the known-broken public polygon-rpc.com if user listed better ones first
  const BROKEN_POLYGON_DEFAULT = 'https://polygon-rpc.com'
  if (rpcUrls.length > 1) {
    rpcUrls = rpcUrls.filter(u => !u.toLowerCase().includes('polygon-rpc.com'))
    if (rpcUrls.length === 0) rpcUrls = [BROKEN_POLYGON_DEFAULT]
  }
  const transport = rpcUrls.length > 1
    ? fallback(rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(rpcUrls[0] || BROKEN_POLYGON_DEFAULT, { retryCount: 1, timeout: 10_000 })
  console.log(`[crypto-deposit-scanner] polygon RPCs configured (after filtering broken defaults): ${rpcUrls.map(sanitizeUrlForLogs).join(' | ')}`)
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

function getSupportedAssets(): SupportedDepositAsset[] {
  const baseConfig = getBaseExecutorConfig()
  const bscConfig = getBscExecutorConfig()
  return [
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
      chain: 'base',
      pairId: 'ETH_BASE',
      network: 'Base',
      symbol: 'ETH',
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
      chain: 'bsc',
      pairId: 'BNB_BSC',
      network: 'BSC',
      symbol: 'BNB',
      decimals: 18,
      kind: 'native',
    },
    {
      chain: 'polygon',
      pairId: 'POL_POLYGON',
      network: 'Polygon',
      symbol: 'POL',
      decimals: 18,
      kind: 'native',
    },
    // Non-EVM (scanning logic pending / partial implementation)
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

function getScanRange(key: string, latestBlock: bigint) {
  const state = getScannerState()
  const previous = state.lastBlockByKey[key]
  const fromBlock = previous
    ? previous + BigInt(1)
    : latestBlock > SCAN_BLOCK_WINDOW
      ? latestBlock - SCAN_BLOCK_WINDOW
      : BigInt(0)
  return { fromBlock, toBlock: latestBlock }
}

function setLastScannedBlock(key: string, block: bigint) {
  const state = getScannerState()
  state.lastBlockByKey[key] = block
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
  console.log(`[crypto-deposit-scanner] persistAndSettleDeposit external=${input.externalEventId} pair=${input.asset.pairId} amountUnits=${input.amountUnits.toString()} tx=${input.txHash} user=${input.address.userId}`)
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
      const direct = await settleDirectCryptoDeposit({
        event: existing,
        asset: input.asset,
      })
      await sweepCryptoDepositEvent(direct)
      return { event: direct, settled: true, duplicate: true }
    }

    await settleCryptoSellDeposit({
      order,
      event: existing,
      txHash: existing.txHash,
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
    await sweepCryptoDepositEvent(matched ?? existing)
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
    console.log(`[crypto-deposit-scanner] no pending sell order, doing direct NGN credit for ${input.externalEventId}`)
    const direct = await settleDirectCryptoDeposit({
      event,
      asset: input.asset,
    })
    await sweepCryptoDepositEvent(direct)
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
  await sweepCryptoDepositEvent(event)

  return { event, settled: true, duplicate: false }
}

async function settleDirectCryptoDeposit(input: {
  event: CryptoDepositEvent
  asset: SupportedDepositAsset
}) {
  console.log(`[crypto-deposit-scanner] settleDirectCryptoDeposit for event=${input.event.externalEventId} pair=${input.asset.pairId} cryptoAmount=${input.event.amountCrypto}`)
  const assets = await getCryptoAssets({ forceRefresh: true, liveOnly: true })
  const liveAsset = assets.find(item => item.id === input.asset.pairId)
  const sellRate = typeof liveAsset?.sellRate === 'number' ? liveAsset.sellRate : 0
  console.log(`[crypto-deposit-scanner] live rate for ${input.asset.pairId}: ${sellRate} (liveAsset=${!!liveAsset})`)
  if (!liveAsset || !Number.isFinite(sellRate) || sellRate <= 0) {
    throw new Error(`Live sell rate is unavailable for ${input.asset.pairId}.`)
  }

  const amountNgn = Number((input.event.amountCrypto * sellRate).toFixed(2))
  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    throw new Error(`Calculated NGN credit is invalid for ${input.asset.pairId}.`)
  }

  console.log(`[crypto-deposit-scanner] crediting user=${input.event.userId} NGN +${amountNgn} for ${input.event.amountCrypto} ${input.asset.symbol}`)
  const now = new Date().toISOString()
  const transactionId = `tx_${input.event.externalEventId.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}`
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

  console.log(`[crypto-deposit-scanner] direct credit successful for event=${input.event.externalEventId} tx=${transactionId} NGN=${amountNgn}`)
  return matched ?? input.event
}

async function settleCryptoSellDeposit(input: {
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
  const { fromBlock, toBlock } = getScanRange(rangeKey, latestBlock)
  const erc20ChunkSize = input.asset.chain === 'bsc' ? BigInt(16) : BigInt(100)
  const { logs, coveredTo } = await getLogsChunked(input.client, {
    address: input.asset.tokenAddress as Address,
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock,
  }, erc20ChunkSize)

  let detected = 0
  let settled = 0
  console.log(`[crypto-deposit-scanner] ${input.asset.pairId} erc20: fetched ${logs.length} logs in range (chunked to avoid limits)`)
  for (const log of logs) {
    const to = typeof log.args.to === 'string' ? log.args.to : ''
    const address = input.lookup.get(to.toLowerCase())
    if (!address) continue
    const value = typeof log.args.value === 'bigint' ? log.args.value : BigInt(0)
    const txHash = log.transactionHash
    const externalEventId = `${input.asset.chain}:${input.asset.pairId}:${txHash}:${log.logIndex?.toString() ?? '0'}`
    console.log(`[crypto-deposit-scanner] ${input.asset.pairId} matched erc20 deposit: to=${to} value=${value.toString()} tx=${txHash}`)
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
  setLastScannedBlock(rangeKey, advanceTo)

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
  const { fromBlock, toBlock } = getScanRange(nativeKey, latestBlock)
  let detected = 0
  let settled = 0
  const totalBlocks = Number(toBlock) - Number(fromBlock) + 1
  console.log(`[crypto-deposit-scanner] ${input.asset.pairId} native: scanning ${totalBlocks} blocks (batched for speed)`)

  const BATCH_SIZE = 8 // small batches to not overwhelm RPCs
  for (let start = fromBlock; start <= toBlock; start += BigInt(BATCH_SIZE)) {
    const end = start + BigInt(BATCH_SIZE) - BigInt(1) > toBlock ? toBlock : start + BigInt(BATCH_SIZE) - BigInt(1)
    const promises: Promise<any>[] = []
    for (let b = start; b <= end; b += BigInt(1)) {
      promises.push( input.client.getBlock({ blockNumber: b, includeTransactions: true }) )
    }
    const batchBlocks = await Promise.all(promises)
    for (let i = 0; i < batchBlocks.length; i++) {
      const blockNumber = start + BigInt(i)
      const block = batchBlocks[i]
      for (const tx of block.transactions) {
        if (typeof tx === 'string') continue
        if (!tx.to || tx.value <= BigInt(0)) continue
        const address = input.lookup.get(tx.to.toLowerCase())
        if (!address) continue
        console.log(`[crypto-deposit-scanner] ${input.asset.pairId} matched native deposit: to=${tx.to} value=${tx.value.toString()} tx=${tx.hash} block=${blockNumber}`)
        const externalEventId = `${input.asset.chain}:${input.asset.pairId}:${tx.hash}:native`
        const result = await persistAndSettleDeposit({
          asset: input.asset,
          address,
          externalEventId,
          amountUnits: tx.value,
          txHash: tx.hash,
          blockNumber,
          payload: {
            type: 'native_transfer',
            from: tx.from,
            to: tx.to,
          },
        })
        if (!result.duplicate) detected += 1
        if (result.settled) settled += 1
      }
    }
  }

  setLastScannedBlock(nativeKey, toBlock)
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
        console.log(`[crypto-deposit-scanner] TON_TON matched native deposit: to=${addr.address} value=${value.toString()} tx=${txHash}`)
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
            if (ix.programId?.toBase58() === TOKEN_PROGRAM_ID.toBase58() && ix.parsed?.type === 'transfer') {
              const info = ix.parsed.info
              if (info.destination === target.toBase58()) {
                value = BigInt(info.amount || 0)
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
        console.log(`[crypto-deposit-scanner] ${input.asset.pairId} matched ${isNative ? 'native' : 'spl'} deposit: to=${addr.address} value=${value.toString()} tx=${txHash}`)
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

export async function syncCryptoDepositEventsOnce() {
  const state = getScannerState()
  if (state.running) {
    // sync skipped (already running) - too noisy, only log start when actually runs
    return { skipped: true, detected: 0, settled: 0, errors: [] as string[] }
  }
  const now = Date.now()
  if (state.lastSyncAt && now - state.lastSyncAt < 5000) {
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
    // log effective RPCs for diagnosis (especially when public nodes limit logs or return 401)
    const baseCfg = getBaseExecutorConfig()
    const bscCfg = getBscExecutorConfig()
    const polyRpcRaw = (process.env.MAFITAPAY_POLYGON_RPC_URLS?.trim() || process.env.MAFITAPAY_POLYGON_RPC_URL?.trim() || DEFAULT_POLYGON_RPC_URL)
    console.log(`[crypto-deposit-scanner] RPCs base[0]=${sanitizeUrlForLogs(baseCfg.rpcUrls[0])} bsc[0]=${sanitizeUrlForLogs(bscCfg.rpcUrls[0])} polygon[0]=${sanitizeUrlForLogs(polyRpcRaw.split(',')[0])}`)
    let detected = 0
    let settled = 0
    const errors: string[] = []

    // Run chain scans in parallel so that later assets (e.g. POL) are not delayed by heavy earlier scans
    // (USDT_BSC log fetches or large catch-up native block batches on BSC/Base).
    const assetResults = await Promise.all(
      getSupportedAssets().map(async (asset) => {
        try {
          console.log(`[crypto-deposit-scanner] scanning ${asset.pairId} on ${asset.chain} (${asset.kind})`)
          const isEvm = asset.chain === 'base' || asset.chain === 'bsc' || asset.chain === 'polygon'
          if (isEvm) {
            const client: AnyClient = asset.chain === 'base' ? baseClient : asset.chain === 'bsc' ? bscClient : polygonClient
            const result = asset.kind === 'erc20'
              ? await scanErc20Deposits({ asset, client, lookup })
              : await scanNativeDeposits({ asset, client, lookup })
            console.log(`[crypto-deposit-scanner] ${asset.pairId} result: detected=${result.detected} settled=${result.settled}`)
            return { detected: result.detected, settled: result.settled, error: null as string | null }
          } else if (asset.chain === 'ton') {
            const result = await scanTonDeposits({ asset, client: tonClient, lookup })
            console.log(`[crypto-deposit-scanner] ${asset.pairId} result: detected=${result.detected} settled=${result.settled}`)
            return { detected: result.detected, settled: result.settled, error: null as string | null }
          } else if (asset.chain === 'solana') {
            const result = await scanSolanaDeposits({ asset, connection: solanaConnection, lookup })
            console.log(`[crypto-deposit-scanner] ${asset.pairId} result: detected=${result.detected} settled=${result.settled}`)
            return { detected: result.detected, settled: result.settled, error: null as string | null }
          } else {
            // Non-EVM deposit scanning not yet implemented (address provisioning works; detection will be added next)
            console.log(`[crypto-deposit-scanner] ${asset.pairId} on ${asset.chain}: scanning not yet implemented for this family`)
            return { detected: 0, settled: 0, error: null as string | null }
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'scan failed'
          console.error(`[crypto-deposit-scanner] error for ${asset.pairId}:`, error)
          if (asset.chain === 'polygon' && !warnedOnce.has('polygon-rpc')) {
            warnedOnce.add('polygon-rpc')
            console.warn(`[crypto-deposit-scanner] Polygon RPC failed (common on public Polygon endpoints that have disabled free/tenant-less access). Check the "polygon RPCs configured" line above for the list that was actually tried. We auto-use ALCHEMY_API_KEY if present (https://polygon-mainnet.g.alchemy.com/v2/KEY). Set MAFITAPAY_POLYGON_RPC_URL or _URLS (or ensure Alchemy app includes Polygon) and restart.`)
          }
          return { detected: 0, settled: 0, error: `${asset.pairId}: ${msg}` }
        }
      })
    )

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
}

export async function kickCryptoDepositScanner() {
  ensureCryptoDepositScannerWatchdog()
  return syncCryptoDepositEventsOnce()
}
