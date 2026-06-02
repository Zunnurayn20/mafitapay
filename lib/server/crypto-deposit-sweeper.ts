import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  fallback,
  getAddress,
  http,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, bsc } from 'viem/chains'
import { getBaseBuilderDataSuffix, getBaseExecutorConfig } from '@/lib/server/base-executor'
import { getBscExecutorConfig } from '@/lib/server/bsc-executor'
import {
  claimCryptoDepositEventSweep,
  getCryptoDepositAddressSecretById,
  markCryptoDepositEventSweepFailed,
  markCryptoDepositEventSwept,
} from '@/lib/server/data'
import type { CryptoDepositEvent, CryptoOrder } from '@/types'

const BASE_GAS_BUFFER_WEI = parseUnits('0.00003', 18)
const BSC_GAS_BUFFER_WEI = parseUnits('0.00003', 18)
const BASE_TOKEN_GAS_TOPUP_WEI = parseUnits('0.00002', 18)
const BSC_TOKEN_GAS_TOPUP_WEI = parseUnits('0.00002', 18)

type SweepAsset = {
  chain: 'base' | 'bsc'
  pairId: CryptoOrder['pairId']
  kind: 'erc20' | 'native'
  tokenAddress?: Address
  gasBufferWei: bigint
  tokenGasTopupWei: bigint
}

function createBaseClientsFromPrivateKey(privateKey: Hex) {
  const config = getBaseExecutorConfig()
  const transport = config.rpcUrls.length > 1
    ? fallback(config.rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(config.rpcUrl, { retryCount: 1, timeout: 10_000 })
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    config,
    publicClient: createPublicClient({ chain: base, transport }),
    walletClient: createWalletClient({
      account,
      chain: base,
      transport,
      dataSuffix: getBaseBuilderDataSuffix(),
    }),
  }
}

function createBscClientsFromPrivateKey(privateKey: Hex) {
  const config = getBscExecutorConfig()
  const transport = config.rpcUrls.length > 1
    ? fallback(config.rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(config.rpcUrl, { retryCount: 1, timeout: 10_000 })
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    config,
    publicClient: createPublicClient({ chain: bsc, transport }),
    walletClient: createWalletClient({ account, chain: bsc, transport }),
  }
}

