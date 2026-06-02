import { BUILDER_CODE } from '@/builderCode'
import type { CryptoOrder } from '@/types'
import { Attribution } from 'ox/erc8021'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  fallback,
  getAddress,
  http,
  isAddress,
  maxUint256,
  parseAbi,
  parseUnits,
  type Hex,
} from 'viem'
import { getCryptoAssetById } from '@/lib/server/data'

const DEFAULT_BASE_EXECUTOR_ADDRESS = '0xA37cd2CACF7ac304b6f966e980952910D7750921'
const DEFAULT_BASE_RPC_URL = 'https://mainnet.base.org'
const DEFAULT_BASE_RESERVE_ADDRESS = '0x46C85152bFe9f96829aA94755D9f915F9B10EF5F'
const DEFAULT_BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const DEFAULT_BASE_WETH_ADDRESS = '0x4200000000000000000000000000000000000006'
const MIN_BASE_GAS_BUFFER_WEI = parseUnits('0.00003', 18)
const WETH_WITHDRAW_ABI = parseAbi([
  'function withdraw(uint256 wad)',
])

const DATA_SUFFIX = Attribution.toDataSuffix({
  codes: [BUILDER_CODE],
}) as Hex

export function getBaseBuilderDataSuffix() {
  return DATA_SUFFIX
}

export function getBaseExecutorConfig() {
  const rpcUrls = (process.env.MAFITAPAY_BASE_RPC_URLS?.trim() || process.env.MAFITAPAY_BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const rpcUrl = rpcUrls[0] || DEFAULT_BASE_RPC_URL
  const privateKey = process.env.MAFITAPAY_BASE_EXECUTOR_PRIVATE_KEY?.trim() as Hex | undefined
  const configuredAddress = getAddress(process.env.MAFITAPAY_BASE_EXECUTOR_ADDRESS?.trim() || DEFAULT_BASE_EXECUTOR_ADDRESS)

  return {
    builderCode: BUILDER_CODE,
    dataSuffix: DATA_SUFFIX,
    rpcUrl,
    rpcUrls,
    privateKeyConfigured: Boolean(privateKey),
    configuredAddress,
    reserveAddress: getAddress(process.env.MAFITAPAY_BASE_RESERVE_ADDRESS?.trim() || DEFAULT_BASE_RESERVE_ADDRESS),
    usdcAddress: getAddress(process.env.MAFITAPAY_BASE_USDC_ADDRESS?.trim() || DEFAULT_BASE_USDC_ADDRESS),
    wethAddress: getAddress(process.env.MAFITAPAY_BASE_WETH_ADDRESS?.trim() || DEFAULT_BASE_WETH_ADDRESS),
    privateKey,
  }
}

export function getBaseExecutorHealth() {
  const config = getBaseExecutorConfig()
  const warnings: string[] = []
  let derivedAddress: string | null = null
  let walletMatchesConfiguredAddress = false

  if (config.privateKey) {
    try {
      derivedAddress = privateKeyToAccount(config.privateKey).address
      walletMatchesConfiguredAddress = derivedAddress.toLowerCase() === config.configuredAddress.toLowerCase()
      if (!walletMatchesConfiguredAddress) {
        warnings.push('Configured Base executor address does not match the loaded private key.')
      }
    } catch {
      warnings.push('Base executor private key is present but invalid.')
    }
  } else {
    warnings.push('Base executor private key is missing.')
  }

  return {
    ready: Boolean(config.privateKey) && walletMatchesConfiguredAddress,
    builderCode: config.builderCode,
    rpcUrl: config.rpcUrl,
    configuredAddress: config.configuredAddress,
    derivedAddress,
    walletMatchesConfiguredAddress,
    contracts: {
      reserve: config.reserveAddress,
      usdc: config.usdcAddress,
      weth: config.wethAddress,
    },
    criticalChecks: [
      {
        key: 'private_key',
        label: 'Executor Private Key',
        ready: Boolean(config.privateKey),
        detail: config.privateKeyConfigured ? 'Configured.' : 'Missing MAFITAPAY_BASE_EXECUTOR_PRIVATE_KEY.',
      },
      {
        key: 'wallet_match',
        label: 'Wallet Match',
        ready: walletMatchesConfiguredAddress,
        detail: walletMatchesConfiguredAddress
          ? 'Configured wallet address matches the loaded signing key.'
          : 'Configured wallet address does not match the signing key.',
      },
      {
        key: 'builder_code',
        label: 'Builder Code',
        ready: Boolean(config.builderCode),
        detail: `ERC-8021 attribution uses ${config.builderCode}.`,
      },
    ],
    warnings,
  }
}

function normalizeBaseRpcError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message || ''
    if (message.includes('HTTP request failed') || message.includes('fetch failed')) {
      return new Error('Base RPC is unavailable right now. Configure a dedicated Base RPC URL in MAFITAPAY_BASE_RPC_URL or MAFITAPAY_BASE_RPC_URLS and try again.')
    }
    return error
  }

  return new Error('Base RPC request failed.')
}

