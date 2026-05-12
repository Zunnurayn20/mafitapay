import type { CryptoOrder } from '@/types'
import { privateKeyToAccount } from 'viem/accounts'
import { bsc } from 'viem/chains'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  fallback,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Hex,
} from 'viem'

const DEFAULT_BSC_RPC_URL = 'https://bsc-dataseed.binance.org'
const DEFAULT_BSC_USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'
const MIN_BSC_GAS_BUFFER_WEI = parseUnits('0.00003', 18)

export function getBscExecutorConfig() {
  const rpcUrls = (process.env.MAFITAPAY_BSC_RPC_URLS?.trim() || process.env.MAFITAPAY_BSC_RPC_URL?.trim() || DEFAULT_BSC_RPC_URL)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const rpcUrl = rpcUrls[0] || DEFAULT_BSC_RPC_URL
  const privateKey = process.env.MAFITAPAY_BSC_EXECUTOR_PRIVATE_KEY?.trim() as Hex | undefined
  const configuredAddress = process.env.MAFITAPAY_BSC_EXECUTOR_ADDRESS?.trim()

  return {
    rpcUrl,
    rpcUrls,
    privateKeyConfigured: Boolean(privateKey),
    configuredAddress: configuredAddress ? getAddress(configuredAddress) : null,
    usdtAddress: getAddress(process.env.MAFITAPAY_BSC_USDT_ADDRESS?.trim() || DEFAULT_BSC_USDT_ADDRESS),
    privateKey,
  }
}

export function getBscExecutorHealth() {
  const config = getBscExecutorConfig()
  const warnings: string[] = []
  let derivedAddress: string | null = null
  let walletMatchesConfiguredAddress = false

  if (config.privateKey) {
    try {
      derivedAddress = privateKeyToAccount(config.privateKey).address
      walletMatchesConfiguredAddress = config.configuredAddress
        ? derivedAddress.toLowerCase() === config.configuredAddress.toLowerCase()
        : true
      if (config.configuredAddress && !walletMatchesConfiguredAddress) {
        warnings.push('Configured BSC executor address does not match the loaded private key.')
      }
    } catch {
      warnings.push('BSC executor private key is present but invalid.')
    }
  } else {
    warnings.push('BSC executor private key is missing.')
  }

  return {
    ready: Boolean(config.privateKey) && walletMatchesConfiguredAddress,
    rpcUrl: config.rpcUrl,
    configuredAddress: config.configuredAddress,
    derivedAddress,
    walletMatchesConfiguredAddress,
    contracts: {
      usdt: config.usdtAddress,
    },
    criticalChecks: [
      {
        key: 'private_key',
        label: 'Executor Private Key',
        ready: Boolean(config.privateKey),
        detail: config.privateKeyConfigured ? 'Configured.' : 'Missing MAFITAPAY_BSC_EXECUTOR_PRIVATE_KEY.',
      },
      {
        key: 'wallet_match',
        label: 'Wallet Match',
        ready: walletMatchesConfiguredAddress,
        detail: config.configuredAddress
          ? walletMatchesConfiguredAddress
            ? 'Configured wallet address matches the loaded signing key.'
            : 'Configured wallet address does not match the signing key.'
          : 'No explicit wallet address configured; derived signer will be used.',
      },
    ],
    warnings,
  }
}

function normalizeBscRpcError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message || ''
    if (message.includes('HTTP request failed') || message.includes('fetch failed')) {
      return new Error('BSC RPC is unavailable right now. Configure a dedicated BSC RPC URL in MAFITAPAY_BSC_RPC_URL or MAFITAPAY_BSC_RPC_URLS and try again.')
    }
    return error
  }

  return new Error('BSC RPC request failed.')
}

