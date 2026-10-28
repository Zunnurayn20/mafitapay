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

const EXCHANGE = 'bybit' as const
const RECV_WINDOW = '10000'
const MAX_PAGES_PER_PASS = 2

function bybitConfig() {
  if (process.env.MAFITAPAY_CEX_DEPOSITS_ENABLED !== '1') return null
  const apiKey = process.env.MAFITAPAY_BYBIT_API_KEY?.trim()
  const apiSecret = process.env.MAFITAPAY_BYBIT_API_SECRET?.trim()
  const receiverUid = process.env.MAFITAPAY_BYBIT_DEPOSIT_UID?.trim()
  if (!apiKey || !apiSecret || !receiverUid) return null
  return { apiKey, apiSecret, receiverUid }
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

  const params = new URLSearchParams({ coin: 'USDT', limit: input.txId ? '1' : '50' })
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

function getAmount(value: string | undefined) {
  if (!value || !/^\d+(?:\.\d{1,12})?$/.test(value)) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function getBybitTransferId(row: BybitInternalDeposit) {
  return row.txID?.trim() || row.id?.trim() || ''
}

async function acceptTransfer(row: BybitInternalDeposit, receiverUid: string) {
  if (row.type !== 1 || row.coin?.toUpperCase() !== 'USDT') return false
  const transferId = getBybitTransferId(row)
  const amount = getAmount(row.amount)
  const senderUid = row.fromMemberId?.trim()
  const createdTime = Number(row.createdTime)
  const receivedAtMs = createdTime < 1_000_000_000_000 ? createdTime * 1000 : createdTime
  if (!transferId || !amount || !senderUid || !/^\d{4,24}$/.test(senderUid) || !Number.isFinite(receivedAtMs)) return false

  const transfer = await upsertCexInboundTransfer({
    exchange: EXCHANGE,
    externalTransferId: transferId,
    senderUid,
    receiverUid,
    assetSymbol: 'USDT',
    amount,
    providerStatus: String(row.status ?? 'unknown'),
    attributionStatus: 'unmatched',
    receivedAt: new Date(receivedAtMs).toISOString(),
    // Deliberately persist only the fields needed to audit a credit; Bybit also returns masked contact data.
    providerPayload: { type: row.type, coin: 'USDT', status: row.status ?? null },
  })

  if (Number(row.status) !== 2 || transfer.attributionStatus === 'credited' || transfer.attributionStatus === 'ignored') return false

  let account = await getCexDepositAccountByExternalUid(EXCHANGE, senderUid)
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
    else account = await getCexDepositAccountByExternalUid(EXCHANGE, senderUid)
    if (!account || account.status !== 'verified') return false
  }

  if (account.status !== 'verified') return false

  const externalEventId = `cex_${EXCHANGE}_${transfer.externalTransferId}`
  const assets = await getCryptoAssets()
  const enabledUsdtAssets = assets.filter(item => item.symbol.toUpperCase() === 'USDT' && item.isActive !== false && item.sellEnabled !== false)
  const asset = enabledUsdtAssets.find(item => item.id === 'USDT_BSC') ?? enabledUsdtAssets[0]
  if (!asset) {
    await updateCexInboundTransfer({ id: transfer.id, attributionStatus: 'processing', creditedUserId: account.userId })
    return false
  }

  const event = await createCryptoDepositEvent({
    externalEventId,
    userId: account.userId,
    addressId: null,
    pairId: asset.id,
    network: 'Bybit internal transfer',
    assetSymbol: 'USDT',
    amountCrypto: amount,
    amountUnits: row.amount!,
    txHash: null,
    status: 'unmatched',
    sweepStatus: 'skipped',
    payload: { source: 'bybit_internal', exchangeTransferId: transfer.externalTransferId },
    source: 'cex_internal',
    cexExchange: EXCHANGE,
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

  const settled = await settleDirectCryptoDeposit({ event, asset: { ...asset, network: 'Bybit internal transfer' } as any })
  const transactionId = settled.transactionId
  await updateCexInboundTransfer({
    id: transfer.id,
    attributionStatus: settled.status === 'matched' ? 'credited' : 'processing',
    creditedUserId: account.userId,
    cryptoEventId: settled.id,
    transactionId,
  })
  return settled.status === 'matched'
}

export async function syncCexInternalDepositsOnce() {
  const config = bybitConfig()
  if (!config) return { configured: false, exchange: EXCHANGE, checked: 0, credited: 0, morePages: false }

  let state = await getCexDepositSyncState(EXCHANGE)
  let windowStartMs: number
  let windowEndMs: number
  let cursor: string | undefined

  if (state?.nextCursor) {
    windowStartMs = state.windowStartMs
    windowEndMs = state.windowEndMs
    cursor = state.nextCursor
  } else {
    windowEndMs = Date.now()
    // A five-minute overlap makes a completed poll resilient to provider indexing delay.
    windowStartMs = state ? Math.max(0, state.windowEndMs - 5 * 60_000) : windowEndMs - 24 * 60 * 60_000
  }

  let checked = 0
  let credited = 0
  let pages = 0
  do {
    const page = await fetchBybitPage({ startTime: windowStartMs, endTime: windowEndMs, cursor })
    for (const row of page.rows) {
      checked += 1
      if (await acceptTransfer(row, config.receiverUid)) credited += 1
    }
    cursor = page.nextCursor
    pages += 1
    await saveCexDepositSyncState({
      exchange: EXCHANGE,
      windowStartMs,
      windowEndMs,
      nextCursor: cursor,
    })
  } while (cursor && pages < MAX_PAGES_PER_PASS)

  const [pendingProviderTransfers, processingTransfers] = await Promise.all([
    listCexInboundTransfers({ providerStatus: '1', limit: 2 }),
    listCexInboundTransfers({ status: 'processing', limit: 2 }),
  ])
  const recheckTransfers = [...new Map([...processingTransfers, ...pendingProviderTransfers].map(item => [item.id, item])).values()].slice(0, 2)
  for (const transfer of recheckTransfers) {
    const pendingPage = await fetchBybitPage({ startTime: 0, endTime: 0, txId: transfer.externalTransferId })
    for (const row of pendingPage.rows) {
      checked += 1
      if (await acceptTransfer(row, config.receiverUid)) credited += 1
    }
  }

  return { configured: true, exchange: EXCHANGE, checked, credited, pages, morePages: Boolean(cursor) }
}
