import { execFile } from 'node:child_process'
import * as https from 'node:https'
import { promisify } from 'node:util'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { broadcastBaseTransaction, getBaseExecutorConfig } from '@/lib/server/base-executor'
import { getCryptoAssetById } from '@/lib/server/data'
import { assertLifiTreasuryCanExecuteBuy, getLifiConfig, prepareLifiBaseApproval } from '@/lib/server/lifi'
import type { CryptoOrder } from '@/types'

const SUI_CHAIN_ID = '9270000000000000'
const SUI_COIN_DECIMALS = 9
const USDC_DECIMALS = 6
const DEFAULT_SUI_RPC_URL = 'https://fullnode.mainnet.sui.io:443'
const DEFAULT_SUI_ROUTER_BASE_URL = 'https://aftermath.finance/api/router'
const DEFAULT_SUI_USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const DEFAULT_SUI_NATIVE_COIN_TYPE = '0x2::sui::SUI'
const DEFAULT_SUI_SWAP_SLIPPAGE_BPS = 100
const MIN_SUI_PAYOUT_GAS_RESERVE = BigInt(50_000_000)
const MIN_SUI_PAYOUT_TX_BUFFER = BigInt(50_000_000)
const UPSTREAM_FETCH_TIMEOUT_MS = 12_000
const execFileAsync = promisify(execFile)

type LifiBridgeQuoteResponse = {
  transactionId?: string
  tool?: string
  message?: string
  estimate?: {
    approvalAddress?: string
    toAmount?: string
    toAmountMin?: string
  }
  transactionRequest?: {
    to?: string
    data?: string
    value?: string
  }
  includedSteps?: Array<{
    id?: string
    type?: string
    tool?: string
  }>
}

type AftermathTradeRoute = {
  coinOut?: {
    amount?: string
    type?: string
  }
} & Record<string, unknown>

type AftermathAddTradeResponse = {
  tx?: Parameters<typeof Transaction.from>[0]
  coinOutId?: TransactionObjectArgument
  message?: string
  error?: string
}

