import { execFile } from 'node:child_process'
import * as https from 'node:https'
import { promisify } from 'node:util'
import { Account, FailoverRpcProvider, JsonRpcProvider, type KeyPairString } from 'near-api-js'
import { NEAR } from 'near-api-js/tokens'
import { broadcastBaseUsdcTransfer, getBaseExecutorConfig, getBaseExecutorHealth, getBaseTreasuryBalances } from '@/lib/server/base-executor'
import { getCryptoAssetById, listCryptoOrders } from '@/lib/server/data'
import type { CryptoOrder } from '@/types'

const DEFAULT_NEAR_INTENTS_BASE_URL = 'https://1click.chaindefuser.com/v0'
const DEFAULT_BASE_USDC_ASSET_ID = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
const DEFAULT_NEAR_DESTINATION_ASSET_ID = 'nep141:wrap.near'
const DEFAULT_NEAR_RPC_URLS = ['https://near.drpc.org', 'https://near.lava.build']
const DEFAULT_QUOTE_SLIPPAGE_BPS = 100
const DEFAULT_QUOTE_WAITING_TIME_MS = 3_000
const MIN_NEAR_PAYOUT_GAS_RESERVE = NEAR.toUnits('0.05')
const MIN_NEAR_PAYOUT_TX_BUFFER = NEAR.toUnits('0.05')
const UPSTREAM_FETCH_TIMEOUT_MS = 12_000
const execFileAsync = promisify(execFile)
const NEAR_RPC_SHORTHAND_MAP: Record<string, string> = {
  'https://fastnear.com': 'https://free.rpc.fastnear.com',
  'http://fastnear.com': 'https://free.rpc.fastnear.com',
}

type NearIntentsQuoteRequest = {
  dry: boolean
  swapType: 'EXACT_INPUT'
  slippageTolerance: number
  originAsset: string
  depositType: 'ORIGIN_CHAIN'
  destinationAsset: string
  amount: string
  recipient: string
  recipientType: 'DESTINATION_CHAIN'
  refundTo: string
  refundType: 'ORIGIN_CHAIN'
  deadline: string
  quoteWaitingTimeMs: number
}

type NearIntentsQuoteResponse = {
  correlationId?: string
  timestamp?: string
  signature?: string
  quoteRequest?: NearIntentsQuoteRequest
  quote?: {
    amountIn?: string
    amountInFormatted?: string
    amountInUsd?: string
    minAmountIn?: string
    amountOut?: string
    amountOutFormatted?: string
    amountOutUsd?: string
    minAmountOut?: string
    timeEstimate?: number
    depositAddress?: string
    depositMemo?: string
    deadline?: string
    timeWhenInactive?: string
    refundFee?: string
  }
  message?: string
  error?: string
}

type NearIntentsStatusResponse = {
  correlationId?: string
  status?: 'KNOWN_DEPOSIT_TX' | 'PENDING_DEPOSIT' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED'
  updatedAt?: string
  quoteResponse?: NearIntentsQuoteResponse
  swapDetails?: {
    nearTxHashes?: string[]
    originChainTxHashes?: Array<{ hash?: string; explorerUrl?: string }>
    destinationChainTxHashes?: Array<{ hash?: string; explorerUrl?: string }>
    amountIn?: string
    amountInFormatted?: string
    amountOut?: string
    amountOutFormatted?: string
    refundedAmount?: string
    refundReason?: string
    depositedAmount?: string
    depositedAmountFormatted?: string
    referral?: string
  }
  message?: string
  error?: string
}

