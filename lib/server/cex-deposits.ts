import { createHmac } from 'node:crypto'
import {
  createCryptoDepositEvent,
  getCryptoAssets,
  getCexDepositAccountByExternalUid,
  getCexDepositSyncState,
  listCexInboundTransfers,
  markCexDepositAccountVerified,
  saveCexDepositSyncState,
  updateCexInboundTransfer,
  upsertCexInboundTransfer,
} from '@/lib/server/data'
import { settleDirectCryptoDeposit } from '@/lib/server/crypto-deposit-scanner'
import type { CexExchange } from '@/types'

type BybitInternalDeposit = {
  id?: string
  type?: number
  coin?: string
  amount?: string
  status?: number
  createdTime?: string
  fromMemberId?: string
  txID?: string
}

type BybitResponse = {
  retCode?: number
  retMsg?: string
  result?: { rows?: BybitInternalDeposit[]; nextPageCursor?: string }
}

type BitgetInternalDeposit = {
  orderId?: string
  tradeId?: string
  coin?: string
  type?: string
  dest?: string
  size?: string
  status?: string
  fromAddress?: string
  toAddress?: string
  cTime?: string
  uTime?: string
}

type BitgetResponse = {
  code?: string
  msg?: string
  data?: BitgetInternalDeposit[]
}

const BYBIT: CexExchange = 'bybit'
const BITGET: CexExchange = 'bitget'
const RECV_WINDOW = '10000'
const MAX_PAGES_PER_PASS = 2
const PAGE_LIMIT = 100
const OVERLAP_MS = 5 * 60_000
const BITGET_OVERLAP_MS = 24 * 60 * 60_000

function bybitConfig() {
  if (process.env.MAFITAPAY_CEX_DEPOSITS_ENABLED !== '1') return null
  const apiKey = process.env.MAFITAPAY_BYBIT_API_KEY?.trim()
  const apiSecret = process.env.MAFITAPAY_BYBIT_API_SECRET?.trim()
  const receiverUid = process.env.MAFITAPAY_BYBIT_DEPOSIT_UID?.trim()
  if (!apiKey || !apiSecret || !receiverUid) return null
  return { apiKey, apiSecret, receiverUid }
}

function bitgetConfig() {
  if (process.env.MAFITAPAY_CEX_DEPOSITS_ENABLED !== '1') return null
  const apiKey = process.env.MAFITAPAY_BITGET_API_KEY?.trim()
  const apiSecret = process.env.MAFITAPAY_BITGET_API_SECRET?.trim()
  const apiPassphrase = process.env.MAFITAPAY_BITGET_API_PASSPHRASE?.trim()
  const receiverUid = process.env.MAFITAPAY_BITGET_DEPOSIT_UID?.trim()
  if (!apiKey || !apiSecret || !apiPassphrase || !receiverUid) return null
  return { apiKey, apiSecret, apiPassphrase, receiverUid }
}

function signBybit(timestamp: string, apiKey: string, apiSecret: string, query: string) {
  return createHmac('sha256', apiSecret).update(`${timestamp}${apiKey}${RECV_WINDOW}${query}`).digest('hex')
}

async function fetchBybitPage(input: {
  startTime: number
  endTime: number
  cursor?: string
  txId?: string
}) {
  const config = bybitConfig()
  if (!config) throw new Error('Bybit internal deposit credentials are not configured.')

  const params = new URLSearchParams({ limit: input.txId ? '1' : '50' })
  if (input.txId) params.set('txID', input.txId)
  else {
    params.set('startTime', String(input.startTime))
    params.set('endTime', String(input.endTime))
  }
  if (input.cursor) params.set('cursor', input.cursor)
  const query = params.toString()
  const timestamp = String(Date.now())
  const response = await fetch(`https://api.bybit.com/v5/asset/deposit/query-internal-record?${query}`, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': config.apiKey,
      'X-BAPI-SIGN': signBybit(timestamp, config.apiKey, config.apiSecret, query),
      'X-BAPI-SIGN-TYPE': '2',
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(9_000),
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`Bybit deposit history returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`)
  }
  const payload = await response.json() as BybitResponse
  if (payload.retCode !== 0) throw new Error(`Bybit deposit history failed with code ${payload.retCode ?? 'unknown'}.`)
  return {
    rows: payload.result?.rows ?? [],
    nextCursor: payload.result?.nextPageCursor || undefined,
  }
}

function signBitget(timestamp: string, apiSecret: string, query: string) {
  const content = `${timestamp}GET/api/v2/spot/wallet/deposit-records${query ? `?${query}` : ''}`
  return createHmac('sha256', apiSecret).update(content).digest('base64')
}