function logSui(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[sui] ${event}${payload}`)
}

function formatUnknownError(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return 'Unknown error.'
}

function normalizeBigIntLikeString(value: string) {
  const trimmed = value.trim()
  if (trimmed.endsWith('n')) return trimmed.slice(0, -1)
  return trimmed
}

function parseBigIntLikeValue(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = normalizeBigIntLikeString(value)
  if (!/^\d+$/.test(normalized)) return null
  return BigInt(normalized)
}

function toAftermathBigIntString(value: string | bigint) {
  const normalized = typeof value === 'bigint' ? value.toString() : normalizeBigIntLikeString(value)
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Invalid Aftermath amount.')
  }
  return `${normalized}n`
}

function toSmallestUnit(amount: number, decimals: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero.')
  }
  return BigInt(Math.round(amount * 10 ** decimals))
}

function fromSmallestUnit(amount: bigint, decimals: number) {
  const normalized = amount.toString().padStart(decimals + 1, '0')
  const integer = normalized.slice(0, -decimals) || '0'
  const fraction = normalized.slice(-decimals).replace(/0+$/, '')
  return Number(fraction ? `${integer}.${fraction}` : integer)
}

function applyBpsFloor(value: bigint, bps: number) {
  if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) {
    throw new Error('Invalid basis points value.')
  }
  return (value * BigInt(bps)) / BigInt(10_000)
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

function buildJsonHeaders(extra?: Record<string, string>) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...extra,
  }
}

function getSuiTreasuryConfig() {
  const configuredRpcUrls = (process.env.MAFITAPAY_SUI_RPC_URLS?.trim() || process.env.MAFITAPAY_SUI_RPC_URL?.trim() || DEFAULT_SUI_RPC_URL)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  return {
    rpcUrls: configuredRpcUrls.length > 0 ? configuredRpcUrls : [DEFAULT_SUI_RPC_URL],
    privateKey: process.env.MAFITAPAY_SUI_TREASURY_PRIVATE_KEY?.trim() || '',
    configuredAddress: process.env.MAFITAPAY_SUI_TREASURY_ADDRESS?.trim() || '',
    routerBaseUrl: (process.env.MAFITAPAY_SUI_ROUTER_BASE_URL?.trim() || DEFAULT_SUI_ROUTER_BASE_URL).replace(/\/+$/, ''),
    usdcCoinType: process.env.MAFITAPAY_SUI_USDC_COIN_TYPE?.trim() || DEFAULT_SUI_USDC_COIN_TYPE,
    nativeCoinType: process.env.MAFITAPAY_SUI_NATIVE_COIN_TYPE?.trim() || DEFAULT_SUI_NATIVE_COIN_TYPE,
    swapSlippageBps: Number(process.env.MAFITAPAY_SUI_SWAP_SLIPPAGE_BPS || DEFAULT_SUI_SWAP_SLIPPAGE_BPS),
  }
}

function getSuiTreasuryContext() {
  const config = getSuiTreasuryConfig()
  return {
    address: config.configuredAddress || null,
    rpcUrls: config.rpcUrls,
    rpcUrlCount: config.rpcUrls.length,
    privateKeyConfigured: Boolean(config.privateKey),
  }
}

function getSuiTreasuryAccount() {
  const config = getSuiTreasuryConfig()
  if (!config.privateKey) {
    throw new Error('MAFITAPAY_SUI_TREASURY_PRIVATE_KEY is not configured.')
  }

  const keypair = Ed25519Keypair.fromSecretKey(config.privateKey)
  const derivedAddress = keypair.getPublicKey().toSuiAddress()
  if (config.configuredAddress && config.configuredAddress.toLowerCase() !== derivedAddress.toLowerCase()) {
    throw new Error('Configured Sui treasury address does not match the loaded private key.')
  }

  return {
    address: config.configuredAddress || derivedAddress,
    keypair,
    config,
  }
}

function createSuiClient(url: string) {
  return new SuiJsonRpcClient({
    network: 'mainnet',
    url,
  })
}

async function withSuiReadFailover<T>(action: (client: SuiJsonRpcClient, rpcUrl: string) => Promise<T>) {
  const config = getSuiTreasuryConfig()
  let lastError: unknown = null

  for (const rpcUrl of config.rpcUrls) {
    try {
      return await action(createSuiClient(rpcUrl), rpcUrl)
    } catch (error) {
      lastError = error
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`Exceeded ${config.rpcUrls.length} Sui RPC providers to execute request`)
}

function getSuiWriteClient() {
  const config = getSuiTreasuryConfig()
  return {
    client: createSuiClient(config.rpcUrls[0]),
    rpcUrl: config.rpcUrls[0],
  }
}

function normalizeSuiRpcError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return new Error(fallback)
  const message = error.message || fallback

  if (/fetch failed|Request timed out|ECONNRESET|EAI_AGAIN|socket hang up/i.test(message)) {
    return new Error('Sui RPC is unavailable right now. Update MAFITAPAY_SUI_RPC_URL or MAFITAPAY_SUI_RPC_URLS and try again.')
  }
  if (/private key/i.test(message) || /does not match the loaded private key/i.test(message)) {
    return error
  }
  return new Error(message || fallback)
}

async function getTreasuryUsdcAmount(amountNgn: number) {
  const usdcPair = await getCryptoAssetById('USDC_BASE')
  if (!usdcPair || !Number.isFinite(usdcPair.buyRate) || usdcPair.buyRate <= 0) {
    throw new Error('USDC_BASE pricing is unavailable for SUI treasury conversion.')
  }

  const treasuryUsdcAmount = amountNgn / usdcPair.buyRate
  if (!Number.isFinite(treasuryUsdcAmount) || treasuryUsdcAmount <= 0) {
    throw new Error('Unable to convert order value into USDC treasury amount.')
  }

  return treasuryUsdcAmount
}

async function getSuiTreasuryNativeBalance() {
  const account = getSuiTreasuryAccount()
  try {
    const balance = await withSuiReadFailover((client) => client.getBalance({ owner: account.address }))
    return {
      address: account.address,
      totalBalance: BigInt(balance.totalBalance),
    }
  } catch (error) {
    logSui('treasury.balances-error', {
      ...getSuiTreasuryContext(),
      message: formatUnknownError(error),
    })
    throw normalizeSuiRpcError(error, 'Unable to verify SUI treasury balance. Check SUI treasury key and RPC configuration.')
  }
}

function buildLifiHeaders() {
  const config = getLifiConfig()
  return {
    accept: 'application/json',
    ...(config.apiKeyConfigured ? { 'x-lifi-api-key': config.apiKey } : {}),
  }
}

async function fetchSuiBridgeQuote(input: {
  amountNgn: number
  treasuryAddress: string
}) {
  const config = getSuiTreasuryConfig()
  const baseConfig = getBaseExecutorConfig()
  const treasuryUsdcAmount = await getTreasuryUsdcAmount(input.amountNgn)
  const treasuryUsdcUnits = toSmallestUnit(treasuryUsdcAmount, USDC_DECIMALS).toString()

  const params = new URLSearchParams({
    fromChain: '8453',
    toChain: SUI_CHAIN_ID,
    fromToken: baseConfig.usdcAddress,
    toToken: config.usdcCoinType,
    fromAmount: treasuryUsdcUnits,
    fromAddress: baseConfig.configuredAddress,
    toAddress: input.treasuryAddress,
    slippage: '0.005',
    order: 'FASTEST',
  })

  const requestUrl = `${getLifiConfig().baseUrl}/quote?${params.toString()}`
  logSui('quote.request', {
    pairId: 'SUI_SUI',
    amountNgn: input.amountNgn,
    toChain: SUI_CHAIN_ID,
    bridgeCoinType: config.usdcCoinType,
    recipient: input.treasuryAddress,
  })

  const headers = buildLifiHeaders()
  let payload: LifiBridgeQuoteResponse | null = null
  try {
    payload = await fetchJsonOverHttps<LifiBridgeQuoteResponse>({ url: requestUrl, headers })
  } catch (error) {
    logSui('quote.bridge-fetch-error', {
      amountNgn: input.amountNgn,
      message: formatUnknownError(error),
    })
    try {
      payload = await fetchJsonViaCurl<LifiBridgeQuoteResponse>({ url: requestUrl, headers })
      logSui('quote.bridge-success', {
        amountNgn: input.amountNgn,
        transport: 'curl',
        bridge: payload.tool,
        transactionId: payload.transactionId,
        bridgedUsdcUnits: payload.estimate?.toAmount,
        bridgedUsdcUnitsMin: payload.estimate?.toAmountMin,
      })
    } catch (curlError) {
      logSui('quote.bridge-curl-error', {
        amountNgn: input.amountNgn,
        message: formatUnknownError(curlError),
      })
      throw new Error('SUI bridge quote provider is temporarily unavailable. Please try again.')
    }
  }

  if (!payload?.transactionRequest?.to || !payload.transactionRequest.data || !payload.transactionId || !payload.estimate?.toAmountMin) {
    logSui('quote.bridge-invalid', {
      amountNgn: input.amountNgn,
      payload,
    })
    throw new Error(payload?.message || 'No SUI treasury bridge quote is available right now.')
  }

  logSui('quote.bridge-success', {
    amountNgn: input.amountNgn,
    bridge: payload.tool,
    transactionId: payload.transactionId,
    bridgedUsdcUnits: payload.estimate?.toAmount,
    bridgedUsdcUnitsMin: payload.estimate?.toAmountMin,
  })

  return {
    quote: payload,
    treasuryUsdcAmount,
    treasuryUsdcUnits,
    bridgedUsdcUnitsMin: payload.estimate.toAmountMin,
  }
}

async function fetchAftermathTradeRoute(input: {
  coinInAmount: string
}) {
  const config = getSuiTreasuryConfig()
  const body = JSON.stringify({
    coinInType: config.usdcCoinType,
    coinOutType: config.nativeCoinType,
    coinInAmount: toAftermathBigIntString(input.coinInAmount),
  })

  const request = {
    url: `${config.routerBaseUrl}/trade-route`,
    method: 'POST' as const,
    headers: buildJsonHeaders(),
    body,
  }

  let payload: AftermathTradeRoute | null = null
  try {
    payload = await fetchJsonOverHttps<AftermathTradeRoute>(request)
  } catch (error) {
    logSui('quote.swap-fetch-error', {
      coinInAmount: input.coinInAmount,
      message: formatUnknownError(error),
    })
    try {
      payload = await fetchJsonViaCurl<AftermathTradeRoute>(request)
      logSui('quote.swap-success', {
        coinInAmount: input.coinInAmount,
        transport: 'curl',
        coinOutAmount: payload.coinOut?.amount,
      })
    } catch (curlError) {
      logSui('quote.swap-curl-error', {
        coinInAmount: input.coinInAmount,
        message: formatUnknownError(curlError),
      })
      throw new Error('SUI swap quote provider is temporarily unavailable. Please try again.')
    }
  }

  const coinOutAmount = parseBigIntLikeValue(payload?.coinOut?.amount)
  if (!payload || !coinOutAmount || coinOutAmount <= BigInt(0)) {
    logSui('quote.swap-invalid', {
      coinInAmount: input.coinInAmount,
      payload,
    })
    throw new Error('No SUI treasury quote is available for this amount right now. Try a higher amount.')
  }

  logSui('quote.swap-success', {
    coinInAmount: input.coinInAmount,
    coinOutAmount: coinOutAmount.toString(),
  })

  return {
    route: payload,
    coinOutAmount,
  }
}

async function addAftermathTradeToTransaction(input: {
  tx: Transaction
  completeRoute: AftermathTradeRoute
  walletAddress: string
}) {
  const config = getSuiTreasuryConfig()
  const body = JSON.stringify({
    walletAddress: input.walletAddress,
    completeRoute: input.completeRoute,
    slippage: config.swapSlippageBps / 10_000,
    serializedTx: input.tx.serialize(),
  })

  const request = {
    url: `${config.routerBaseUrl}/transactions/add-trade`,
    method: 'POST' as const,
    headers: buildJsonHeaders(),
    body,
  }

  let payload: AftermathAddTradeResponse | null = null
  try {
    payload = await fetchJsonOverHttps<AftermathAddTradeResponse>(request)
  } catch (error) {
    try {
      payload = await fetchJsonViaCurl<AftermathAddTradeResponse>(request)
    } catch (curlError) {
      throw new Error(`Unable to build SUI payout transaction: ${formatUnknownError(curlError)}`)
    }
    if (!(error instanceof Error)) {
      throw new Error(`Unable to build SUI payout transaction: ${formatUnknownError(error)}`)
    }
  }

  if (!payload?.tx || !payload.coinOutId) {
    throw new Error(payload?.message || payload?.error || 'SUI payout transaction builder did not return a trade output.')
  }

  return {
    tx: Transaction.from(payload.tx),
    coinOutId: payload.coinOutId,
  }
}

function getQuotedSuiPayoutAmountRaw(payload: Record<string, unknown>) {
  if (typeof payload.quotedPayoutAmountRaw === 'string' && /^\d+$/.test(payload.quotedPayoutAmountRaw)) {
    return BigInt(payload.quotedPayoutAmountRaw)
  }
  return null
}

export async function assertSuiTreasuryCanExecuteBuy(input: {
  amountNgn: number
}) {
  await assertLifiTreasuryCanExecuteBuy({ amountNgn: input.amountNgn })

  const requiredUsdcAmount = await getTreasuryUsdcAmount(input.amountNgn)
  const requiredUsdcUnits = toSmallestUnit(requiredUsdcAmount, USDC_DECIMALS)
  const balance = await getSuiTreasuryNativeBalance()
  const requiredNativeReserve = MIN_SUI_PAYOUT_GAS_RESERVE + MIN_SUI_PAYOUT_TX_BUFFER

  logSui('treasury.balances', {
    address: balance.address,
    currentSuiMist: balance.totalBalance.toString(),
    reserveMist: MIN_SUI_PAYOUT_GAS_RESERVE.toString(),
    txBufferMist: MIN_SUI_PAYOUT_TX_BUFFER.toString(),
    requiredNativeReserveMist: requiredNativeReserve.toString(),
    requiredUsdcUnits: requiredUsdcUnits.toString(),
  })

  if (balance.totalBalance < requiredNativeReserve) {
    throw new Error('SUI treasury gas is too low to complete this payout flow right now.')
  }
}

export async function getSuiQuotedReceiveForBuy(input: {
  amountNgn: number
  toAddress: string
}) {
  const treasury = getSuiTreasuryAccount()
  const config = getSuiTreasuryConfig()
  const bridgeQuote = await fetchSuiBridgeQuote({
    amountNgn: input.amountNgn,
    treasuryAddress: treasury.address,
  })
  const tradeRoute = await fetchAftermathTradeRoute({
    coinInAmount: bridgeQuote.bridgedUsdcUnitsMin,
  })

  const quotedPayoutAmountRaw = applyBpsFloor(tradeRoute.coinOutAmount, 10_000 - config.swapSlippageBps)
  if (quotedPayoutAmountRaw <= BigInt(0)) {
    throw new Error('SUI payout quote is invalid.')
  }

  const cryptoAmount = fromSmallestUnit(quotedPayoutAmountRaw, SUI_COIN_DECIMALS)
  if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
    throw new Error('SUI payout quote is invalid.')
  }

  return {
    cryptoAmount,
    unitRate: input.amountNgn / cryptoAmount,
    providerPayload: {
      rail: 'sui_treasury',
      pairId: 'SUI_SUI',
      bridge: bridgeQuote.quote.tool,
      bridgeChainId: SUI_CHAIN_ID,
      bridgeToken: config.usdcCoinType,
      treasuryAddress: treasury.address,
      finalRecipient: input.toAddress,
      treasuryUsdcAmount: bridgeQuote.treasuryUsdcAmount,
      treasuryUsdcUnits: bridgeQuote.treasuryUsdcUnits,
      bridgedUsdcUnits: bridgeQuote.quote.estimate?.toAmount,
      bridgedUsdcUnitsMin: bridgeQuote.bridgedUsdcUnitsMin,
      quotedBridgeTransactionId: bridgeQuote.quote.transactionId,
      quotedBridgeExplorerLink: bridgeQuote.quote.transactionId ? `https://explorer.li.fi/tx/${bridgeQuote.quote.transactionId}` : null,
      quotedNativeSuiAmountRaw: tradeRoute.coinOutAmount.toString(),
      quotedPayoutAmountRaw: quotedPayoutAmountRaw.toString(),
      swapSlippageBps: config.swapSlippageBps,
      transactionRequest: bridgeQuote.quote.transactionRequest,
      approvalAddress: bridgeQuote.quote.estimate?.approvalAddress,
      includedSteps: bridgeQuote.quote.includedSteps,
    },
  }
}