function getBscClients() {
  const config = getBscExecutorConfig()
  if (!config.privateKey) {
    throw new Error('MAFITAPAY_BSC_EXECUTOR_PRIVATE_KEY is not configured.')
  }

  const account = privateKeyToAccount(config.privateKey)
  if (config.configuredAddress && account.address.toLowerCase() !== config.configuredAddress.toLowerCase()) {
    throw new Error('Configured BSC executor address does not match the loaded private key.')
  }

  const transport = config.rpcUrls.length > 1
    ? fallback(config.rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(config.rpcUrl, { retryCount: 1, timeout: 10_000 })
  const publicClient = createPublicClient({
    chain: bsc,
    transport,
  })
  const walletClient = createWalletClient({
    account,
    chain: bsc,
    transport,
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

export async function getBscTreasuryBalances() {
  try {
    const { account, config, publicClient } = getBscClients()

    const [nativeBalance, usdtBalance] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({
        address: config.usdtAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      }),
    ])

    return {
      walletAddress: account.address,
      bnbWei: nativeBalance.toString(),
      usdtUnits: usdtBalance.toString(),
    }
  } catch (error) {
    throw normalizeBscRpcError(error)
  }
}

export async function assertBscTreasuryCanExecuteBuy(input: {
  pairId: CryptoOrder['pairId']
  cryptoAmount: number
}) {
  const health = getBscExecutorHealth()
  if (!health.ready) {
    const reason = health.warnings[0] || 'BSC executor is not ready.'
    throw new Error(reason)
  }

  const balances = await getBscTreasuryBalances()
  const bnbWei = BigInt(balances.bnbWei)
  const usdtUnits = BigInt(balances.usdtUnits)

  if (input.pairId === 'USDT_BSC') {
    const requiredUsdtUnits = toUnits(input.cryptoAmount, 18)
    if (usdtUnits < requiredUsdtUnits) {
      throw new Error('USDT treasury on BSC is too low to fulfill this order right now.')
    }
    if (bnbWei < MIN_BSC_GAS_BUFFER_WEI) {
      throw new Error('BSC executor gas is too low for this order. Try again shortly.')
    }
    return
  }

  if (input.pairId === 'BNB_BSC') {
    const requiredBnbWei = toUnits(input.cryptoAmount, 18) + MIN_BSC_GAS_BUFFER_WEI
    if (bnbWei < requiredBnbWei) {
      throw new Error('BNB treasury is too low to fulfill this order right now.')
    }
    return
  }

  throw new Error(`${input.pairId} is not supported for BSC treasury execution.`)
}

export async function broadcastBscTransaction(input: {
  to: string
  data?: string
  value?: string | number | bigint
}) {
  try {
    const { account, walletClient } = getBscClients()
    if (!isAddress(input.to)) {
      throw new Error('Invalid BSC transaction target address.')
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
      chain: bsc,
    })

    return {
      hash,
      from: account.address,
      to: getAddress(input.to),
      value: value.toString(),
      data: input.data ?? '0x',
    }
  } catch (error) {
    throw normalizeBscRpcError(error)
  }
}

export async function getBscTransactionReceiptState(hash: string) {
  try {
    const { publicClient } = getBscClients()
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error('Invalid BSC transaction hash.')
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
    if (error instanceof Error && error.message === 'Invalid BSC transaction hash.') throw error
    if (error instanceof Error && (error.message.includes('TransactionReceiptNotFoundError') || error.message.includes('not found'))) {
      return {
        found: false,
        status: 'pending' as const,
        blockNumber: null,
        transactionHash: hash,
        gasUsed: null,
      }
    }
    const normalized = normalizeBscRpcError(error)
    if (normalized.message !== 'BSC RPC is unavailable right now. Configure a dedicated BSC RPC URL in MAFITAPAY_BSC_RPC_URL or MAFITAPAY_BSC_RPC_URLS and try again.') {
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

export async function getBscUsdtDeliveryEvidence(hash: string, expectedRecipient?: string) {
  const { config, publicClient } = getBscClients()
  const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex })
  const normalizedRecipient = expectedRecipient ? getAddress(expectedRecipient) : null

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.usdtAddress.toLowerCase()) continue

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

export async function getBscNativeDeliveryEvidence(hash: string) {
  const { publicClient } = getBscClients()
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

export async function broadcastBscDeliveryForOrder(order: CryptoOrder) {
  const { account, config, walletClient } = getBscClients()

  if (order.executionRail !== 'bsc_treasury') {
    throw new Error('Only BSC treasury orders can be broadcast through the BSC executor.')
  }
  if (!order.walletAddress || !isAddress(order.walletAddress)) {
    throw new Error('A valid destination wallet address is required before BSC delivery.')
  }
  if (order.status !== 'pending') {
    throw new Error(`Order is already ${order.status}.`)
  }

  const to = getAddress(order.walletAddress)

  if (order.pairId === 'USDT_BSC') {
    const hash = await walletClient.writeContract({
      account,
      chain: bsc,
      address: config.usdtAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, toUnits(order.cryptoAmount, 18)],
    })

    return {
      mode: 'delivery' as const,
      asset: 'USDT_BSC' as const,
      hash,
      from: account.address,
      to,
    }
  }

  if (order.pairId === 'BNB_BSC') {
    const delivery = await broadcastBscTransaction({
      to,
      value: toUnits(order.cryptoAmount, 18),
    })

    return {
      mode: 'delivery' as const,
      asset: 'BNB_BSC' as const,
      hash: delivery.hash,
      from: delivery.from,
      to,
    }
  }

  throw new Error(`Direct BSC delivery is only supported for USDT_BSC and BNB_BSC. ${order.pairId} still needs a different execution rail.`)
}
