import { execFile } from 'node:child_process'
import https from 'node:https'
import { promisify } from 'node:util'
import { StonApiClient } from '@ston-fi/api'
import { dexFactory } from '@ston-fi/sdk'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { Address, internal, toNano } from '@ton/ton'
import { mnemonicToPrivateKey } from '@ton/crypto'
import { TonClient, WalletContractV4 } from '@ton/ton'
import { getCryptoAssetById } from '@/lib/server/data'
import type { CryptoOrder } from '@/types'

const DEFAULT_TON_RPC_URL = 'https://toncenter.com/api/v2/jsonRPC'
const DEFAULT_TON_USDT_MASTER_ADDRESS = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const TON_MAINNET_WORKCHAIN = 0
const TON_QUOTE_SLIPPAGE_TOLERANCE = '0.01'
const MIN_TON_PREFLIGHT_GAS_BUFFER = toNano('0.2')
const MIN_TON_POST_SUBMIT_RESERVE = toNano('0.02')
const TON_RPC_TIMEOUT_MS = 12_000
const execFileAsync = promisify(execFile)

type TonQuotePayload = {
  rail: 'ton_treasury'
  router: {
    address: string
    majorVersion: number
    minorVersion: number
    ptonMasterAddress: string
    ptonVersion: string
    routerType: string
    poolCreationEnabled: boolean
  }
  routerAddress: string
  offerAddress: string
  askAddress: string
  offerUnits: string
  askUnits: string
  minAskUnits: string
  slippageTolerance: string
  treasuryStableAmount: number
  treasuryStableUnits: string
  receiverAddress: string
}

type TonSwapExecution = {
  providerPayload: Record<string, unknown>
  queryId: string
  routerAddress: string
}

let tonNativeAssetAddressPromise: Promise<string> | null = null