export async function submitSuiTreasuryBridgeForOrder(order: CryptoOrder) {
  if (order.executionRail !== 'sui_treasury' || order.pairId !== 'SUI_SUI') {
    throw new Error('Only SUI treasury orders can be executed through this flow.')
  }

  const providerPayload = { ...(order.providerPayload ?? {}) }
  const transactionRequest =
    providerPayload.transactionRequest && typeof providerPayload.transactionRequest === 'object'
      ? providerPayload.transactionRequest as { to?: string; data?: string; value?: string }
      : null

  if (!transactionRequest?.to || !transactionRequest.data) {
    throw new Error('SUI treasury quote is missing executable LI.FI transaction data.')
  }

  if (typeof providerPayload.approvalAddress === 'string' && providerPayload.approvalAddress) {
    await prepareLifiBaseApproval({
      quote: {
        estimate: {
          approvalAddress: providerPayload.approvalAddress,
        },
      },
      minimumAmount: typeof providerPayload.treasuryUsdcUnits === 'string' ? BigInt(providerPayload.treasuryUsdcUnits) : undefined,
    })
  }

  const execution = await broadcastBaseTransaction({
    to: transactionRequest.to,
    data: transactionRequest.data,
    value: transactionRequest.value,
  })

  providerPayload.sendingTxHash = execution.hash

  logSui('deposit.submit', {
    orderId: order.id,
    sendingTxHash: execution.hash,
    quotedBridgeTransactionId: typeof providerPayload.quotedBridgeTransactionId === 'string' ? providerPayload.quotedBridgeTransactionId : null,
  })

  return {
    hash: execution.hash,
    providerPayload,
  }
}

