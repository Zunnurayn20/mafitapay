import { execFile } from 'node:child_process'
import https from 'node:https'
import { promisify } from 'node:util'
import { ensureBaseTokenAllowance, getBaseExecutorConfig, getBaseExecutorHealth, getBaseTreasuryBalances } from '@/lib/server/base-executor'
import { getRoutedTreasuryPairConfig, getRoutedTreasuryPairConfigForAsset, type RoutedTreasuryPairConfig, type RoutedTreasuryResolvedConfig } from '@/lib/routed-assets'
import { getCryptoAssetById } from '@/lib/server/data'
import type { CryptoAsset, CryptoOrder, CryptoPairId } from '@/types'

const LIFI_BASE_URL = 'https://li.quest/v1'
const BASE_CHAIN_ID = 8453
const UPSTREAM_FETCH_TIMEOUT_MS = 12_000
const execFileAsync = promisify(execFile)

function logLifi(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[lifi] ${event}${payload}`)
}

async function fetchJsonOverHttps<T>(input: string, headers?: Record<string, string>) {
  const url = new URL(input)

  return await new Promise<T>((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        'user-agent': 'mafitapay/0.1.0',
        ...headers,
      },
    }, response => {
      const statusCode = response.statusCode ?? 0
      let body = ''

      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) as T : null
          if (statusCode < 200 || statusCode >= 300) {
            const error = new Error(`Request failed with status ${statusCode}.`)
            ;(error as Error & { statusCode?: number; responseBody?: string; payload?: unknown }).statusCode = statusCode
            ;(error as Error & { statusCode?: number; responseBody?: string; payload?: unknown }).responseBody = body
            ;(error as Error & { statusCode?: number; responseBody?: string; payload?: unknown }).payload = parsed
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
    request.end()
  })
}

async function fetchJsonViaCurl<T>(input: string, headers?: Record<string, string>) {
  const args = ['-sS', '--max-time', String(Math.ceil(UPSTREAM_FETCH_TIMEOUT_MS / 1000)), input]

  for (const [key, value] of Object.entries({
    'user-agent': 'mafitapay/0.1.0',
    ...headers,
  })) {
    args.push('-H', `${key}: ${value}`)
  }

  const { stdout } = await execFileAsync('curl', args)
  return JSON.parse(stdout) as T
}

type LifiQuoteResponse = {
  transactionId?: string
  tool?: string
  message?: string
  code?: number | string
  estimate?: {
    approvalAddress?: string
    toAmount?: string
    toAmountMin?: string
  }
  action?: {
    toToken?: {
      decimals?: number
      symbol?: string
      address?: string
      chainId?: number
    }
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
  errors?: {
    filteredOut?: Array<{
      overallPath?: string
      reason?: string
    }>
    failed?: Array<{
      overallPath?: string
      subpaths?: Record<string, Array<{
        errorType?: string
        code?: string
        tool?: string
        message?: string
      }>>
    }>
  }
}

type LifiStatusResponse = {
  transactionId?: string
  sending?: {
    txHash?: string
    chainId?: number
    amount?: string
  }
  receiving?: {
    txHash?: string
    chainId?: number
    amount?: string
    token?: {
      address?: string
      symbol?: string
      decimals?: number
      chainId?: number
    }
  }
  lifiExplorerLink?: string
  fromAddress?: string
  toAddress?: string
  tool?: string
  status?: string
  substatus?: string
}

function toSmallestUnit(amount: number, decimals: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero.')
  }

  return BigInt(Math.round(amount * 10 ** decimals))
}

export const getRoutedPairConfig = getRoutedTreasuryPairConfig

export function getLifiConfig() {
  return {
    baseUrl: process.env.MAFITAPAY_LIFI_BASE_URL?.trim() || LIFI_BASE_URL,
    apiKey: process.env.MAFITAPAY_LIFI_API_KEY?.trim() || '',
    apiKeyConfigured: Boolean(process.env.MAFITAPAY_LIFI_API_KEY?.trim()),
  }
}

export function getLifiHealth() {
  const config = getLifiConfig()
  return {
    ready: true,
    baseUrl: config.baseUrl,
    apiKeyConfigured: config.apiKeyConfigured,
    warnings: config.apiKeyConfigured ? [] : ['LI.FI API key is not configured. Public rate limits apply.'],
  }
}

export async function assertLifiTreasuryCanExecuteBuy(input: {
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
    throw new Error('Base executor gas is too low for routed execution. Try again shortly.')
  }
  if (usdcUnits < requiredUsdcUnits) {
    throw new Error('USDC treasury is too low to fulfill this routed order right now.')
  }
}

function buildLifiHeaders() {
  const config = getLifiConfig()
  return {
    accept: 'application/json',
    ...(config.apiKeyConfigured ? { 'x-lifi-api-key': config.apiKey } : {}),
  }
}

async function getTreasuryUsdcAmount(amountNgn: number) {
  const usdcPair = await getCryptoAssetById('USDC_BASE')
  if (!usdcPair || !Number.isFinite(usdcPair.buyRate) || usdcPair.buyRate <= 0) {
    throw new Error('USDC_BASE pricing is unavailable for routed treasury conversion.')
  }

  const treasuryUsdcAmount = amountNgn / usdcPair.buyRate
  if (!Number.isFinite(treasuryUsdcAmount) || treasuryUsdcAmount <= 0) {
    throw new Error('Unable to convert order value into USDC treasury amount.')
  }

  return treasuryUsdcAmount
}

async function fetchLifiQuote(input: {
  pairId: CryptoPairId
  asset?: Pick<CryptoAsset, 'id' | 'symbol' | 'network' | 'executionRail' | 'routedToChain' | 'routedToToken' | 'routedDecimals' | 'routedAddressFamily' | 'minimumBuyNgn' | 'maxQuoteDriftPercent'>
  amountNgn: number
  toAddress: string
}) {
  const pair = input.asset ? getRoutedTreasuryPairConfigForAsset(input.asset) : getRoutedPairConfig(input.pairId)
  const baseConfig = getBaseExecutorConfig()
  const treasuryUsdcAmount = await getTreasuryUsdcAmount(input.amountNgn)
  const fromAmount = toSmallestUnit(treasuryUsdcAmount, 6).toString()

  const params = new URLSearchParams({
    fromChain: BASE_CHAIN_ID.toString(),
    toChain: pair.toChain.toString(),
    fromToken: baseConfig.usdcAddress,
    toToken: pair.toToken,
    fromAmount,
    fromAddress: baseConfig.configuredAddress,
    toAddress: input.toAddress,
    slippage: '0.005',
    order: 'FASTEST',
  })

  const requestUrl = `${getLifiConfig().baseUrl}/quote?${params.toString()}`
  logLifi('quote.request', {
    pairId: input.pairId,
    amountNgn: input.amountNgn,
    toChain: pair.toChain,
    toToken: pair.toToken,
  })

  const headers = buildLifiHeaders()
  let payload: LifiQuoteResponse | { message?: string } | null
  try {
    payload = await fetchJsonOverHttps<LifiQuoteResponse | { message?: string }>(requestUrl, headers)
  } catch (error) {
    logLifi('quote.fetch-error', {
      pairId: input.pairId,
      amountNgn: input.amountNgn,
      message: error instanceof Error ? error.message : 'Unknown LI.FI fetch error.',
    })
    try {
      payload = await fetchJsonViaCurl<LifiQuoteResponse | { message?: string }>(requestUrl, headers)
      logLifi('quote.success', {
        pairId: input.pairId,
        amountNgn: input.amountNgn,
        tool: (payload as LifiQuoteResponse).tool,
        transactionId: (payload as LifiQuoteResponse).transactionId,
        toAmount: (payload as LifiQuoteResponse).estimate?.toAmount,
        toAmountMin: (payload as LifiQuoteResponse).estimate?.toAmountMin,
        transport: 'curl',
      })
    } catch (curlError) {
      logLifi('quote.curl-error', {
        pairId: input.pairId,
        amountNgn: input.amountNgn,
        message: curlError instanceof Error ? curlError.message : 'Unknown LI.FI curl error.',
      })
      throw new Error('Routed quote provider is temporarily unavailable. Please try again.')
    }
  }

  const quote = payload as LifiQuoteResponse
  if (!quote.transactionRequest?.to || !quote.transactionRequest.data || !quote.transactionId) {
    logLifi('quote.invalid', {
      pairId: input.pairId,
      amountNgn: input.amountNgn,
      payload: quote,
    })
    throw new Error(getFriendlyLifiQuoteFailureMessage({
      pairId: input.pairId,
      quote,
    }))
  }

  logLifi('quote.success', {
    pairId: input.pairId,
    amountNgn: input.amountNgn,
    tool: quote.tool,
    transactionId: quote.transactionId,
    toAmount: quote.estimate?.toAmount,
    toAmountMin: quote.estimate?.toAmountMin,
  })

  return {
    pair,
    quote,
    treasuryUsdcAmount,
    treasuryUsdcUnits: fromAmount,
  }
}

function getFriendlyLifiQuoteFailureMessage(input: {
  pairId: CryptoPairId
  quote: LifiQuoteResponse
}) {
  return input.quote.message || 'LI.FI quote is missing executable transaction data.'
}

function assertQuotedReceiveCovered(input: {
  pair: RoutedTreasuryResolvedConfig
  quote: LifiQuoteResponse
  quotedCryptoAmount: number
}) {
  const minimumReceive = input.quote.estimate?.toAmountMin
  if (!minimumReceive) {
    throw new Error('LI.FI quote is missing minimum receive amount.')
  }

  const required = toSmallestUnit(input.quotedCryptoAmount, input.pair.decimals)
  if (BigInt(minimumReceive) < required) {
    throw new Error('Current routed liquidity cannot satisfy the quoted amount. Try again later or update the pair pricing.')
  }
}

export async function assertLifiRouteCanExecuteBuy(input: {
  pairId: CryptoPairId
  asset?: Pick<CryptoAsset, 'id' | 'symbol' | 'network' | 'executionRail' | 'routedToChain' | 'routedToToken' | 'routedDecimals' | 'routedAddressFamily' | 'minimumBuyNgn' | 'maxQuoteDriftPercent'>
  amountNgn: number
  quotedCryptoAmount: number
  toAddress: string
}) {
  const { pair, quote } = await fetchLifiQuote({
    pairId: input.pairId,
    asset: input.asset,
    amountNgn: input.amountNgn,
    toAddress: input.toAddress,
  })
  assertQuotedReceiveCovered({
    pair,
    quote,
    quotedCryptoAmount: input.quotedCryptoAmount,
  })

  return {
    quote,
    pair,
  }
}

export async function getLifiQuotedReceiveForBuy(input: {
  pairId: CryptoPairId
  asset?: Pick<CryptoAsset, 'id' | 'symbol' | 'network' | 'executionRail' | 'routedToChain' | 'routedToToken' | 'routedDecimals' | 'routedAddressFamily' | 'minimumBuyNgn' | 'maxQuoteDriftPercent'>
  amountNgn: number
  toAddress: string
}) {
  const { pair, quote, treasuryUsdcAmount, treasuryUsdcUnits } = await fetchLifiQuote({
    pairId: input.pairId,
    asset: input.asset,
    amountNgn: input.amountNgn,
    toAddress: input.toAddress,
  })

  const minimumReceive = quote.estimate?.toAmountMin
  if (!minimumReceive) {
    throw new Error('LI.FI quote is missing minimum receive amount.')
  }

  const cryptoAmount = Number(minimumReceive) / 10 ** pair.decimals
  if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
    throw new Error('LI.FI quoted receive amount is invalid.')
  }

  return {
    pair,
    quote,
    cryptoAmount,
    unitRate: input.amountNgn / cryptoAmount,
    providerPayload: {
      pairId: input.pairId,
      bridge: quote.tool,
      toChain: pair.toChain,
      toToken: pair.toToken,
      treasuryUsdcAmount,
      treasuryUsdcUnits,
      quotedCryptoAmount: cryptoAmount,
      toAmount: quote.estimate?.toAmount,
      toAmountMin: quote.estimate?.toAmountMin,
      transactionId: quote.transactionId,
      explorerLink: quote.transactionId ? `https://explorer.li.fi/tx/${quote.transactionId}` : null,
      includedSteps: quote.includedSteps,
      transactionRequest: quote.transactionRequest,
      approvalAddress: quote.estimate?.approvalAddress,
      walletAddress: input.toAddress,
    },
  }
}