export async function getBaseTreasuryBalances() {
  try {
    const { account, config, publicClient } = getBaseClients()

    const [nativeBalance, usdcBalance, wethBalance] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      }),
      publicClient.readContract({
        address: config.wethAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      }),
    ])

    return {
      walletAddress: account.address,
      ethWei: nativeBalance.toString(),
      usdcUnits: usdcBalance.toString(),
      wethWei: wethBalance.toString(),
    }
  } catch (error) {
    throw normalizeBaseRpcError(error)
  }
}

export async function assertBaseTreasuryCanExecuteBuy(input: {
  pairId: CryptoOrder['pairId']
  amountNgn: number
  cryptoAmount: number
}) {
  const health = getBaseExecutorHealth()
  if (!health.ready) {
    const reason = health.warnings[0] || 'Base executor is not ready.'
    throw new Error(reason)
  }

  const balances = await getBaseTreasuryBalances()
  const ethWei = BigInt(balances.ethWei)
  const usdcUnits = BigInt(balances.usdcUnits)

  if (ethWei < MIN_BASE_GAS_BUFFER_WEI) {
    throw new Error('Base executor gas is too low for this order. Try again shortly.')
  }

  if (input.pairId === 'USDC_BASE') {
    const requiredUsdcUnits = toUnits(input.cryptoAmount, 6)
    if (usdcUnits < requiredUsdcUnits) {
      throw new Error('USDC treasury is too low to fulfill this order right now.')
    }
    return
  }

  if (input.pairId === 'ETH_BASE') {
    if (!process.env.MAFITAPAY_ZEROX_API_KEY?.trim()) {
      throw new Error('ETH buy execution is temporarily unavailable.')
    }

    const usdcPair = await getCryptoAssetById('USDC_BASE')
    if (!usdcPair || !Number.isFinite(usdcPair.buyRate) || usdcPair.buyRate <= 0) {
      throw new Error('Treasury pricing is unavailable for ETH buys right now.')
    }

    const requiredUsdcAmount = input.amountNgn / usdcPair.buyRate
    if (!Number.isFinite(requiredUsdcAmount) || requiredUsdcAmount <= 0) {
      throw new Error('Unable to price treasury conversion for this order.')
    }

    const requiredUsdcUnits = toUnits(requiredUsdcAmount, 6)
    if (usdcUnits < requiredUsdcUnits) {
      throw new Error('USDC treasury is too low to fulfill this ETH order right now.')
    }
    return
  }

  throw new Error(`${input.pairId} is not supported for Base treasury execution.`)
}

function getBaseClients() {
  const config = getBaseExecutorConfig()
  if (!config.privateKey) {
    throw new Error('MAFITAPAY_BASE_EXECUTOR_PRIVATE_KEY is not configured.')
  }

  const account = privateKeyToAccount(config.privateKey)
  if (account.address.toLowerCase() !== config.configuredAddress.toLowerCase()) {
    throw new Error('Configured Base executor address does not match the loaded private key.')
  }

  const transport = config.rpcUrls.length > 1
    ? fallback(config.rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(config.rpcUrl, { retryCount: 1, timeout: 10_000 })
  const publicClient = createPublicClient({
    chain: base,
    transport,
  })
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport,
    dataSuffix: DATA_SUFFIX,
  })

  return {
    account,
    config,
    publicClient,
    walletClient,
  }
}