async function fetchBitgetPage(input: {
  startTime: number
  endTime: number
  idLessThan?: string
  orderId?: string
}) {
  const config = bitgetConfig()
  if (!config) throw new Error('Bitget internal deposit credentials are not configured.')

  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
  params.set('startTime', String(input.startTime))
  params.set('endTime', String(input.endTime))
  if (input.orderId) {
    params.set('orderId', input.orderId)
  } else {
    if (input.idLessThan) params.set('idLessThan', input.idLessThan)
  }
  const query = params.toString()
  const timestamp = String(Date.now())
  const response = await fetch(`https://api.bitget.com/api/v2/spot/wallet/deposit-records?${query}`, {
    method: 'GET',
    headers: {
      'ACCESS-KEY': config.apiKey,
      'ACCESS-SIGN': signBitget(timestamp, config.apiSecret, query),
      'ACCESS-PASSPHRASE': config.apiPassphrase,
      'ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
      locale: 'en-US',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(9_000),
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`Bitget deposit history returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`)
  }
  const payload = await response.json() as BitgetResponse
  if (payload.code !== '00000') throw new Error(`Bitget deposit history failed: ${payload.msg || payload.code || 'unknown error'}.`)
  return payload.data ?? []
}

function getAmount(value: string | undefined) {
  if (!value || !/^\d+(?:\.\d{1,12})?$/.test(value)) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function normalizeIdentifier(value: string | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeSenderIdentifier(exchange: CexExchange, value: string | undefined) {
  const identifier = value?.trim() ?? ''
  if (/^\d{4,24}$/.test(identifier)) return identifier
  if (exchange !== BITGET) return ''
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return identifier.toLowerCase()
  if (/^\+?[0-9][0-9 ()-]{5,23}$/.test(identifier)) return identifier.replace(/[ ()-]/g, '')
  return ''
}

async function acceptCexTransfer(input: {
  exchange: CexExchange
  externalTransferId: string
  senderUid: string
  receiverUid: string
  assetSymbol: string
  amount: number
  amountUnits: string
  providerStatus: string
  isSuccessful: boolean
  receivedAtMs: number
  providerPayload: Record<string, unknown>
}) {
  const {
    exchange, externalTransferId, senderUid, receiverUid, assetSymbol, amount,
    amountUnits, providerStatus, isSuccessful, receivedAtMs, providerPayload,
  } = input
  const normalizedSenderUid = normalizeSenderIdentifier(exchange, senderUid)
  if (!externalTransferId || !amount || !normalizedSenderUid || !Number.isFinite(receivedAtMs)) return false

  const transfer = await upsertCexInboundTransfer({
    exchange,
    externalTransferId,
    senderUid: normalizedSenderUid,
    receiverUid,
    assetSymbol,
    amount,
    providerStatus,
    attributionStatus: 'unmatched',
    receivedAt: new Date(receivedAtMs).toISOString(),
    providerPayload,
  })

  if (!isSuccessful || transfer.attributionStatus === 'credited' || transfer.attributionStatus === 'ignored') return false

  let account = await getCexDepositAccountByExternalUid(exchange, normalizedSenderUid)
  if (!account) {
    await updateCexInboundTransfer({ id: transfer.id, attributionStatus: 'unmatched' })
    return false
  }

  if (account.status === 'pending_verification') {
    const exactChallenge = Math.round(amount * 100) === Math.round(account.challengeAmount * 100)
    const arrivedBeforeExpiry = new Date(transfer.receivedAt).getTime() <= new Date(account.challengeExpiresAt).getTime()
    if (!exactChallenge || !arrivedBeforeExpiry) {
      await updateCexInboundTransfer({ id: transfer.id, attributionStatus: 'pending_verification', creditedUserId: account.userId })
      return false
    }
    const verified = await markCexDepositAccountVerified(account.id)
    if (verified) account = verified
    else account = await getCexDepositAccountByExternalUid(exchange, senderUid)
    if (!account || account.status !== 'verified') return false
  }

  if (account.status !== 'verified') return false

  const externalEventId = `cex_${exchange}_${transfer.externalTransferId}`
  const assets = await getCryptoAssets()
  const enabledAssets = assets.filter(item => item.symbol.toUpperCase() === assetSymbol && item.isActive !== false && item.sellEnabled !== false)
  const preferredPairId = assetSymbol === 'USDT' ? 'USDT_BSC' : 'USDC_BASE'
  const asset = enabledAssets.find(item => item.id === preferredPairId) ?? enabledAssets[0]
  if (!asset) {
    await updateCexInboundTransfer({ id: transfer.id, attributionStatus: 'processing', creditedUserId: account.userId })
    return false
  }

  const network = `${exchange === BYBIT ? 'Bybit' : 'Bitget'} internal transfer`
  const event = await createCryptoDepositEvent({
    externalEventId,
    userId: account.userId,
    addressId: null,
    pairId: asset.id,
    network,
    assetSymbol,
    amountCrypto: amount,
    amountUnits,
    txHash: null,
    status: 'unmatched',
    sweepStatus: 'skipped',
    payload: { source: `${exchange}_internal`, exchangeTransferId: transfer.externalTransferId },
    source: 'cex_internal',
    cexExchange: exchange,
    cexUid: receiverUid,
    cexTxId: transfer.externalTransferId,
  })

  await updateCexInboundTransfer({
    id: transfer.id,
    attributionStatus: event.status === 'matched' ? 'credited' : 'processing',
    creditedUserId: account.userId,
    cryptoEventId: event.id,
    transactionId: event.transactionId,
  })
  if (event.status === 'matched') return true

  const settled = await settleDirectCryptoDeposit({
    event,
    asset: {
      pairId: asset.id,
      network,
      symbol: asset.symbol,
      sellRate: asset.sellRate,
    },
  })
  await updateCexInboundTransfer({
    id: transfer.id,
    attributionStatus: settled.status === 'matched' ? 'credited' : 'processing',
    creditedUserId: account.userId,
    cryptoEventId: settled.id,
    transactionId: settled.transactionId,
  })
  return settled.status === 'matched'
}

async function acceptBybitTransfer(row: BybitInternalDeposit, receiverUid: string) {
  const assetSymbol = row.coin?.toUpperCase()
  if (row.type !== 1 || (assetSymbol !== 'USDT' && assetSymbol !== 'USDC')) return false
  const transferId = row.txID?.trim() || row.id?.trim() || ''
  const amount = getAmount(row.amount)
  const createdTime = Number(row.createdTime)
  const receivedAtMs = createdTime < 1_000_000_000_000 ? createdTime * 1000 : createdTime
  if (!transferId || !amount || !Number.isFinite(receivedAtMs)) return false
  return acceptCexTransfer({
    exchange: BYBIT,
    externalTransferId: transferId,
    senderUid: row.fromMemberId?.trim() || '',
    receiverUid,
    assetSymbol,
    amount,
    amountUnits: row.amount!,
    providerStatus: String(row.status ?? 'unknown'),
    isSuccessful: Number(row.status) === 2,
    receivedAtMs,
    providerPayload: { type: row.type, coin: assetSymbol, status: row.status ?? null },
  })
}

async function acceptBitgetTransfer(row: BitgetInternalDeposit, receiverUid: string) {
  const assetSymbol = row.coin?.toUpperCase()
  if (row.type?.toLowerCase() !== 'deposit' || row.dest?.toLowerCase() !== 'internal_transfer' || (assetSymbol !== 'USDT' && assetSymbol !== 'USDC')) return false
  // Deposit history can also contain on-chain records. Only accept internal transfers addressed to the configured MafitaPay UID.
  if (normalizeIdentifier(row.toAddress) !== normalizeIdentifier(receiverUid)) return false
  const transferId = row.orderId?.trim() || row.tradeId?.trim() || ''
  const amount = getAmount(row.size)
  const receivedAtMs = Number(row.cTime || row.uTime)
  const senderUid = normalizeSenderIdentifier(BITGET, row.fromAddress)
  if (!transferId || !amount || !Number.isFinite(receivedAtMs)) return false
  return acceptCexTransfer({
    exchange: BITGET,
    externalTransferId: transferId,
    senderUid,
    receiverUid,
    assetSymbol,
    amount,
    amountUnits: row.size!,
    providerStatus: row.status?.toLowerCase() ?? 'unknown',
    isSuccessful: row.status?.toLowerCase() === 'success',
    receivedAtMs,
    providerPayload: { type: row.type, dest: row.dest, coin: assetSymbol, status: row.status ?? null },
  })
}

async function syncBybitInternalDeposits() {
  const config = bybitConfig()
  if (!config) return { configured: false, exchange: BYBIT, checked: 0, credited: 0, morePages: false }

  let state = await getCexDepositSyncState(BYBIT)
  let windowStartMs: number
  let windowEndMs: number
  let cursor: string | undefined

  if (state?.nextCursor) {
    windowStartMs = state.windowStartMs
    windowEndMs = state.windowEndMs
    cursor = state.nextCursor
  } else {
    windowEndMs = Date.now()
    windowStartMs = state ? Math.max(0, state.windowEndMs - OVERLAP_MS) : windowEndMs - 24 * 60 * 60_000
  }

  let checked = 0
  let credited = 0
  let pages = 0
  do {
    const page = await fetchBybitPage({ startTime: windowStartMs, endTime: windowEndMs, cursor })
    for (const row of page.rows) {
      checked += 1
      if (await acceptBybitTransfer(row, config.receiverUid)) credited += 1
    }
    cursor = page.nextCursor
    pages += 1
    await saveCexDepositSyncState({ exchange: BYBIT, windowStartMs, windowEndMs, nextCursor: cursor })
  } while (cursor && pages < MAX_PAGES_PER_PASS)

  const [pendingProviderTransfers, processingTransfers] = await Promise.all([
    listCexInboundTransfers({ providerStatus: '1', limit: 20 }),
    listCexInboundTransfers({ status: 'processing', limit: 20 }),
  ])
  const recheckTransfers = [...new Map([...processingTransfers, ...pendingProviderTransfers]
    .filter(item => item.exchange === BYBIT)
    .map(item => [item.id, item])).values()].slice(0, 10)
  for (const transfer of recheckTransfers) {
    const pendingPage = await fetchBybitPage({ startTime: 0, endTime: 0, txId: transfer.externalTransferId })
    for (const row of pendingPage.rows) {
      checked += 1
      if (await acceptBybitTransfer(row, config.receiverUid)) credited += 1
    }
  }

  return { configured: true, exchange: BYBIT, checked, credited, pages, morePages: Boolean(cursor) }
}

async function syncBitgetInternalDeposits() {
  const config = bitgetConfig()
  if (!config) return { configured: false, exchange: BITGET, checked: 0, credited: 0, morePages: false }

  const state = await getCexDepositSyncState(BITGET)
  const windowEndMs = state?.nextCursor ? state.windowEndMs : Date.now()
  const windowStartMs = state?.nextCursor
    ? state.windowStartMs
    : state ? Math.max(0, state.windowEndMs - BITGET_OVERLAP_MS) : windowEndMs - BITGET_OVERLAP_MS
  let cursor = state?.nextCursor || undefined
  let checked = 0
  let credited = 0
  let internalTransfers = 0
  let recipientMatches = 0
  let pages = 0
  do {
    const rows = await fetchBitgetPage({ startTime: windowStartMs, endTime: windowEndMs, idLessThan: cursor })
    for (const row of rows) {
      checked += 1
      if (row.type?.toLowerCase() === 'deposit' && row.dest?.toLowerCase() === 'internal_transfer') {
        internalTransfers += 1
        if (normalizeIdentifier(row.toAddress) === normalizeIdentifier(config.receiverUid)) recipientMatches += 1
      }
      if (await acceptBitgetTransfer(row, config.receiverUid)) credited += 1
    }
    const nextCursor = rows.length >= PAGE_LIMIT
      ? rows.map(row => row.orderId).filter((id): id is string => Boolean(id)).sort((a, b) => {
        if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
          const left = BigInt(a)
          const right = BigInt(b)
          return left < right ? -1 : left > right ? 1 : 0
        }
        return a.localeCompare(b)
      })[0]
      : undefined
    if (nextCursor && nextCursor === cursor) throw new Error('Bitget deposit history pagination did not advance.')
    cursor = nextCursor
    pages += 1
    await saveCexDepositSyncState({ exchange: BITGET, windowStartMs, windowEndMs, nextCursor: cursor })
  } while (cursor && pages < MAX_PAGES_PER_PASS)

  // Recheck a small number of recent, unsettled entries by exact order ID.
  const [pendingProviderTransfers, processingTransfers] = await Promise.all([
    listCexInboundTransfers({ providerStatus: 'pending', limit: 50 }),
    listCexInboundTransfers({ status: 'processing', limit: 50 }),
  ])
  const recheckTransfers = [...new Map([...processingTransfers, ...pendingProviderTransfers]
    .filter(item => item.exchange === BITGET)
    .map(item => [item.id, item])).values()].slice(0, 10)
  for (const transfer of recheckTransfers) {
    const receivedAt = new Date(transfer.receivedAt).getTime()
    const rows = await fetchBitgetPage({ startTime: Math.max(0, receivedAt - 60_000), endTime: receivedAt + 60_000, orderId: transfer.externalTransferId })
    for (const row of rows) {
      checked += 1
      if (row.type?.toLowerCase() === 'deposit' && row.dest?.toLowerCase() === 'internal_transfer') {
        internalTransfers += 1
        if (normalizeIdentifier(row.toAddress) === normalizeIdentifier(config.receiverUid)) recipientMatches += 1
      }
      if (await acceptBitgetTransfer(row, config.receiverUid)) credited += 1
    }
  }

  return { configured: true, exchange: BITGET, checked, internalTransfers, recipientMatches, credited, pages, morePages: Boolean(cursor) }
}

export async function syncCexInternalDepositsOnce() {
  const results = await Promise.allSettled([syncBybitInternalDeposits(), syncBitgetInternalDeposits()])
  return {
    exchanges: results.map((result, index) => result.status === 'fulfilled'
      ? result.value
      : { exchange: index === 0 ? BYBIT : BITGET, error: result.reason instanceof Error ? result.reason.message : 'CEX sync failed' }),
  }
}
