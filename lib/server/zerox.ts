import { getBaseExecutorConfig } from '@/lib/server/base-executor'
import { getCryptoAssetById } from '@/lib/server/data'
import type { CryptoOrder } from '@/types'

const ZEROX_BASE_URL = 'https://api.0x.org'
const ZEROX_VERSION = 'v2'
const BASE_CHAIN_ID = '8453'
const NATIVE_TOKEN_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

type ZeroExQuoteResponse = {
  allowanceTarget?: string
  buyAmount?: string
  minBuyAmount?: string
  buyToken?: string
  sellAmount?: string
  sellToken?: string
  zid?: string
  route?: {
    fills?: Array<{ from: string; to: string; source: string; proportionBps: string }>
    tokens?: Array<{ address: string; symbol?: string }>
  }
  issues?: {
    allowance?: {
      actual?: string
      spender?: string
    } | null
  }
  transaction?: {
    to: string
    data: string
    value?: string
    gas?: string
    gasPrice?: string
  }
}

export function getZeroExConfig() {
  return {
    apiKeyConfigured: Boolean(process.env.MAFITAPAY_ZEROX_API_KEY?.trim()),
    apiKey: process.env.MAFITAPAY_ZEROX_API_KEY?.trim() || '',
    baseUrl: process.env.MAFITAPAY_ZEROX_BASE_URL?.trim() || ZEROX_BASE_URL,
    version: ZEROX_VERSION,
    chainId: BASE_CHAIN_ID,
  }
}

export function getZeroExHealth() {
  const config = getZeroExConfig()
  return {
    ready: config.apiKeyConfigured,
    baseUrl: config.baseUrl,
    chainId: config.chainId,
    criticalChecks: [
      {
        key: 'api_key',
        label: '0x API Key',
        ready: config.apiKeyConfigured,
        detail: config.apiKeyConfigured ? 'Configured.' : 'Missing MAFITAPAY_ZEROX_API_KEY.',
      },
    ],
    warnings: config.apiKeyConfigured ? [] : ['0x swap execution is disabled until MAFITAPAY_ZEROX_API_KEY is configured.'],
  }
}

function ensureZeroExReady() {
  const config = getZeroExConfig()
  if (!config.apiKeyConfigured) {
    throw new Error('0x Swap API is not configured.')
  }
  return config
}

function buildZeroExHeaders(apiKey: string) {
  return {
    '0x-api-key': apiKey,
    '0x-version': ZEROX_VERSION,
  }
}

export async function getZeroExBaseQuoteForOrder(order: CryptoOrder) {
  const config = ensureZeroExReady()
  const baseConfig = getBaseExecutorConfig()

  if (order.executionRail !== 'base_legacy' && order.executionRail !== 'base_treasury') {
    throw new Error('Only Base treasury orders can be quoted through 0x.')
  }
  if (order.side !== 'buy') {
    throw new Error('0x execution is only enabled for buy orders in this phase.')
  }
  if (order.pairId !== 'ETH_BASE') {
    throw new Error('0x execution is currently enabled only for ETH_BASE.')
  }
  const usdcPair = await getCryptoAssetById('USDC_BASE')
  if (!usdcPair || !Number.isFinite(usdcPair.buyRate) || usdcPair.buyRate <= 0) {
    throw new Error('USDC_BASE pricing is unavailable for treasury conversion.')
  }
  const treasuryUsdcAmount = order.amountNgn / usdcPair.buyRate
  if (!Number.isFinite(treasuryUsdcAmount) || treasuryUsdcAmount <= 0) {
    throw new Error('Unable to convert order value into USDC treasury amount.')
  }

  const params = new URLSearchParams({
    chainId: config.chainId,
    sellToken: baseConfig.usdcAddress,
    buyToken: NATIVE_TOKEN_SENTINEL,
    sellAmount: Math.floor(treasuryUsdcAmount * 1_000_000).toString(),
    taker: baseConfig.configuredAddress,
  })

  const response = await fetch(`${config.baseUrl}/swap/allowance-holder/quote?${params.toString()}`, {
    headers: buildZeroExHeaders(config.apiKey),
  })
  const payload = await response.json().catch(() => null) as ZeroExQuoteResponse | { reason?: string; validationErrors?: Array<{ reason?: string }> } | null

  if (!response.ok) {
    const reason = payload && 'reason' in payload && typeof payload.reason === 'string'
      ? payload.reason
      : payload && 'validationErrors' in payload && Array.isArray(payload.validationErrors) && payload.validationErrors[0]?.reason
        ? payload.validationErrors[0]?.reason
        : '0x quote request failed.'
    throw new Error(reason)
  }

  const quote = payload as ZeroExQuoteResponse
  if (!quote.transaction?.to || !quote.transaction.data || !quote.zid) {
    throw new Error('0x quote is missing executable transaction data.')
  }

  return quote
}