export async function swapAndPayoutSuiForOrder(input: {
  order: CryptoOrder
  bridgedUsdcUnits: string
  finalRecipient: string
}) {
  const { order, bridgedUsdcUnits, finalRecipient } = input
  if (order.executionRail !== 'sui_treasury' || order.pairId !== 'SUI_SUI') {
    throw new Error('Only SUI treasury orders are eligible for payout.')
  }
  if (!/^\d+$/.test(bridgedUsdcUnits) || BigInt(bridgedUsdcUnits) <= BigInt(0)) {
    throw new Error('Invalid bridged SUI treasury amount.')
  }

  const treasury = getSuiTreasuryAccount()
  const balance = await getSuiTreasuryNativeBalance()
  const requiredNativeReserve = MIN_SUI_PAYOUT_GAS_RESERVE + MIN_SUI_PAYOUT_TX_BUFFER
  logSui('payout.gas-check', {
    orderId: order.id,
    address: treasury.address,
    currentSuiMist: balance.totalBalance.toString(),
    reserveMist: MIN_SUI_PAYOUT_GAS_RESERVE.toString(),
    txBufferMist: MIN_SUI_PAYOUT_TX_BUFFER.toString(),
    requiredNativeReserveMist: requiredNativeReserve.toString(),
  })

  if (balance.totalBalance < requiredNativeReserve) {
    throw new Error('SUI treasury native balance is too low to complete this payout right now.')
  }

  const tradeRoute = await fetchAftermathTradeRoute({
    coinInAmount: bridgedUsdcUnits,
  })
  const quotedMinimum = getQuotedSuiPayoutAmountRaw(order.providerPayload ?? {})
  if (quotedMinimum && tradeRoute.coinOutAmount < quotedMinimum) {
    throw new Error('Current SUI payout route can no longer satisfy the locked order amount.')
  }

  const tx = new Transaction()
  const built = await addAftermathTradeToTransaction({
    tx,
    completeRoute: tradeRoute.route,
    walletAddress: treasury.address,
  })
  built.tx.transferObjects([built.coinOutId], finalRecipient)

  try {
    const { client, rpcUrl } = getSuiWriteClient()
    const executionResult = await client.signAndExecuteTransaction({
      signer: treasury.keypair,
      transaction: built.tx,
    })
    const txHash = typeof executionResult.digest === 'string' ? executionResult.digest : null
    if (!txHash) {
      throw new Error('SUI payout did not return a transaction digest.')
    }

    logSui('payout.transfer', {
      orderId: order.id,
      address: treasury.address,
      receiver: finalRecipient,
      rpcUrl,
      nativePayoutTxHash: txHash,
      payoutAmountMist: tradeRoute.coinOutAmount.toString(),
    })

    return {
      ...(order.providerPayload ?? {}),
      nativePayoutTxHash: txHash,
      nativePayoutAmountRaw: tradeRoute.coinOutAmount.toString(),
      bridgedUsdcUnitsSettled: bridgedUsdcUnits,
      finalRecipient,
    }
  } catch (error) {
    logSui('payout.transfer-error', {
      orderId: order.id,
      ...getSuiTreasuryContext(),
      receiver: finalRecipient,
      message: formatUnknownError(error),
    })
    throw normalizeSuiRpcError(error, 'Unable to send native SUI payout. Check SUI treasury key and RPC configuration.')
  }
}