function getSweepAsset(pairId: CryptoOrder['pairId']): SweepAsset | null {
  const baseConfig = getBaseExecutorConfig()
  const bscConfig = getBscExecutorConfig()

  if (pairId === 'USDC_BASE') {
    return {
      chain: 'base',
      pairId,
      kind: 'erc20',
      tokenAddress: baseConfig.usdcAddress,
      gasBufferWei: BASE_GAS_BUFFER_WEI,
      tokenGasTopupWei: BASE_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'ETH_BASE') {
    return {
      chain: 'base',
      pairId,
      kind: 'native',
      gasBufferWei: BASE_GAS_BUFFER_WEI,
      tokenGasTopupWei: BASE_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'USDT_BSC') {
    return {
      chain: 'bsc',
      pairId,
      kind: 'erc20',
      tokenAddress: bscConfig.usdtAddress,
      gasBufferWei: BSC_GAS_BUFFER_WEI,
      tokenGasTopupWei: BSC_TOKEN_GAS_TOPUP_WEI,
    }
  }

  if (pairId === 'BNB_BSC') {
    return {
      chain: 'bsc',
      pairId,
      kind: 'native',
      gasBufferWei: BSC_GAS_BUFFER_WEI,
      tokenGasTopupWei: BSC_TOKEN_GAS_TOPUP_WEI,
    }
  }

  return null
}

async function ensureTokenSweepGas(input: {
  asset: SweepAsset
  depositAddress: Address
}) {
  if (input.asset.chain === 'base') {
    const config = getBaseExecutorConfig()
    if (!config.privateKey) throw new Error('MAFITAPAY_BASE_EXECUTOR_PRIVATE_KEY is required for Base token sweep gas top-up.')
    const treasury = createBaseClientsFromPrivateKey(config.privateKey)
    const balance = await treasury.publicClient.getBalance({ address: input.depositAddress })
    if (balance >= input.asset.tokenGasTopupWei) return null
    const hash = await treasury.walletClient.sendTransaction({
      account: treasury.account,
      chain: base,
      to: input.depositAddress,
      value: input.asset.tokenGasTopupWei,
    })
    await treasury.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  const config = getBscExecutorConfig()
  if (!config.privateKey) throw new Error('MAFITAPAY_BSC_EXECUTOR_PRIVATE_KEY is required for BSC token sweep gas top-up.')
  const treasury = createBscClientsFromPrivateKey(config.privateKey)
  const balance = await treasury.publicClient.getBalance({ address: input.depositAddress })
  if (balance >= input.asset.tokenGasTopupWei) return null
  const hash = await treasury.walletClient.sendTransaction({
    account: treasury.account,
    chain: bsc,
    to: input.depositAddress,
    value: input.asset.tokenGasTopupWei,
  })
  await treasury.publicClient.waitForTransactionReceipt({ hash })
  return hash
}

async function sweepNative(input: {
  asset: SweepAsset
  privateKey: Hex
  treasuryAddress: Address
  amountUnits: bigint
}) {
  if (input.amountUnits <= input.asset.gasBufferWei) {
    throw new Error('Native deposit is too small to sweep after reserving gas.')
  }

  const value = input.amountUnits - input.asset.gasBufferWei
  if (input.asset.chain === 'base') {
    const clients = createBaseClientsFromPrivateKey(input.privateKey)
    return clients.walletClient.sendTransaction({
      account: clients.account,
      chain: base,
      to: input.treasuryAddress,
      value,
    })
  }

  const clients = createBscClientsFromPrivateKey(input.privateKey)
  return clients.walletClient.sendTransaction({
    account: clients.account,
    chain: bsc,
    to: input.treasuryAddress,
    value,
  })
}

async function sweepErc20(input: {
  asset: SweepAsset
  privateKey: Hex
  depositAddress: Address
  treasuryAddress: Address
  amountUnits: bigint
}) {
  if (!input.asset.tokenAddress) throw new Error('Token contract is missing for sweep.')
  await ensureTokenSweepGas({ asset: input.asset, depositAddress: input.depositAddress })

  if (input.asset.chain === 'base') {
    const clients = createBaseClientsFromPrivateKey(input.privateKey)
    return clients.walletClient.writeContract({
      account: clients.account,
      chain: base,
      address: input.asset.tokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [input.treasuryAddress, input.amountUnits],
    })
  }

  const clients = createBscClientsFromPrivateKey(input.privateKey)
  return clients.walletClient.writeContract({
    account: clients.account,
    chain: bsc,
    address: input.asset.tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [input.treasuryAddress, input.amountUnits],
  })
}

export async function sweepCryptoDepositEvent(event: CryptoDepositEvent) {
  if (event.status !== 'matched') return { swept: false, reason: 'event_not_matched' }
  if (event.sweepStatus === 'swept') return { swept: false, reason: 'already_swept', txHash: event.sweepTxHash }

  const claimed = await claimCryptoDepositEventSweep(event.externalEventId)
  if (!claimed) return { swept: false, reason: 'not_claimed' }

  try {
    const asset = getSweepAsset(event.pairId)
    if (!asset) throw new Error(`${event.pairId} is not supported for auto sweep yet.`)

    const secret = await getCryptoDepositAddressSecretById(event.addressId)
    if (!secret) throw new Error('Deposit address secret is unavailable for sweep.')

    const privateKey = secret.secret.trim() as Hex
    const depositAccount = privateKeyToAccount(privateKey)
    const depositAddress = getAddress(secret.record.address)
    if (depositAccount.address.toLowerCase() !== depositAddress.toLowerCase()) {
      throw new Error('Deposit address private key does not match the stored address.')
    }

    const treasuryAddress = asset.chain === 'base'
      ? getBaseExecutorConfig().configuredAddress
      : (() => {
          const config = getBscExecutorConfig()
          if (config.configuredAddress) return config.configuredAddress
          if (!config.privateKey) throw new Error('MAFITAPAY_BSC_EXECUTOR_PRIVATE_KEY is required to resolve BSC treasury address.')
          return privateKeyToAccount(config.privateKey).address
        })()
    const amountUnits = BigInt(event.amountUnits)
    const hash = asset.kind === 'erc20'
      ? await sweepErc20({ asset, privateKey, depositAddress, treasuryAddress, amountUnits })
      : await sweepNative({ asset, privateKey, treasuryAddress, amountUnits })

    await markCryptoDepositEventSwept({
      externalEventId: event.externalEventId,
      txHash: hash,
    })
    console.info('[crypto-deposit-sweeper] swept', JSON.stringify({
      eventId: event.id,
      externalEventId: event.externalEventId,
      pairId: event.pairId,
      amountUnits: event.amountUnits,
      txHash: hash,
      treasuryAddress,
    }))
    return { swept: true, txHash: hash }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sweep failed.'
    await markCryptoDepositEventSweepFailed({
      externalEventId: event.externalEventId,
      error: message,
    })
    console.warn('[crypto-deposit-sweeper] failed', JSON.stringify({
      eventId: event.id,
      externalEventId: event.externalEventId,
      pairId: event.pairId,
      reason: message,
    }))
    return { swept: false, reason: message }
  }
}