function toUnits(amount: number, decimals: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero.')
  }

  return parseUnits(amount.toFixed(decimals), decimals)
}

export async function broadcastBaseTransaction(input: {
  to: string
  data?: string
  value?: string | number | bigint
}) {
  try {
    const { account, walletClient } = getBaseClients()
    if (!isAddress(input.to)) {
      throw new Error('Invalid Base transaction target address.')
    }
    if (input.data && !/^0x[0-9a-fA-F]*$/.test(input.data)) {
      throw new Error('Invalid calldata hex.')
    }

    const value = typeof input.value === 'bigint'
      ? input.value
      : typeof input.value === 'number'
        ? BigInt(input.value)
        : typeof input.value === 'string' && input.value.trim()
          ? BigInt(input.value)
          : BigInt(0)

    const hash = await walletClient.sendTransaction({
      account,
      to: getAddress(input.to),
      data: input.data as Hex | undefined,
      value,
      chain: base,
    })

    return {
      hash,
      from: account.address,
      to: getAddress(input.to),
      value: value.toString(),
      data: input.data ?? '0x',
    }
  } catch (error) {
    throw normalizeBaseRpcError(error)
  }
}

export async function getBaseTransactionReceiptState(hash: string) {
  try {
    const { publicClient } = getBaseClients()
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error('Invalid Base transaction hash.')
    }
    const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex })
    return {
      found: true,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      transactionHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed.toString(),
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid Base transaction hash.') throw error
    if (error instanceof Error && (error.message.includes('TransactionReceiptNotFoundError') || error.message.includes('not found'))) {
      return {
        found: false,
        status: 'pending' as const,
        blockNumber: null,
        transactionHash: hash,
        gasUsed: null,
      }
    }

    const normalized = normalizeBaseRpcError(error)
    if (normalized.message !== 'Base RPC is unavailable right now. Configure a dedicated Base RPC URL in MAFITAPAY_BASE_RPC_URL or MAFITAPAY_BASE_RPC_URLS and try again.') {
      return {
        found: false,
        status: 'pending' as const,
        blockNumber: null,
        transactionHash: hash,
        gasUsed: null,
      }
    }

    throw normalized
  }
}

export async function getBaseUsdcDeliveryEvidence(hash: string, expectedRecipient?: string) {
  const { config, publicClient } = getBaseClients()
  const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex })
  const normalizedRecipient = expectedRecipient ? getAddress(expectedRecipient) : null

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.usdcAddress.toLowerCase()) continue

    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics,
      })

      if (decoded.eventName !== 'Transfer') continue
      const to = String(decoded.args.to)
      const value = decoded.args.value
      if (normalizedRecipient && getAddress(to).toLowerCase() !== normalizedRecipient.toLowerCase()) continue

      return {
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        transactionHash: receipt.transactionHash,
        to,
        amountUnits: value.toString(),
      }
    } catch {
      continue
    }
  }

  return {
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    transactionHash: receipt.transactionHash,
    to: normalizedRecipient,
    amountUnits: null,
  }
}

export async function getBaseNativeDeliveryEvidence(hash: string) {
  const { publicClient } = getBaseClients()
  const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex })
  const transaction = await publicClient.getTransaction({ hash: hash as Hex })

  return {
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    transactionHash: receipt.transactionHash,
    to: transaction.to,
    amountWei: transaction.value.toString(),
  }
}

export async function ensureBaseEthLiquidity(amountWei: string | bigint) {
  const { account, config, publicClient, walletClient } = getBaseClients()
  const requiredAmount = typeof amountWei === 'bigint' ? amountWei : BigInt(amountWei)
  if (requiredAmount <= BigInt(0)) {
    throw new Error('ETH delivery amount must be greater than zero.')
  }

  const nativeBalance = await publicClient.getBalance({ address: account.address })
  const requiredTotal = requiredAmount + MIN_BASE_GAS_BUFFER_WEI
  if (nativeBalance >= requiredTotal) {
    return {
      unwrapped: false as const,
      amountWei: '0',
      txHash: null as string | null,
    }
  }

  const deficit = requiredTotal - nativeBalance
  const wethBalance = await publicClient.readContract({
    address: config.wethAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })

  if (wethBalance < deficit) {
    throw new Error('Executor has insufficient ETH/WETH liquidity to deliver purchased ETH.')
  }

  const hash = await walletClient.writeContract({
    account,
    chain: base,
    address: config.wethAddress,
    abi: WETH_WITHDRAW_ABI,
    functionName: 'withdraw',
    args: [deficit],
  })
  await publicClient.waitForTransactionReceipt({ hash })

  return {
    unwrapped: true as const,
    amountWei: deficit.toString(),
    txHash: hash,
  }
}

