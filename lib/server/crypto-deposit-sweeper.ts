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
import { base, bsc, polygon } from 'viem/chains'
import { Address as TonAddress, TonClient, WalletContractV4, internal, toNano } from '@ton/ton'
import { mnemonicToPrivateKey } from '@ton/crypto'
import { getBaseBuilderDataSuffix, getBaseExecutorConfig } from '@/lib/server/base-executor'
import { getBscExecutorConfig } from '@/lib/server/bsc-executor'
import { createTonHttpAdapter, getTonExecutorConfig } from '@/lib/server/ton-executor'
import {
  claimCryptoDepositEventSweep,
  getCryptoDepositAddressSecretById,
  markCryptoDepositEventSweepFailed,
  markCryptoDepositEventSwept,
} from '@/lib/server/data'
import type { CryptoDepositEvent, CryptoOrder } from '@/types'

const BASE_GAS_BUFFER_WEI = parseUnits('0.00003', 18)
const BSC_GAS_BUFFER_WEI = parseUnits('0.00003', 18)
const POL_GAS_BUFFER_WEI = parseUnits('0.01', 18) // lowered because Polygon gas is extremely cheap; small test deposits should still be sweepable
const TON_GAS_BUFFER_NANO = toNano('0.05')
const BASE_TOKEN_GAS_TOPUP_WEI = parseUnits('0.00002', 18)
const BSC_TOKEN_GAS_TOPUP_WEI = parseUnits('0.00002', 18)

type SweepAsset = {
  chain: 'base' | 'bsc' | 'polygon' | 'ton'
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

function createPolygonClientsFromPrivateKey(privateKey: Hex) {
  let raw = (process.env.MAFITAPAY_POLYGON_RPC_URLS?.trim() || process.env.MAFITAPAY_POLYGON_RPC_URL?.trim() || '')
  if (!raw) {
    const alchemyKey = process.env.ALCHEMY_API_KEY?.trim()
    if (alchemyKey) {
      raw = `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`
    } else {
      raw = 'https://rpc.ankr.com/polygon'
    }
  }
  let rpcUrls = raw.split(',').map(item => item.trim()).filter(Boolean)
  const BROKEN_POLYGON_DEFAULT = 'https://polygon-rpc.com'
  if (rpcUrls.length > 1) {
    rpcUrls = rpcUrls.filter(u => !u.toLowerCase().includes('polygon-rpc.com'))
    if (rpcUrls.length === 0) rpcUrls = [BROKEN_POLYGON_DEFAULT]
  }
  const transport = rpcUrls.length > 1
    ? fallback(rpcUrls.map(url => http(url, { retryCount: 1, timeout: 10_000 })))
    : http(rpcUrls[0] || 'https://rpc.ankr.com/polygon', { retryCount: 1, timeout: 10_000 })
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    publicClient: createPublicClient({ chain: polygon, transport }),
    walletClient: createWalletClient({ account, chain: polygon, transport }),
  }
}