export async function getLifiQuoteForOrder(order: CryptoOrder) {
  if (order.executionRail !== 'routed_treasury') {
    throw new Error('Only routed treasury orders can be quoted through LI.FI.')
  }
  if (order.side !== 'buy') {
    throw new Error('LI.FI execution is only enabled for buy orders in this phase.')
  }
  if (!order.walletAddress) {
    throw new Error('Destination wallet address is required for routed execution.')
  }

  const asset = await getCryptoAssetById(order.pairId)
  if (!asset) {
    throw new Error('Routed crypto asset config is unavailable.')
  }

  const { pair, quote, treasuryUsdcAmount, treasuryUsdcUnits } = await fetchLifiQuote({
    pairId: order.pairId,
    asset,
    amountNgn: order.amountNgn,
    toAddress: order.walletAddress,
  })

  assertQuotedReceiveCovered({
    pair,
    quote,
    quotedCryptoAmount: order.cryptoAmount,
  })

  return {
    pair,
    quote,
    treasuryUsdcAmount,
    treasuryUsdcUnits,
  }
}

export async function prepareLifiBaseApproval(input: {
  quote: LifiQuoteResponse
  minimumAmount?: bigint
}) {
  const baseConfig = getBaseExecutorConfig()
  const approvalAddress = input.quote.estimate?.approvalAddress

  if (!approvalAddress) {
    return null
  }

  return ensureBaseTokenAllowance({
    token: baseConfig.usdcAddress,
    spender: approvalAddress,
    minimumAmount: input.minimumAmount,
  })
}

export async function getLifiTransferStatus(input: {
  sourceTxHash: string
  toChain?: number | string
  bridge?: string
}) {
  const params = new URLSearchParams({
    txHash: input.sourceTxHash,
    fromChain: BASE_CHAIN_ID.toString(),
  })
  if (input.toChain) params.set('toChain', String(input.toChain))
  if (input.bridge) params.set('bridge', input.bridge)

  const response = await fetch(`${getLifiConfig().baseUrl}/status?${params.toString()}`, {
    headers: buildLifiHeaders(),
  })
  const payload = await response.json().catch(() => null) as LifiStatusResponse | { message?: string } | null

  if (!response.ok) {
    const reason = payload && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'LI.FI status request failed.'
    throw new Error(reason)
  }

  return payload as LifiStatusResponse
}