export async function broadcastBaseEthTransfer(input: {
  to: string
  amountWei: string | bigint
}) {
  if (!isAddress(input.to)) {
    throw new Error('A valid ETH destination address is required.')
  }

  const amountWei = typeof input.amountWei === 'bigint' ? input.amountWei : BigInt(input.amountWei)
  const unwrap = await ensureBaseEthLiquidity(amountWei)
  const tx = await broadcastBaseTransaction({
    to: input.to,
    value: amountWei,
  })

  return {
    ...tx,
    amountWei: amountWei.toString(),
    unwrap,
  }
}

export async function broadcastBaseDeliveryForOrder(order: CryptoOrder) {
  const { account, config, walletClient } = getBaseClients()

  if (order.executionRail !== 'base_legacy' && order.executionRail !== 'base_treasury') {
    throw new Error('Only Base treasury orders can be broadcast through the Base executor.')
  }
  if (!order.walletAddress || !isAddress(order.walletAddress)) {
    throw new Error('A valid destination wallet address is required before Base delivery.')
  }
  if (order.status !== 'pending') {
    throw new Error(`Order is already ${order.status}.`)
  }

  const to = getAddress(order.walletAddress)

  if (order.pairId === 'USDC_BASE') {
    const hash = await walletClient.writeContract({
      account,
      chain: base,
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, toUnits(order.cryptoAmount, 6)],
    })

    return {
      mode: 'delivery' as const,
      asset: 'USDC_BASE' as const,
      hash,
      from: account.address,
      to,
    }
  }

  if (order.pairId === 'ETH_BASE') {
    const delivery = await broadcastBaseEthTransfer({
      to,
      amountWei: toUnits(order.cryptoAmount, 18),
    })

    return {
      mode: 'delivery' as const,
      asset: 'ETH_BASE' as const,
      hash: delivery.hash,
      from: delivery.from,
      to,
      unwrap: delivery.unwrap,
    }
  }

  throw new Error(`Direct Base delivery is only supported for USDC_BASE and ETH_BASE. ${order.pairId} still needs a routed swap call.`)
}

export async function broadcastBaseUsdcTransfer(input: {
  to: string
  amountUnits: string | bigint
}) {
  const { account, config, walletClient } = getBaseClients()
  if (!isAddress(input.to)) {
    throw new Error('A valid USDC destination address is required.')
  }

  const amountUnits = typeof input.amountUnits === 'bigint' ? input.amountUnits : BigInt(input.amountUnits)
  if (amountUnits <= BigInt(0)) {
    throw new Error('USDC transfer amount must be greater than zero.')
  }

  const to = getAddress(input.to)
  const hash = await walletClient.writeContract({
    account,
    chain: base,
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amountUnits],
  })

  return {
    hash,
    from: account.address,
    to,
    amountUnits: amountUnits.toString(),
  }
}

export async function ensureBaseTokenAllowance(input: {
  token: string
  spender: string
  minimumAmount?: bigint
}) {
  const { account, publicClient, walletClient } = getBaseClients()
  if (!isAddress(input.token) || !isAddress(input.spender)) {
    throw new Error('Token and spender must be valid addresses.')
  }

  const token = getAddress(input.token)
  const spender = getAddress(input.spender)
  const currentAllowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, spender],
  })

  if (currentAllowance >= (input.minimumAmount ?? BigInt(1))) {
    return {
      approved: false,
      allowance: currentAllowance.toString(),
      spender,
      txHash: null as string | null,
    }
  }

  const hash = await walletClient.writeContract({
    account,
    chain: base,
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  })
  await publicClient.waitForTransactionReceipt({ hash })

  return {
    approved: true,
    allowance: maxUint256.toString(),
    spender,
    txHash: hash,
  }
}
