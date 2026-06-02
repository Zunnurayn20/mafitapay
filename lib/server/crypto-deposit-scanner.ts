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
import { base, bsc } from 'viem/chains'
import { getBaseExecutorConfig } from '@/lib/server/base-executor'
import { getBscExecutorConfig } from '@/lib/server/bsc-executor'
import { sweepCryptoDepositEvent } from '@/lib/server/crypto-deposit-sweeper'
import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import {
  createCryptoDepositEvent,
  findPendingCryptoSellOrderForDeposit,
  getCryptoDepositEventByExternalId,
  listCryptoDepositAddressesByFamily,
  markCryptoDepositEventMatched,
  updateCryptoOrderExecution,
  updateCryptoOrderProviderState,
} from '@/lib/server/data'
import type { CryptoDepositAddress, CryptoDepositEvent, CryptoOrder } from '@/types'

const SCAN_BLOCK_WINDOW = BigInt(180)
const WATCHDOG_INTERVAL_MS = 30_000
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

type ScanChain = 'base' | 'bsc'
type ScanState = {
  lastBlockByKey: Partial<Record<string, bigint>>
  running: boolean
  interval?: NodeJS.Timeout
}
type SupportedDepositAsset = {
  chain: ScanChain
  pairId: CryptoOrder['pairId']
  network: string
  symbol: string
  decimals: number
  kind: 'erc20' | 'native'
  tokenAddress?: Address
}

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
  ]
}

function buildAddressLookup(addresses: CryptoDepositAddress[]) {
  const lookup = new Map<string, CryptoDepositAddress>()
  for (const item of addresses) {
    try {
      lookup.set(getAddress(item.address).toLowerCase(), item)
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
  state.lastBlockByKey[key] = latestBlock
  return { fromBlock, toBlock: latestBlock }
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
      return { event: existing, settled: false, duplicate: true }
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

  if (!order) return { event, settled: false, duplicate: false }

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

async function settleCryptoSellDeposit(input: {
  order: CryptoOrder
  event: CryptoDepositEvent
  txHash: string
  blockNumber?: string
  logIndex?: number
  amountUnits: string
  amountCrypto: number
}) {
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
  client: ReturnType<typeof createBaseClient> | ReturnType<typeof createBscClient>
  lookup: Map<string, CryptoDepositAddress>
}) {
  if (!input.asset.tokenAddress) return { detected: 0, settled: 0 }

  const latestBlock = await input.client.getBlockNumber()
  const { fromBlock, toBlock } = getScanRange(`${input.asset.chain}:${input.asset.pairId}:erc20`, latestBlock)
  const logs = await input.client.getLogs({
    address: input.asset.tokenAddress,
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock,
  })

  let detected = 0
  let settled = 0
  for (const log of logs) {
    const to = typeof log.args.to === 'string' ? log.args.to : ''
    const address = input.lookup.get(to.toLowerCase())
    if (!address) continue
    const value = typeof log.args.value === 'bigint' ? log.args.value : BigInt(0)
    const txHash = log.transactionHash
    const externalEventId = `${input.asset.chain}:${input.asset.pairId}:${txHash}:${log.logIndex?.toString() ?? '0'}`
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

  return { detected, settled }
}

async function scanNativeDeposits(input: {
  asset: SupportedDepositAsset
  client: ReturnType<typeof createBaseClient> | ReturnType<typeof createBscClient>
  lookup: Map<string, CryptoDepositAddress>
}) {
  const latestBlock = await input.client.getBlockNumber()
  const { fromBlock, toBlock } = getScanRange(`${input.asset.chain}:${input.asset.pairId}:native`, latestBlock)
  let detected = 0
  let settled = 0

  for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += BigInt(1)) {
    const block = await input.client.getBlock({ blockNumber, includeTransactions: true })
    for (const tx of block.transactions) {
      if (typeof tx === 'string') continue
      if (!tx.to || tx.value <= BigInt(0)) continue
      const address = input.lookup.get(tx.to.toLowerCase())
      if (!address) continue
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

  return { detected, settled }
}

export async function syncCryptoDepositEventsOnce() {
  const state = getScannerState()
  if (state.running) return { skipped: true, detected: 0, settled: 0, errors: [] as string[] }
  state.running = true

  try {
    const addresses = await listCryptoDepositAddressesByFamily('evm')
    const lookup = buildAddressLookup(addresses)
    if (lookup.size === 0) return { skipped: false, detected: 0, settled: 0, errors: [] as string[] }

    const baseClient = createBaseClient()
    const bscClient = createBscClient()
    let detected = 0
    let settled = 0
    const errors: string[] = []

    for (const asset of getSupportedAssets()) {
      try {
        const client = asset.chain === 'base' ? baseClient : bscClient
        const result = asset.kind === 'erc20'
          ? await scanErc20Deposits({ asset, client, lookup })
          : await scanNativeDeposits({ asset, client, lookup })
        detected += result.detected
        settled += result.settled
      } catch (error) {
        errors.push(`${asset.pairId}: ${error instanceof Error ? error.message : 'scan failed'}`)
      }
    }

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