function logNear(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[near] ${event}${payload}`)
}

function formatAxiosLikeError(error: unknown) {
  if (!(error instanceof Error)) return 'Near Intents request failed.'
  return error.message || 'Near Intents request failed.'
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return 'Unknown error.'
}

function getNearPayoutContext() {
  const config = getNearPayoutConfig()
  return {
    accountId: config.accountId || null,
    rpcUrls: config.rpcUrls,
    rpcUrlCount: config.rpcUrls.length,
    privateKeyConfigured: Boolean(config.privateKey),
  }
}

function isNearAccessKeyMissingError(error: unknown) {
  return error instanceof Error && /Access key .* does not exist/i.test(error.message)
}

function isNearDeprecatedRpcError(error: unknown) {
  return error instanceof Error && /THIS ENDPOINT IS DEPRECATED|code": -429|Switch to https:\/\/fastnear\.com/i.test(error.message)
}

function isNearRpcRateLimitError(error: unknown) {
  return error instanceof Error && /429|Too Many Requests|rate limit/i.test(error.message)
}

function getNearConfigErrorMessage(error: unknown, fallback: string) {
  if (isNearAccessKeyMissingError(error)) {
    return 'NEAR treasury key is not a valid access key for the configured treasury account.'
  }
  if (isNearDeprecatedRpcError(error)) {
    return 'Configured NEAR RPC endpoint is deprecated. Update MAFITAPAY_NEAR_RPC_URL or MAFITAPAY_NEAR_RPC_URLS.'
  }
  if (isNearRpcRateLimitError(error)) {
    return 'NEAR RPC provider rate-limited the request. Update MAFITAPAY_NEAR_RPC_URL or MAFITAPAY_NEAR_RPC_URLS.'
  }
  if (error instanceof Error && /Exceeded \d+ providers/i.test(error.message)) {
    return fallback
  }
  return fallback
}

function toSmallestUnit(amount: number, decimals: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero.')
  }
  return BigInt(Math.round(amount * 10 ** decimals))
}

function fromSmallestUnit(amount: string, decimals: number) {
  const normalized = amount.trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Invalid token amount returned by provider.')
  }

  const padded = normalized.padStart(decimals + 1, '0')
  const integer = padded.slice(0, -decimals) || '0'
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  return Number(fraction ? `${integer}.${fraction}` : integer)
}

function buildNearHeaders() {
  const jwt = process.env.MAFITAPAY_NEAR_INTENTS_JWT?.trim()
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
  }
}

async function fetchJsonOverHttps<T>(input: {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}) {
  const url = new URL(input.url)

  return await new Promise<T>((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: input.method ?? 'GET',
      headers: {
        'user-agent': 'mafitapay/0.1.0',
        ...input.headers,
      },
    }, response => {
      const statusCode = response.statusCode ?? 0
      const statusText = response.statusMessage ?? ''
      let body = ''

      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) as T : null
          if (statusCode < 200 || statusCode >= 300) {
            const error = new Error(`Request failed with status code ${statusCode}`)
            ;(error as Error & { statusCode?: number; statusText?: string; data?: unknown }).statusCode = statusCode
            ;(error as Error & { statusCode?: number; statusText?: string; data?: unknown }).statusText = statusText
            ;(error as Error & { statusCode?: number; statusText?: string; data?: unknown }).data = parsed
            reject(error)
            return
          }
          resolve(parsed as T)
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Invalid JSON response.'))
        }
      })
    })

    request.setTimeout(UPSTREAM_FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error('Request timed out.'))
    })
    request.on('error', reject)
    if (input.body) request.write(input.body)
    request.end()
  })
}

async function fetchJsonViaCurl<T>(input: {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}) {
  const args = ['-sS', '--max-time', String(Math.ceil(UPSTREAM_FETCH_TIMEOUT_MS / 1000)), '-X', input.method ?? 'GET', input.url]
  for (const [key, value] of Object.entries({
    'user-agent': 'mafitapay/0.1.0',
    ...input.headers,
  })) {
    args.push('-H', `${key}: ${value}`)
  }
  if (input.body) args.push('--data', input.body)
  const { stdout } = await execFileAsync('curl', args)
  return JSON.parse(stdout) as T
}

function getNearIntentsBaseUrl() {
  return (process.env.MAFITAPAY_NEAR_INTENTS_BASE_URL?.trim() || DEFAULT_NEAR_INTENTS_BASE_URL).replace(/\/+$/, '')
}

function getNearPayoutConfig() {
  const configuredRpcUrls = (process.env.MAFITAPAY_NEAR_RPC_URLS?.trim() || process.env.MAFITAPAY_NEAR_RPC_URL?.trim() || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => NEAR_RPC_SHORTHAND_MAP[item] || item)

  const rpcUrls = (configuredRpcUrls.length > 0 ? configuredRpcUrls : DEFAULT_NEAR_RPC_URLS)
    .concat(DEFAULT_NEAR_RPC_URLS)
    .map(item => NEAR_RPC_SHORTHAND_MAP[item] || item)
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index)

  return {
    accountId: process.env.MAFITAPAY_NEAR_TREASURY_ACCOUNT_ID?.trim() || '',
    privateKey: process.env.MAFITAPAY_NEAR_TREASURY_PRIVATE_KEY?.trim() as KeyPairString | undefined,
    rpcUrls,
  }
}

function getNearPayoutProvider() {
  const config = getNearPayoutConfig()
  if (config.rpcUrls.length > 1) {
    return new FailoverRpcProvider(config.rpcUrls.map(url => new JsonRpcProvider({ url })))
  }
  return new JsonRpcProvider({ url: config.rpcUrls[0] })
}

function getNearTreasuryAccount() {
  const config = getNearPayoutConfig()
  if (!config.accountId) {
    throw new Error('MAFITAPAY_NEAR_TREASURY_ACCOUNT_ID is not configured.')
  }
  if (!config.privateKey) {
    throw new Error('MAFITAPAY_NEAR_TREASURY_PRIVATE_KEY is not configured.')
  }
  return new Account(config.accountId, getNearPayoutProvider(), config.privateKey)
}

function getNearOriginAssetId() {
  return process.env.MAFITAPAY_NEAR_BASE_USDC_ASSET_ID?.trim() || DEFAULT_BASE_USDC_ASSET_ID
}

function getNearDestinationAssetId() {
  return process.env.MAFITAPAY_NEAR_DESTINATION_ASSET_ID?.trim() || DEFAULT_NEAR_DESTINATION_ASSET_ID
}

async function getTreasuryUsdcAmount(amountNgn: number) {
  const usdcPair = await getCryptoAssetById('USDC_BASE')
  if (!usdcPair || !Number.isFinite(usdcPair.buyRate) || usdcPair.buyRate <= 0) {
    throw new Error('USDC_BASE pricing is unavailable for NEAR treasury conversion.')
  }

  const treasuryUsdcAmount = amountNgn / usdcPair.buyRate
  if (!Number.isFinite(treasuryUsdcAmount) || treasuryUsdcAmount <= 0) {
    throw new Error('Unable to convert order value into USDC treasury amount.')
  }

  return treasuryUsdcAmount
}

function getNearPayoutAmountYoctoFromProviderPayload(payload: Record<string, unknown>) {
  if (typeof payload.nativePayoutAmountYocto === 'string' && /^\d+$/.test(payload.nativePayoutAmountYocto)) {
    return BigInt(payload.nativePayoutAmountYocto)
  }

  const status = payload.status && typeof payload.status === 'object'
    ? payload.status as { swapDetails?: { amountOut?: string }; quoteResponse?: { quote?: { amountOut?: string } } }
    : null
  const quote = payload.quote && typeof payload.quote === 'object'
    ? payload.quote as { amountOut?: string }
    : null

  const amountOut =
    status?.swapDetails?.amountOut
    || status?.quoteResponse?.quote?.amountOut
    || quote?.amountOut

  if (typeof amountOut === 'string' && /^\d+$/.test(amountOut)) {
    return BigInt(amountOut)
  }

  return BigInt(0)
}

async function getOutstandingNearNativePayoutLiabilityYocto() {
  const orders = await listCryptoOrders({ status: 'pending', limit: 100 })
  return orders.reduce((total, order) => {
    if (order.executionRail !== 'near_intents') return total
    if (order.executionStatus !== 'broadcasted') return total
    if (order.providerStatus === 'NATIVE_PAYOUT_COMPLETED') return total

    const providerPayload = order.providerPayload ?? {}
    if (typeof providerPayload.nativePayoutTxHash === 'string' && providerPayload.nativePayoutTxHash) {
      return total
    }

    return total + getNearPayoutAmountYoctoFromProviderPayload(providerPayload)
  }, BigInt(0))
}

export async function assertNearIntentsTreasuryCanExecuteBuy(input: {
  amountNgn: number
}) {
  const health = getBaseExecutorHealth()
  if (!health.ready) {
    const reason = health.warnings[0] || 'Base executor is not ready.'
    throw new Error(reason)
  }

  const balances = await getBaseTreasuryBalances()
  const ethWei = BigInt(balances.ethWei)
  const usdcUnits = BigInt(balances.usdcUnits)
  const requiredUsdcAmount = await getTreasuryUsdcAmount(input.amountNgn)
  const requiredUsdcUnits = toSmallestUnit(requiredUsdcAmount, 6)

  if (ethWei <= BigInt(0)) {
    throw new Error('Base executor gas is too low for NEAR execution. Try again shortly.')
  }
  if (usdcUnits < requiredUsdcUnits) {
    throw new Error('USDC treasury is too low to fulfill this NEAR order right now.')
  }

  const nearAccount = getNearTreasuryAccount()
  let nearBalance: bigint
  try {
    nearBalance = await nearAccount.getBalance()
  } catch (error) {
    logNear('treasury.balances-error', {
      ...getNearPayoutContext(),
      message: formatUnknownError(error),
    })
    throw new Error(getNearConfigErrorMessage(
      error,
      'Unable to verify NEAR treasury balance. Check NEAR treasury key and RPC configuration.',
    ))
  }
  const outstandingNativePayoutYocto = await getOutstandingNearNativePayoutLiabilityYocto()
  const availableAfterOutstandingYocto = nearBalance - outstandingNativePayoutYocto
  logNear('treasury.balances', {
    accountId: nearAccount.accountId,
    nearYocto: nearBalance.toString(),
    outstandingNativePayoutYocto: outstandingNativePayoutYocto.toString(),
    availableAfterOutstandingYocto: availableAfterOutstandingYocto.toString(),
    requiredUsdcUnits: requiredUsdcUnits.toString(),
  })
  if (availableAfterOutstandingYocto < MIN_NEAR_PAYOUT_GAS_RESERVE + MIN_NEAR_PAYOUT_TX_BUFFER) {
    throw new Error('NEAR treasury gas is too low to fulfill this order right now.')
  }
}

function buildNearQuoteRequest(input: {
  amountNgn: number
  amountUnits: string
  recipient: string
}) {
  const baseConfig = getBaseExecutorConfig()
  const deadlineMs = Date.now() + 10 * 60 * 1000
  return {
    dry: false,
    swapType: 'EXACT_INPUT',
    slippageTolerance: Number(process.env.MAFITAPAY_NEAR_SLIPPAGE_BPS?.trim() || DEFAULT_QUOTE_SLIPPAGE_BPS),
    originAsset: getNearOriginAssetId(),
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: getNearDestinationAssetId(),
    amount: input.amountUnits,
    recipient: input.recipient,
    recipientType: 'DESTINATION_CHAIN',
    refundTo: baseConfig.configuredAddress,
    refundType: 'ORIGIN_CHAIN',
    deadline: new Date(deadlineMs).toISOString(),
    quoteWaitingTimeMs: DEFAULT_QUOTE_WAITING_TIME_MS,
  } satisfies NearIntentsQuoteRequest
}

function getNearFriendlyErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const payload = (error as Error & { data?: { message?: string; error?: string } }).data
    if (payload?.message) return payload.message
    if (payload?.error) return payload.error
    if (error.message) return error.message
  }
  return fallback
}

async function requestNearIntentsQuote(payload: NearIntentsQuoteRequest) {
  const requestUrl = `${getNearIntentsBaseUrl()}/quote`
  const body = JSON.stringify(payload)
  const headers = buildNearHeaders()

  try {
    return await fetchJsonOverHttps<NearIntentsQuoteResponse>({
      url: requestUrl,
      method: 'POST',
      headers,
      body,
    })
  } catch (error) {
    logNear('quote.fetch-error', {
      amount: payload.amount,
      recipient: payload.recipient,
      message: formatAxiosLikeError(error),
    })
    try {
      const response = await fetchJsonViaCurl<NearIntentsQuoteResponse>({
        url: requestUrl,
        method: 'POST',
        headers,
        body,
      })
      logNear('quote.success', {
        pairId: 'NEAR_NEAR',
        amount: payload.amount,
        amountOut: response.quote?.amountOut,
        transport: 'curl',
      })
      return response
    } catch (curlError) {
      logNear('quote.curl-error', {
        amount: payload.amount,
        recipient: payload.recipient,
        message: formatAxiosLikeError(curlError),
      })
      throw new Error(getNearFriendlyErrorMessage(curlError, 'NEAR quote provider is temporarily unavailable. Please try again.'))
    }
  }
}

export async function getNearQuotedReceiveForBuy(input: {
  amountNgn: number
  toAddress: string
}) {
  const nearTreasury = getNearTreasuryAccount()
  const treasuryUsdcAmount = await getTreasuryUsdcAmount(input.amountNgn)
  const treasuryUsdcUnits = toSmallestUnit(treasuryUsdcAmount, 6).toString()
  const requestPayload = buildNearQuoteRequest({
    amountNgn: input.amountNgn,
    amountUnits: treasuryUsdcUnits,
    recipient: nearTreasury.accountId,
  })

  logNear('quote.request', {
    pairId: 'NEAR_NEAR',
    amountNgn: input.amountNgn,
    originAsset: requestPayload.originAsset,
    destinationAsset: requestPayload.destinationAsset,
    recipient: nearTreasury.accountId,
    finalRecipient: input.toAddress,
  })

  const response = await requestNearIntentsQuote(requestPayload)
  if (!response.quote?.depositAddress || !response.quote.amountOut || !response.correlationId) {
    logNear('quote.invalid', {
      pairId: 'NEAR_NEAR',
      amountNgn: input.amountNgn,
      payload: response,
    })
    throw new Error(response.message || response.error || 'NEAR quote is missing deposit instructions.')
  }

  const cryptoAmount = fromSmallestUnit(response.quote.amountOut, 24)
  if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
    throw new Error('NEAR quote returned an invalid destination amount.')
  }

  const unitRate = input.amountNgn / cryptoAmount
  logNear('quote.success', {
    pairId: 'NEAR_NEAR',
    amountNgn: input.amountNgn,
    depositAddress: response.quote.depositAddress,
    depositMemo: response.quote.depositMemo ?? null,
    amountOut: response.quote.amountOut,
    minAmountOut: response.quote.minAmountOut,
  })

  return {
    cryptoAmount,
    unitRate,
    providerPayload: {
      pairId: 'NEAR_NEAR',
      treasuryUsdcAmount,
      treasuryUsdcUnits,
      originAsset: requestPayload.originAsset,
      destinationAsset: requestPayload.destinationAsset,
      recipient: nearTreasury.accountId,
      finalRecipient: input.toAddress,
      correlationId: response.correlationId,
      signature: response.signature,
      quoteRequest: response.quoteRequest ?? requestPayload,
      quote: response.quote,
    },
  }
}

export async function submitNearIntentsDepositForOrder(order: CryptoOrder) {
  if (order.executionRail !== 'near_intents' || order.pairId !== 'NEAR_NEAR') {
    throw new Error('Only NEAR_NEAR orders can be executed through the NEAR Intents rail.')
  }

  const providerPayload = { ...(order.providerPayload ?? {}) }
  const quote = providerPayload.quote && typeof providerPayload.quote === 'object'
    ? providerPayload.quote as NearIntentsQuoteResponse['quote']
    : null
  const depositAddress = typeof quote?.depositAddress === 'string' ? quote.depositAddress : ''
  const depositMemo = typeof quote?.depositMemo === 'string' ? quote.depositMemo : ''
  const amountIn = typeof quote?.amountIn === 'string'
    ? quote.amountIn
    : typeof providerPayload.treasuryUsdcUnits === 'string'
      ? providerPayload.treasuryUsdcUnits
      : ''

  if (!depositAddress || !amountIn) {
    throw new Error('NEAR quote is missing deposit address or treasury amount.')
  }

  const transfer = await broadcastBaseUsdcTransfer({
    to: depositAddress,
    amountUnits: amountIn,
  })

  providerPayload.depositAddress = depositAddress
  providerPayload.depositMemo = depositMemo || undefined
  providerPayload.originTxHash = transfer.hash
  providerPayload.originAmountUnits = amountIn

  try {
    const submitPayload = {
      depositAddress,
      txHash: transfer.hash,
      ...(depositMemo ? { depositMemo } : {}),
    }
    const submitResponse = await fetchJsonOverHttps<Record<string, unknown>>({
      url: `${getNearIntentsBaseUrl()}/deposit/submit`,
      method: 'POST',
      headers: buildNearHeaders(),
      body: JSON.stringify(submitPayload),
    }).catch(async error => {
      if (error instanceof Error && /(EAI_AGAIN|ETIMEDOUT|ENOTFOUND|ECONNRESET)/.test(error.message || '')) {
        return await fetchJsonViaCurl<Record<string, unknown>>({
          url: `${getNearIntentsBaseUrl()}/deposit/submit`,
          method: 'POST',
          headers: buildNearHeaders(),
          body: JSON.stringify(submitPayload),
        })
      }
      throw error
    })
    providerPayload.depositSubmit = submitResponse
    logNear('deposit.submit', {
      orderId: order.id,
      depositAddress,
      originTxHash: transfer.hash,
      depositMemo: depositMemo || null,
    })
  } catch (error) {
    providerPayload.depositSubmitError = getNearFriendlyErrorMessage(error, 'Deposit submit notification failed.')
    logNear('deposit.submit-error', {
      orderId: order.id,
      depositAddress,
      originTxHash: transfer.hash,
      message: getNearFriendlyErrorMessage(error, 'Deposit submit notification failed.'),
    })
  }

  return {
    hash: transfer.hash,
    from: transfer.from,
    to: transfer.to,
    amountUnits: transfer.amountUnits,
    providerPayload,
  }
}

function getNearTransactionHash(result: unknown) {
  if (result && typeof result === 'object') {
    const maybe = result as { transaction_outcome?: { id?: string }; transaction?: { hash?: string } }
    return maybe.transaction_outcome?.id || maybe.transaction?.hash || null
  }
  return null
}

export async function unwrapAndPayoutNearForOrder(input: {
  order: CryptoOrder
  amountYocto: string
}) {
  const { order, amountYocto } = input
  if (!/^\d+$/.test(amountYocto) || BigInt(amountYocto) <= BigInt(0)) {
    throw new Error('Invalid NEAR payout amount.')
  }

  const account = getNearTreasuryAccount()
  const providerPayload = { ...(order.providerPayload ?? {}) }
  const finalRecipient = typeof providerPayload.finalRecipient === 'string' ? providerPayload.finalRecipient : order.walletAddress || ''
  if (!finalRecipient) {
    throw new Error('NEAR final recipient is missing.')
  }

  let currentNearBalance: bigint
  try {
    currentNearBalance = await account.getBalance()
  } catch (error) {
    logNear('payout.balance-error', {
      orderId: order.id,
      ...getNearPayoutContext(),
      message: formatUnknownError(error),
    })
    throw new Error(getNearConfigErrorMessage(
      error,
      'Unable to verify NEAR treasury payout balance. Check NEAR treasury key and RPC configuration.',
    ))
  }
  logNear('payout.gas-check', {
    orderId: order.id,
    accountId: account.accountId,
    currentNearYocto: currentNearBalance.toString(),
    reserveYocto: MIN_NEAR_PAYOUT_GAS_RESERVE.toString(),
    txBufferYocto: MIN_NEAR_PAYOUT_TX_BUFFER.toString(),
    requiredPayoutBalanceYocto: (BigInt(amountYocto) + MIN_NEAR_PAYOUT_GAS_RESERVE + MIN_NEAR_PAYOUT_TX_BUFFER).toString(),
    payoutAmountYocto: amountYocto,
  })

  if (currentNearBalance < BigInt(amountYocto) + MIN_NEAR_PAYOUT_GAS_RESERVE + MIN_NEAR_PAYOUT_TX_BUFFER) {
    throw new Error('NEAR treasury native balance is too low to complete this payout right now.')
  }

  if (typeof providerPayload.unwrapTxHash !== 'string') {
    providerPayload.unwrapTxHash = 'handled-by-near-intents'
    logNear('payout.unwrap-skipped', {
      orderId: order.id,
      accountId: account.accountId,
      reason: 'near_intents already settled into native NEAR at treasury',
      amountYocto,
    })
  }

  if (typeof providerPayload.nativePayoutTxHash !== 'string') {
    let transferResult: unknown
    try {
      transferResult = await account.transfer({
        receiverId: finalRecipient,
        amount: BigInt(amountYocto),
        token: NEAR,
      })
    } catch (error) {
      logNear('payout.transfer-error', {
        orderId: order.id,
        receiverId: finalRecipient,
        ...getNearPayoutContext(),
        message: formatUnknownError(error),
      })
      throw new Error(getNearConfigErrorMessage(
        error,
        'Unable to send native NEAR payout. Check NEAR treasury key and RPC configuration.',
      ))
    }
    providerPayload.nativePayoutTxHash = getNearTransactionHash(transferResult)
    providerPayload.nativePayoutAmountYocto = amountYocto
    logNear('payout.transfer', {
      orderId: order.id,
      accountId: account.accountId,
      receiverId: finalRecipient,
      nativePayoutTxHash: providerPayload.nativePayoutTxHash,
      amountYocto,
    })
  }

  return providerPayload
}

export async function getNearIntentsSwapStatus(input: {
  depositAddress: string
  depositMemo?: string
}) {
  const params = new URLSearchParams({ depositAddress: input.depositAddress })
  if (input.depositMemo) params.set('depositMemo', input.depositMemo)

  const requestUrl = `${getNearIntentsBaseUrl()}/status?${params.toString()}`
  try {
    return await fetchJsonOverHttps<NearIntentsStatusResponse>({
      url: requestUrl,
      headers: {
        accept: 'application/json',
        ...(process.env.MAFITAPAY_NEAR_INTENTS_JWT?.trim()
          ? { authorization: `Bearer ${process.env.MAFITAPAY_NEAR_INTENTS_JWT.trim()}` }
          : {}),
      },
    })
  } catch (error) {
    if (error instanceof Error && /(EAI_AGAIN|ETIMEDOUT|ENOTFOUND|ECONNRESET)/.test(error.message || '')) {
      return await fetchJsonViaCurl<NearIntentsStatusResponse>({
        url: requestUrl,
        headers: {
          accept: 'application/json',
          ...(process.env.MAFITAPAY_NEAR_INTENTS_JWT?.trim()
            ? { authorization: `Bearer ${process.env.MAFITAPAY_NEAR_INTENTS_JWT.trim()}` }
            : {}),
        },
      })
    }
    throw new Error(getNearFriendlyErrorMessage(error, 'Unable to read NEAR swap status.'))
  }
}
