import { createHmac } from 'node:crypto'

type BinanceDeposit = {
  coin?: unknown
  amount?: unknown
  status?: unknown
  network?: unknown
  transferType?: unknown
  txId?: unknown
  tranId?: unknown
  insertTime?: unknown
  completeTime?: unknown
  memo?: unknown
  remark?: unknown
  senderUid?: unknown
  fromUid?: unknown
  fromId?: unknown
  senderId?: unknown
  senderEmail?: unknown
  fromEmail?: unknown
}

function getConfig() {
  const apiKey = process.env.MAFITAPAY_BINANCE_API_KEY?.trim()
  const apiSecret = process.env.MAFITAPAY_BINANCE_API_SECRET?.trim()
  const depositUid = process.env.MAFITAPAY_BINANCE_DEPOSIT_UID?.trim()
  return apiKey && apiSecret && depositUid ? { apiKey, apiSecret } : null
}

export function isBinanceDepositDiagnosticConfigured() {
  return getConfig() !== null
}

function stringOrNull(value: unknown) {
  if (typeof value === 'string' && value.length <= 500) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function sign(query: string, secret: string) {
  return createHmac('sha256', secret).update(query).digest('hex')
}

export async function inspectRecentBinanceUsdtDeposits() {
  const config = getConfig()
  if (!config) throw new Error('Binance diagnostic credentials are not configured.')

  const timeResponse = await fetch('https://api.binance.com/api/v3/time', {
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  if (!timeResponse.ok) {
    const detail = (await timeResponse.text().catch(() => '')).slice(0, 240)
    const regionalHint = timeResponse.status === 451 ? ' Binance may be blocking the server region or network.' : ''
    throw new Error(`Binance time endpoint returned HTTP ${timeResponse.status}.${regionalHint}${detail ? ` ${detail}` : ''}`)
  }
  const timePayload = await timeResponse.json() as { serverTime?: number }
  const timestamp = Number.isSafeInteger(timePayload.serverTime) ? timePayload.serverTime! : Date.now()
  const params = new URLSearchParams({
    coin: 'USDT',
    startTime: String(timestamp - 24 * 60 * 60 * 1000),
    endTime: String(timestamp),
    limit: '100',
    recvWindow: '10000',
    timestamp: String(timestamp),
  })
  const query = params.toString()
  const response = await fetch(`https://api.binance.com/sapi/v1/capital/deposit/hisrec?${query}&signature=${sign(query, config.apiSecret)}`, {
    headers: { 'X-MBX-APIKEY': config.apiKey, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`Binance deposit history returned HTTP ${response.status}.`)

  const payload = await response.json() as BinanceDeposit[] | { code?: number; msg?: string }
  if (!Array.isArray(payload)) {
    const code = typeof payload.code === 'number' ? payload.code : undefined
    throw new Error(code === undefined ? 'Binance returned an unexpected response.' : `Binance rejected the request (code ${code}).`)
  }

  const records = payload
    .filter((row) => stringOrNull(row.coin)?.toUpperCase() === 'USDT')
    .slice(0, 100)
    .map((row) => ({
      asset: 'USDT',
      amount: stringOrNull(row.amount),
      status: stringOrNull(row.status),
      network: stringOrNull(row.network),
      transferType: stringOrNull(row.transferType),
      transferId: stringOrNull(row.txId) ?? stringOrNull(row.tranId),
      receivedAt: stringOrNull(row.insertTime),
      completedAt: stringOrNull(row.completeTime),
      memo: stringOrNull(row.memo) ?? stringOrNull(row.remark),
      senderUid: stringOrNull(row.senderUid) ?? stringOrNull(row.fromUid) ?? stringOrNull(row.fromId) ?? stringOrNull(row.senderId),
      senderEmail: stringOrNull(row.senderEmail) ?? stringOrNull(row.fromEmail),
    }))

  return { checkedAt: new Date().toISOString(), windowHours: 24, records }
}