async function createTonSweepFromMnemonic(mnemonic: string) {
  const words = mnemonic.trim().split(/\s+/)
  if (words.length !== 24) {
    throw new Error('TON deposit secret must be a 24-word mnemonic.')
  }
  const keyPair = await mnemonicToPrivateKey(words)
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey })
  const config = getTonExecutorConfig()
  const httpAdapter = createTonHttpAdapter() as any
  const tonClient = new TonClient({
    endpoint: config.rpcUrl,
    apiKey: config.apiKeyConfigured ? config.apiKey : undefined,
    timeout: 12_000,
    httpAdapter,
  })
  const contract = tonClient.open(wallet)
  return {
    keyPair,
    wallet,
    tonClient,
    contract,
    depositAddress: wallet.address.toString({ bounceable: false, urlSafe: true }),
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

  if (pairId === 'POL_POLYGON') {
    return {
      chain: 'polygon',
      pairId,
      kind: 'native',
      gasBufferWei: POL_GAS_BUFFER_WEI,
      tokenGasTopupWei: parseUnits('0', 18),
    }
  }

  if (pairId === 'TON_TON') {
    return {
      chain: 'ton',
      pairId,
      kind: 'native',
      gasBufferWei: TON_GAS_BUFFER_NANO,
      tokenGasTopupWei: toNano('0'),
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

  if (input.asset.chain === 'bsc') {
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

  // polygon etc not needing for native POL, for erc20 would need similar
  // ton native also no gas topup from treasury (deposit pays its own)
  return null
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

  if (input.asset.chain === 'bsc') {
    const clients = createBscClientsFromPrivateKey(input.privateKey)
    return clients.walletClient.sendTransaction({
      account: clients.account,
      chain: bsc,
      to: input.treasuryAddress,
      value,
    })
  }

  const clients = createPolygonClientsFromPrivateKey(input.privateKey)
  return clients.walletClient.sendTransaction({
    account: clients.account,
    chain: polygon,
    to: input.treasuryAddress,
    value,
  })
}

async function sweepTonNative(input: {
  mnemonic: string
  treasuryAddress: string
  amountUnits: bigint
}) {
  const gasBuffer = TON_GAS_BUFFER_NANO
  if (input.amountUnits <= gasBuffer) {
    throw new Error('Native TON deposit is too small to sweep after reserving gas.')
  }

  const value = input.amountUnits - gasBuffer
  const sweep = await createTonSweepFromMnemonic(input.mnemonic)
  const seqno = await sweep.contract.getSeqno()
  await sweep.contract.sendTransfer({
    seqno,
    secretKey: sweep.keyPair.secretKey,
    messages: [internal({
      to: TonAddress.parse(input.treasuryAddress),
      value: value,
      bounce: true,
    })],
  })
  // TON sendTransfer is async fire, no immediate hash. Use a pseudo identifier based on seqno.
  // In practice, the tx can be looked up via toncenter or ston using the wallet + seqno.
  // For the deposit event, we record this pseudo as sweepTxHash.
  const pseudoHash = `ton-sweep-seq${seqno}-${Date.now().toString(36)}`
  return pseudoHash
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

  if (input.asset.chain === 'bsc') {
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

  const clients = createPolygonClientsFromPrivateKey(input.privateKey)
  return clients.walletClient.writeContract({
    account: clients.account,
    chain: polygon,
    address: input.asset.tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [input.treasuryAddress, input.amountUnits],
  })
}

export async function sweepCryptoDepositEvent(event: CryptoDepositEvent) {
  console.log(`[crypto-deposit-sweeper] sweepCryptoDepositEvent called for event=${event.externalEventId} pair=${event.pairId} status=${event.status} sweepStatus=${event.sweepStatus}`)
  if (event.status !== 'matched') {
    console.log(`[crypto-deposit-sweeper] skip sweep: not matched (status=${event.status})`)
    return { swept: false, reason: 'event_not_matched' }
  }
  if (event.sweepStatus === 'swept') {
    console.log(`[crypto-deposit-sweeper] skip sweep: already swept tx=${event.sweepTxHash}`)
    return { swept: false, reason: 'already_swept', txHash: event.sweepTxHash }
  }

  const claimed = await claimCryptoDepositEventSweep(event.externalEventId)
  if (!claimed) {
    console.log(`[crypto-deposit-sweeper] skip sweep: claim failed for ${event.externalEventId}`)
    return { swept: false, reason: 'not_claimed' }
  }

  try {
    console.log(`[crypto-deposit-sweeper] attempting sweep for event=${event.externalEventId} pair=${event.pairId} amount=${event.amountUnits}`)
    const asset = getSweepAsset(event.pairId)
    if (!asset) {
      console.warn(`[crypto-deposit-sweeper] unsupported pairId for sweep: ${event.pairId} (event=${event.externalEventId})`)
      throw new Error(`${event.pairId} is not supported for auto sweep yet.`)
    }

    const secret = await getCryptoDepositAddressSecretById(event.addressId)
    if (!secret) throw new Error('Deposit address secret is unavailable for sweep.')

    const family = secret.record.addressFamily
    let depositAddressStr = secret.record.address
    let privateKeyForEvm: Hex | undefined
    let mnemonicForTon: string | undefined

    if (family === 'evm' || asset.chain === 'base' || asset.chain === 'bsc' || asset.chain === 'polygon') {
      privateKeyForEvm = secret.secret.trim() as Hex
      const depositAccount = privateKeyToAccount(privateKeyForEvm)
      const depositAddress = getAddress(secret.record.address)
      if (depositAccount.address.toLowerCase() !== depositAddress.toLowerCase()) {
        throw new Error('Deposit address private key does not match the stored address.')
      }
      depositAddressStr = depositAddress
    } else if (family === 'ton' || asset.chain === 'ton') {
      mnemonicForTon = secret.secret.trim()
      // verify later in sweep
    } else {
      throw new Error(`Sweep not supported for address family ${family} yet.`)
    }

    let treasuryAddress: string | Address
    if (asset.chain === 'base') {
      treasuryAddress = getBaseExecutorConfig().configuredAddress
    } else if (asset.chain === 'bsc') {
      const config = getBscExecutorConfig()
      if (config.configuredAddress) treasuryAddress = config.configuredAddress
      else if (!config.privateKey) throw new Error('MAFITAPAY_BSC_EXECUTOR_PRIVATE_KEY is required to resolve BSC treasury address.')
      else treasuryAddress = privateKeyToAccount(config.privateKey).address
    } else if (asset.chain === 'polygon') {
      const addr = process.env.MAFITAPAY_POLYGON_EXECUTOR_ADDRESS?.trim()
      if (addr) treasuryAddress = getAddress(addr)
      else {
        const pk = process.env.MAFITAPAY_POLYGON_EXECUTOR_PRIVATE_KEY?.trim() as Hex | undefined
        if (!pk) throw new Error('MAFITAPAY_POLYGON_EXECUTOR_PRIVATE_KEY or ADDRESS is required to resolve Polygon treasury address.')
        treasuryAddress = privateKeyToAccount(pk).address
      }
    } else if (asset.chain === 'ton') {
      const addr = process.env.MAFITAPAY_TON_EXECUTOR_ADDRESS?.trim()
      if (addr) {
        treasuryAddress = TonAddress.parse(addr).toString({ bounceable: false, urlSafe: true })
      } else {
        throw new Error('MAFITAPAY_TON_EXECUTOR_ADDRESS is required to resolve TON treasury address.')
      }
    } else {
      throw new Error(`No treasury resolution for chain ${asset.chain}`)
    }
    const amountUnits = BigInt(event.amountUnits)
    let hash: any
    if (asset.kind === 'erc20') {
      if (!privateKeyForEvm) throw new Error('EVM private key required for ERC20 sweep.')
      hash = await sweepErc20({ asset, privateKey: privateKeyForEvm, depositAddress: getAddress(depositAddressStr), treasuryAddress: getAddress(treasuryAddress as string), amountUnits })
    } else if (asset.chain === 'ton') {
      if (!mnemonicForTon) throw new Error('TON mnemonic required for sweep.')
      // treasuryAddress for ton is string
      hash = await sweepTonNative({ mnemonic: mnemonicForTon, treasuryAddress: treasuryAddress as string, amountUnits })
    } else {
      if (!privateKeyForEvm) throw new Error('EVM private key required for native sweep.')
      hash = await sweepNative({ asset, privateKey: privateKeyForEvm, treasuryAddress: getAddress(treasuryAddress as string), amountUnits })
    }

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