function logTon(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[ton] ${event}${payload}`)
}

function describeTonUpstreamError(error: unknown) {
  if (error instanceof Error) {
    const enriched = error as Error & {
      response?: {
        status?: number
        statusText?: string
        data?: unknown
      }
      request?: unknown
      code?: string
      config?: {
        url?: string
        baseURL?: string
        method?: string
      }
    }

    return {
      message: error.message,
      code: enriched.code,
      status: enriched.response?.status,
      statusText: enriched.response?.statusText,
      data: enriched.response?.data,
      url: enriched.config?.url,
      baseURL: enriched.config?.baseURL,
      method: enriched.config?.method,
      transport: typeof enriched.request === 'object' && enriched.request && 'transport' in enriched.request
        ? String((enriched.request as { transport?: unknown }).transport ?? '')
        : undefined,
      hasRequest: Boolean(enriched.request),
    }
  }

  return {
    message: String(error),
  }
}

function createTonUpstreamFailureMessage(
  operation: 'treasury_balances' | 'quote' | 'swap_status',
  details: ReturnType<typeof describeTonUpstreamError>,
) {
  if (details.status === 401) {
    return 'TON RPC authentication failed. Check MAFITAPAY_TON_API_KEY or MAFITAPAY_TON_RPC_URL.'
  }

  if (operation === 'treasury_balances') {
    return 'TON treasury balance check failed. Please verify the TON RPC configuration.'
  }

  if (operation === 'quote') {
    return 'TON quote provider is temporarily unavailable. Please try again.'
  }

  return 'TON swap status provider is temporarily unavailable. Please try again.'
}

function amountToUnits(amount: number, decimals: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero.')
  }

  return BigInt(Math.round(amount * 10 ** decimals))
}

function shouldRetryTonRpcViaCurl(error: unknown) {
  if (!(error instanceof Error)) return false
  const enriched = error as Error & { code?: string }
  return enriched.code === 'EAI_AGAIN'
    || enriched.code === 'ETIMEDOUT'
    || enriched.code === 'ECONNRESET'
    || enriched.code === 'ENOTFOUND'
}

async function postJsonOverHttps<T>(input: string, body: string, headers?: Record<string, string>) {
  const url = new URL(input)

  return await new Promise<{ status: number; statusText: string; data: T; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'user-agent': 'mafitapay/0.1.0',
        ...headers,
      },
    }, response => {
      const status = response.statusCode ?? 0
      const statusText = response.statusMessage ?? ''
      let raw = ''

      response.setEncoding('utf8')
      response.on('data', chunk => {
        raw += chunk
      })
      response.on('end', () => {
        try {
          const parsed = raw ? JSON.parse(raw) as T : null
          resolve({
            status,
            statusText,
            data: parsed as T,
            headers: response.headers,
          })
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Invalid JSON response.'))
        }
      })
    })

    request.setTimeout(TON_RPC_TIMEOUT_MS, () => {
      request.destroy(Object.assign(new Error('Request timed out.'), { code: 'ETIMEDOUT' }))
    })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

async function postJsonViaCurl<T>(input: string, body: string, headers?: Record<string, string>) {
  const args = [
    '-sS',
    '--max-time',
    String(Math.ceil(TON_RPC_TIMEOUT_MS / 1000)),
    '-X',
    'POST',
    input,
    '--data-binary',
    body,
    '-w',
    '\n%{http_code}',
  ]

  for (const [key, value] of Object.entries({
    'user-agent': 'mafitapay/0.1.0',
    ...headers,
  })) {
    args.push('-H', `${key}: ${value}`)
  }

  const { stdout } = await execFileAsync('curl', args)
  const markerIndex = stdout.lastIndexOf('\n')
  if (markerIndex < 0) {
    throw new Error('Missing HTTP status from curl response.')
  }
  const raw = stdout.slice(0, markerIndex)
  const status = Number(stdout.slice(markerIndex + 1).trim())
  return {
    status,
    statusText: '',
    data: raw ? JSON.parse(raw) as T : null as T,
    headers: {},
  }
}

function createTonHttpAdapter(): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const headers = Object.fromEntries(
      Object.entries(config.headers?.toJSON ? config.headers.toJSON() as Record<string, unknown> : (config.headers as Record<string, unknown> | undefined) ?? {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    )
    const body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data ?? {})

    try {
      const response = await postJsonOverHttps<unknown>(config.url ?? '', body, headers)
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        config,
        request: { transport: 'https' },
      }
    } catch (error) {
      if (!shouldRetryTonRpcViaCurl(error)) {
        throw error
      }

      const response = await postJsonViaCurl<unknown>(config.url ?? '', body, headers)
      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        config,
        request: { transport: 'curl' },
      }
    }
  }
}

function unitsToAmount(units: string | bigint, decimals: number) {
  const raw = typeof units === 'bigint' ? units : BigInt(units)
  const denominator = 10 ** decimals
  return Number(raw) / denominator
}

async function getStableTreasuryAmount(amountNgn: number) {
  const stablePair = await getCryptoAssetById('USDC_BASE') ?? await getCryptoAssetById('USDT_BSC')
  if (!stablePair || !Number.isFinite(stablePair.buyRate) || stablePair.buyRate <= 0) {
    throw new Error('Stablecoin pricing is unavailable for TON treasury conversion.')
  }

  const stableAmount = amountNgn / stablePair.buyRate
  if (!Number.isFinite(stableAmount) || stableAmount <= 0) {
    throw new Error('Unable to convert order value into TON treasury USDT amount.')
  }

  return stableAmount
}

function parseMnemonicWords() {
  const value = process.env.MAFITAPAY_TON_EXECUTOR_MNEMONIC?.trim() || ''
  return value.split(/\s+/).filter(Boolean)
}

export function getTonExecutorConfig() {
  return {
    rpcUrl: process.env.MAFITAPAY_TON_RPC_URL?.trim() || DEFAULT_TON_RPC_URL,
    apiKey: process.env.MAFITAPAY_TON_API_KEY?.trim() || '',
    apiKeyConfigured: Boolean(process.env.MAFITAPAY_TON_API_KEY?.trim()),
    mnemonicWords: parseMnemonicWords(),
    configuredAddress: process.env.MAFITAPAY_TON_EXECUTOR_ADDRESS?.trim() || '',
    usdtMasterAddress: process.env.MAFITAPAY_TON_USDT_MASTER_ADDRESS?.trim() || DEFAULT_TON_USDT_MASTER_ADDRESS,
    workchain: TON_MAINNET_WORKCHAIN,
  }
}

export async function getTonExecutorHealth() {
  const config = getTonExecutorConfig()
  const warnings: string[] = []
  let derivedAddress: string | null = null
  let walletMatchesConfiguredAddress = false

  if (config.mnemonicWords.length === 24) {
    try {
      const keyPair = await mnemonicToPrivateKey(config.mnemonicWords)
      const wallet = WalletContractV4.create({
        workchain: config.workchain,
        publicKey: keyPair.publicKey,
      })
      derivedAddress = wallet.address.toString()
      walletMatchesConfiguredAddress = config.configuredAddress
        ? derivedAddress === Address.parse(config.configuredAddress).toString()
        : true
      if (config.configuredAddress && !walletMatchesConfiguredAddress) {
        warnings.push('Configured TON executor address does not match the loaded mnemonic.')
      }
    } catch {
      warnings.push('TON executor mnemonic is present but invalid.')
    }
  } else {
    warnings.push('TON executor mnemonic is missing or incomplete.')
  }

  return {
    ready: config.mnemonicWords.length === 24 && walletMatchesConfiguredAddress,
    rpcUrl: config.rpcUrl,
    apiKeyConfigured: config.apiKeyConfigured,
    configuredAddress: config.configuredAddress || null,
    derivedAddress,
    walletMatchesConfiguredAddress,
    usdtMasterAddress: config.usdtMasterAddress,
    warnings,
  }
}

async function getTonClients() {
  const config = getTonExecutorConfig()
  if (config.mnemonicWords.length !== 24) {
    throw new Error('MAFITAPAY_TON_EXECUTOR_MNEMONIC is not configured.')
  }

  const keyPair = await mnemonicToPrivateKey(config.mnemonicWords)
  const wallet = WalletContractV4.create({
    workchain: config.workchain,
    publicKey: keyPair.publicKey,
  })
  const derivedAddress = wallet.address.toString()
  if (config.configuredAddress) {
    const configuredAddress = Address.parse(config.configuredAddress).toString()
    if (configuredAddress !== derivedAddress) {
      throw new Error('Configured TON executor address does not match the loaded mnemonic.')
    }
  }

  const httpAdapter = createTonHttpAdapter() as ConstructorParameters<typeof TonClient>[0]['httpAdapter']

  const tonClient = new TonClient({
    endpoint: config.rpcUrl,
    apiKey: config.apiKeyConfigured ? config.apiKey : undefined,
    timeout: 12_000,
    httpAdapter,
  })
  const stonApiClient = new StonApiClient()
  const contract = tonClient.open(wallet)

  return {
    config,
    keyPair,
    wallet,
    tonClient,
    stonApiClient,
    contract,
  }
}

async function getTonNativeAssetAddress(stonApiClient: StonApiClient) {
  if (!tonNativeAssetAddressPromise) {
    tonNativeAssetAddressPromise = stonApiClient.getAssets().then(assets => {
      const tonAsset = assets.find(asset => asset.kind === 'Ton' && asset.symbol === 'TON')
      if (!tonAsset?.contractAddress) {
        throw new Error('STON.fi TON asset metadata is unavailable.')
      }
      return tonAsset.contractAddress
    })
  }
  return tonNativeAssetAddressPromise
}

export async function getTonTreasuryBalances() {
  try {
    const { tonClient, wallet, stonApiClient, config } = await getTonClients()
    const [tonBalance, usdtAsset, usdtWalletAddress] = await Promise.all([
      tonClient.getBalance(wallet.address),
      stonApiClient.getWalletAsset({
        walletAddress: wallet.address.toString(),
        assetAddress: config.usdtMasterAddress,
      }),
      stonApiClient.getJettonWalletAddress({
        jettonAddress: config.usdtMasterAddress,
        ownerAddress: wallet.address.toString(),
      }),
    ])

    const result = {
      walletAddress: wallet.address.toString(),
      tonNano: tonBalance.toString(),
      usdtUnits: usdtAsset.balance ?? '0',
      usdtWalletAddress,
    }
    logTon('treasury.balances', {
      walletAddress: result.walletAddress,
      tonNano: result.tonNano,
      usdtUnits: result.usdtUnits,
    })
    return result
  } catch (error) {
    const details = describeTonUpstreamError(error)
    const config = getTonExecutorConfig()
    const health = await getTonExecutorHealth().catch(() => null)
    logTon('treasury.balances-error', {
      rpcUrl: config.rpcUrl,
      apiKeyConfigured: config.apiKeyConfigured,
      configuredAddress: config.configuredAddress || null,
      derivedAddress: health?.derivedAddress ?? null,
      usdtMasterAddress: config.usdtMasterAddress,
      ...details,
    })
    throw new Error(createTonUpstreamFailureMessage('treasury_balances', details))
  }
}

export async function assertTonTreasuryCanExecuteBuy(input: {
  amountNgn: number
}) {
  const health = await getTonExecutorHealth()
  if (!health.ready) {
    throw new Error(health.warnings[0] || 'TON executor is not ready.')
  }

  const balances = await getTonTreasuryBalances()
  const tonNano = BigInt(balances.tonNano)
  const usdtUnits = BigInt(balances.usdtUnits)
  const stableAmount = await getStableTreasuryAmount(input.amountNgn)
  const requiredUsdtUnits = amountToUnits(stableAmount, 6)
  logTon('treasury.check', {
    amountNgn: input.amountNgn,
    availableTonNano: tonNano.toString(),
    availableUsdtUnits: usdtUnits.toString(),
    requiredUsdtUnits: requiredUsdtUnits.toString(),
  })

  if (tonNano < MIN_TON_PREFLIGHT_GAS_BUFFER) {
    throw new Error('TON treasury gas is too low to fulfill this order right now.')
  }
  if (usdtUnits < requiredUsdtUnits) {
    throw new Error('TON treasury USDT is too low to fulfill this order right now.')
  }
}

export async function getTonQuotedReceiveForBuy(input: {
  amountNgn: number
  toAddress: string
}) {
  try {
    const { stonApiClient, config } = await getTonClients()
    const askAddress = await getTonNativeAssetAddress(stonApiClient)
    const treasuryStableAmount = await getStableTreasuryAmount(input.amountNgn)
    const offerUnits = amountToUnits(treasuryStableAmount, 6).toString()

    logTon('quote.request', {
      pairId: 'TON_TON',
      amountNgn: input.amountNgn,
      offerUnits,
    })

    const simulation = await stonApiClient.simulateSwap({
      offerAddress: config.usdtMasterAddress,
      askAddress,
      offerUnits,
      slippageTolerance: TON_QUOTE_SLIPPAGE_TOLERANCE,
      dexV2: true,
    })

    const cryptoAmount = unitsToAmount(simulation.askUnits, 9)
    if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
      throw new Error('TON quoted receive amount is invalid.')
    }

    logTon('quote.success', {
      pairId: 'TON_TON',
      amountNgn: input.amountNgn,
      routerAddress: simulation.routerAddress,
      askUnits: simulation.askUnits,
      minAskUnits: simulation.minAskUnits,
    })

    return {
      cryptoAmount,
      unitRate: input.amountNgn / cryptoAmount,
      providerPayload: {
        rail: 'ton_treasury',
        router: simulation.router,
        routerAddress: simulation.routerAddress,
        offerAddress: simulation.offerAddress,
        askAddress: simulation.askAddress,
        offerUnits: simulation.offerUnits,
        askUnits: simulation.askUnits,
        minAskUnits: simulation.minAskUnits,
        slippageTolerance: simulation.slippageTolerance,
        treasuryStableAmount,
        treasuryStableUnits: offerUnits,
        receiverAddress: Address.parse(input.toAddress).toString(),
      } satisfies TonQuotePayload,
    }
  } catch (error) {
    const details = describeTonUpstreamError(error)
    logTon('quote.error', {
      pairId: 'TON_TON',
      amountNgn: input.amountNgn,
      ...details,
    })
    throw new Error(createTonUpstreamFailureMessage('quote', details))
  }
}

function parseTonQuotePayload(order: CryptoOrder) {
  const payload = order.providerPayload
  if (!payload || payload.rail !== 'ton_treasury') {
    throw new Error('TON quote payload is missing.')
  }
  if (typeof payload.offerAddress !== 'string' || typeof payload.minAskUnits !== 'string' || typeof payload.offerUnits !== 'string') {
    throw new Error('TON quote payload is incomplete.')
  }
  if (!payload.router || typeof payload.router !== 'object') {
    throw new Error('TON router metadata is missing from the quote payload.')
  }
  return payload as unknown as TonQuotePayload
}

function createOrderQueryId(order: CryptoOrder) {
  let seed = 0
  for (const char of order.id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0
  return (seed % 2_000_000_000) + 1
}

export async function buildTonSwapExecutionForOrder(order: CryptoOrder): Promise<TonSwapExecution> {
  if (order.executionRail !== 'ton_treasury' || order.pairId !== 'TON_TON') {
    throw new Error('Only TON_TON treasury orders can be executed through this rail.')
  }
  if (!order.walletAddress) {
    throw new Error('Destination wallet address is required for TON execution.')
  }

  const { contract, keyPair, stonApiClient, wallet, tonClient } = await getTonClients()
  const payload = parseTonQuotePayload(order)
  const routerContracts = dexFactory(payload.router)
  const router = tonClient.open(routerContracts.Router.create(payload.router.address))
  const proxyTon = routerContracts.pTON.create(payload.router.ptonMasterAddress)
  const queryId = createOrderQueryId(order)

  const txParams = await router.getSwapJettonToTonTxParams({
    userWalletAddress: wallet.address,
    receiverAddress: Address.parse(order.walletAddress),
    offerJettonAddress: payload.offerAddress,
    offerAmount: payload.offerUnits,
    minAskAmount: payload.minAskUnits,
    proxyTon,
    refundAddress: wallet.address,
    queryId,
  })

  const currentTonBalance = await tonClient.getBalance(wallet.address)
  const requiredSubmitBalance = BigInt(txParams.value) + MIN_TON_POST_SUBMIT_RESERVE
  if (currentTonBalance < requiredSubmitBalance) {
    logTon('swap.gas-check', {
      pairId: order.pairId,
      orderId: order.id,
      currentTonNano: currentTonBalance.toString(),
      txMessageValueNano: BigInt(txParams.value).toString(),
      requiredSubmitBalanceNano: requiredSubmitBalance.toString(),
      postSubmitReserveNano: MIN_TON_POST_SUBMIT_RESERVE.toString(),
    })
    throw new Error('TON treasury gas is too low to submit this swap right now.')
  }

  const seqno = await contract.getSeqno()
  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [internal({
      to: txParams.to,
      value: txParams.value,
      body: txParams.body ?? undefined,
      bounce: txParams.bounce ?? true,
      init: txParams.init ?? undefined,
    })],
  })

  logTon('swap.submitted', {
    pairId: order.pairId,
    orderId: order.id,
    queryId,
    routerAddress: payload.router.address,
    receiverAddress: order.walletAddress,
    offerUnits: payload.offerUnits,
    minAskUnits: payload.minAskUnits,
    tonGasValue: txParams.value.toString(),
  })

  const queryTx = await stonApiClient.queryTransactions({
    walletAddress: wallet.address.toString(),
    queryId,
    minTxTimestamp: new Date(Date.now() - 10 * 60_000),
  }).catch(() => null)

  return {
    queryId: String(queryId),
    routerAddress: payload.router.address,
    providerPayload: {
      ...payload,
      rail: 'ton_treasury',
      ownerAddress: wallet.address.toString(),
      receiverAddress: Address.parse(order.walletAddress).toString(),
      queryId: String(queryId),
      routerAddress: payload.router.address,
      txMessageTo: txParams.to.toString(),
      txMessageValue: txParams.value.toString(),
      walletSeqno: seqno,
      submittedAt: new Date().toISOString(),
      externalMessageHash: queryTx?.txId?.hash ?? null,
    },
  }
}

export async function getTonSwapStatus(input: {
  ownerAddress: string
  routerAddress: string
  queryId: string
}) {
  try {
    const { stonApiClient } = await getTonClients()
    const status = await stonApiClient.getSwapStatus({
      ownerAddress: input.ownerAddress,
      routerAddress: input.routerAddress,
      queryId: input.queryId,
    })
    logTon('swap.status', {
      ownerAddress: input.ownerAddress,
      routerAddress: input.routerAddress,
      queryId: input.queryId,
      status,
    })
    return status
  } catch (error) {
    const details = describeTonUpstreamError(error)
    logTon('swap.status-error', {
      ownerAddress: input.ownerAddress,
      routerAddress: input.routerAddress,
      queryId: input.queryId,
      ...details,
    })
    throw new Error(createTonUpstreamFailureMessage('swap_status', details))
  }
}

export async function queryTonSubmittedTransaction(input: {
  ownerAddress: string
  queryId: number
}) {
  const { stonApiClient } = await getTonClients()
  return stonApiClient.queryTransactions({
    walletAddress: input.ownerAddress,
    queryId: input.queryId,
    minTxTimestamp: new Date(Date.now() - 24 * 60 * 60_000),
  })
}
