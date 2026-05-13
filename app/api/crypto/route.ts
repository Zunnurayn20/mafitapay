import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { applyWalletMutation, consumeCryptoQuote, createCryptoOrder, createCryptoQuote, ensureCryptoMarketAutoRefreshScheduler, getCryptoAssets, getCryptoOrderById, getWalletByUserId, kickCryptoMarketRefresh } from '@/lib/server/data'
import { assertBaseTreasuryCanExecuteBuy } from '@/lib/server/base-executor'
import { getExecutionRailForAsset } from '@/lib/crypto-execution'
import { ensureBscReceiptAutoSyncWatchdog, kickBscReceiptAutoSync } from '@/lib/server/bsc-receipt-sync'
import { ensureBaseReceiptAutoSyncWatchdog, kickBaseReceiptAutoSync } from '@/lib/server/base-receipt-sync'
import { settleCryptoOrderTerminalState } from '@/lib/server/crypto-order-reconciliation'
import { triggerCryptoOrderExecution } from '@/lib/server/crypto-order-execution'
import { assertLifiRouteCanExecuteBuy, assertLifiTreasuryCanExecuteBuy, getLifiQuotedReceiveForBuy } from '@/lib/server/lifi'
import { assertNearIntentsTreasuryCanExecuteBuy, getNearQuotedReceiveForBuy } from '@/lib/server/near-intents'
import { ensureNearReceiptAutoSyncWatchdog, kickNearReceiptAutoSync } from '@/lib/server/near-receipt-sync'
import { ensureRoutedReceiptAutoSyncWatchdog, kickRoutedReceiptAutoSync } from '@/lib/server/routed-receipt-sync'
import { ensureSuiReceiptAutoSyncWatchdog, kickSuiReceiptAutoSync } from '@/lib/server/sui-receipt-sync'
import { assertSuiTreasuryCanExecuteBuy, getSuiQuotedReceiveForBuy } from '@/lib/server/sui-treasury'
import { assertTonTreasuryCanExecuteBuy, getTonQuotedReceiveForBuy } from '@/lib/server/ton-executor'
import { ensureTonReceiptAutoSyncWatchdog, kickTonReceiptAutoSync } from '@/lib/server/ton-receipt-sync'
import { validateWalletAddressForAsset } from '@/lib/crypto-addresses'
import { getMaxQuoteDriftPercentForAsset, getMinimumBuyNgnForAsset, getQuoteDriftPercent } from '@/lib/crypto-rules'
import { formatCrypto, generateRef } from '@/lib/utils'
import type { CryptoAsset, CryptoPairId } from '@/types'

const CRYPTO_MARKET_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_CRYPTO_MARKET === '1'
const CRYPTO_ORDER_LOGGING_ENABLED = process.env.MAFITAPAY_DEBUG_CRYPTO !== '0'

function logCrypto(event: string, details?: Record<string, unknown>) {
  if (!CRYPTO_ORDER_LOGGING_ENABLED) return
  const payload = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[crypto] ${event}${payload}`)
}

function assertMinimumBuyAmount(asset: CryptoAsset, amountNgn: number) {
  const minimumBuyNgn = getMinimumBuyNgnForAsset(asset)
  if (amountNgn < minimumBuyNgn) {
    throw new Error(`Minimum buy amount for ${asset.id} is ₦${minimumBuyNgn.toLocaleString('en-NG')}.`)
  }
}

function assertDestinationWalletAddressForAsset(asset: CryptoAsset, walletAddress: string) {
  const result = validateWalletAddressForAsset(asset, walletAddress)
  if (!result.valid) {
    throw new Error(result.error || 'Destination wallet address is invalid.')
  }
}

async function assertTreasuryCanExecuteBuy(input: {
  asset: CryptoAsset
  pairId: CryptoPairId
  amountNgn: number
  cryptoAmount: number
  walletAddress?: string
}) {
  if (input.pairId === 'USDC_BASE' || input.pairId === 'ETH_BASE') {
    await assertBaseTreasuryCanExecuteBuy(input)
    return
  }
  if (getExecutionRailForAsset(input.asset) === 'routed_treasury') {
    await assertLifiTreasuryCanExecuteBuy({ amountNgn: input.amountNgn })
    if (!input.walletAddress) {
      throw new Error('Destination wallet address is required for routed execution.')
    }
    await assertLifiRouteCanExecuteBuy({
      pairId: input.pairId,
      asset: input.asset,
      amountNgn: input.amountNgn,
      quotedCryptoAmount: input.cryptoAmount,
      toAddress: input.walletAddress,
    })
    return
  }
  if (input.pairId === 'SUI_SUI') {
    await assertSuiTreasuryCanExecuteBuy({ amountNgn: input.amountNgn })
    return
  }
  if (input.pairId === 'TON_TON') {
    await assertTonTreasuryCanExecuteBuy({ amountNgn: input.amountNgn })
    return
  }
  if (input.pairId === 'NEAR_NEAR') {
    await assertNearIntentsTreasuryCanExecuteBuy({ amountNgn: input.amountNgn })
    return
  }
  throw new Error(`${input.pairId} is not enabled for in-app execution yet.`)
}

async function assertQuoteStillMatchesLiveMarket(asset: CryptoAsset, side: 'buy' | 'sell', quotedRate: number) {
  const assets = await getCryptoAssets({ forceRefresh: true, liveOnly: true })
  const liveAsset = assets.find(item => item.id === asset.id)
  const liveRate = side === 'buy' ? liveAsset?.buyRate : liveAsset?.sellRate

  if (!liveAsset || !liveRate || liveRate <= 0) {
    throw new Error('Live pricing is temporarily unavailable. Please try again in a moment.')
  }

  const driftPercent = getQuoteDriftPercent(quotedRate, liveRate)
  const maxDriftPercent = getMaxQuoteDriftPercentForAsset(liveAsset)

  if (driftPercent > maxDriftPercent) {
    throw new Error(`Market moved by ${driftPercent.toFixed(2)}%. Maximum allowed drift for ${asset.symbol} is ${maxDriftPercent.toFixed(2)}%. Please requote and try again.`)
  }

  return liveAsset
}

export async function GET(req: Request) {
  ensureCryptoMarketAutoRefreshScheduler()
  const { searchParams } = new URL(req.url)
  const forceRefresh = searchParams.get('refresh') === '1'
  const liveOnly = searchParams.get('strict') === '1'
  if (CRYPTO_MARKET_LOGGING_ENABLED) {
    console.log('[api/crypto] GET', JSON.stringify({ forceRefresh, liveOnly }))
  }
  return NextResponse.json({ data: await getCryptoAssets({ forceRefresh, liveOnly }), success: true })
}

export async function POST(req: Request) {
  ensureCryptoMarketAutoRefreshScheduler()
  void kickCryptoMarketRefresh()
  ensureBaseReceiptAutoSyncWatchdog()
  await kickBaseReceiptAutoSync()
  ensureBscReceiptAutoSyncWatchdog()
  await kickBscReceiptAutoSync()
  ensureRoutedReceiptAutoSyncWatchdog()
  await kickRoutedReceiptAutoSync()
  ensureSuiReceiptAutoSyncWatchdog()
  await kickSuiReceiptAutoSync()
  ensureNearReceiptAutoSyncWatchdog()
  await kickNearReceiptAutoSync()
  ensureTonReceiptAutoSyncWatchdog()
  await kickTonReceiptAutoSync()
  const user = await requireUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const intent = body.intent === 'quote' ? 'quote' : body.intent === 'preflight' ? 'preflight' : 'execute'
  const action = body.action === 'sell' ? 'sell' : 'buy'
  const pairId = typeof body.pairId === 'string' ? body.pairId.trim() : ''
  const amount = Number(body.amount)
  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : ''

  logCrypto('request', {
    intent,
    action,
    pairId,
    amount,
    userId: user.id,
    hasWalletAddress: Boolean(walletAddress),
  })

  if (!pairId) {
    return NextResponse.json({ error: 'pairId is required.', success: false }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount', success: false }, { status: 400 })
  }

  const assets = await getCryptoAssets()
  const requestedAsset = assets.find(item => item.id === pairId)
  if (!requestedAsset) {
    return NextResponse.json({ error: 'Crypto pair not found.', success: false }, { status: 404 })
  }

  if (intent === 'quote') {
    try {
      const executionRail = getExecutionRailForAsset(requestedAsset)
      if (action === 'buy') {
        if (!walletAddress) {
          return NextResponse.json({ error: 'Destination wallet address is required', success: false }, { status: 400 })
        }
        assertDestinationWalletAddressForAsset(requestedAsset, walletAddress)
      }
      if (action === 'buy' && executionRail === 'routed_treasury') {
        assertMinimumBuyAmount(requestedAsset, amount)
        const routedQuote = await getLifiQuotedReceiveForBuy({
          pairId: requestedAsset.id,
          asset: requestedAsset,
          amountNgn: amount,
          toAddress: walletAddress,
        })
        const data = await createCryptoQuote({
          userId: user.id,
          pairId: requestedAsset.id,
          side: action,
          amountNgn: amount,
          cryptoAmount: routedQuote.cryptoAmount,
          unitRate: routedQuote.unitRate,
          providerPayload: routedQuote.providerPayload,
        })
        logCrypto('quote.success', {
          action,
          pairId,
          executionRail,
          amount,
          cryptoAmount: routedQuote.cryptoAmount,
          unitRate: routedQuote.unitRate,
        })
        return NextResponse.json({ data, success: true })
      }
      if (action === 'buy' && executionRail === 'sui_treasury') {
        assertMinimumBuyAmount(requestedAsset, amount)
        const suiQuote = await getSuiQuotedReceiveForBuy({
          amountNgn: amount,
          toAddress: walletAddress,
        })
        const data = await createCryptoQuote({
          userId: user.id,
          pairId: requestedAsset.id,
          side: action,
          amountNgn: amount,
          cryptoAmount: suiQuote.cryptoAmount,
          unitRate: suiQuote.unitRate,
          providerPayload: suiQuote.providerPayload,
        })
        logCrypto('quote.success', {
          action,
          pairId,
          executionRail,
          amount,
          cryptoAmount: suiQuote.cryptoAmount,
          unitRate: suiQuote.unitRate,
        })
        return NextResponse.json({ data, success: true })
      }
      if (action === 'buy' && executionRail === 'ton_treasury') {
        assertMinimumBuyAmount(requestedAsset, amount)
        const tonQuote = await getTonQuotedReceiveForBuy({
          amountNgn: amount,
          toAddress: walletAddress,
        })
        const data = await createCryptoQuote({
          userId: user.id,
          pairId: requestedAsset.id,
          side: action,
          amountNgn: amount,
          cryptoAmount: tonQuote.cryptoAmount,
          unitRate: tonQuote.unitRate,
          providerPayload: tonQuote.providerPayload,
        })
        logCrypto('quote.success', {
          action,
          pairId,
          executionRail,
          amount,
          cryptoAmount: tonQuote.cryptoAmount,
          unitRate: tonQuote.unitRate,
        })
        return NextResponse.json({ data, success: true })
      }
      if (action === 'buy' && executionRail === 'near_intents') {
        assertMinimumBuyAmount(requestedAsset, amount)
        const nearQuote = await getNearQuotedReceiveForBuy({
          amountNgn: amount,
          toAddress: walletAddress,
        })
        const data = await createCryptoQuote({
          userId: user.id,
          pairId: requestedAsset.id,
          side: action,
          amountNgn: amount,
          cryptoAmount: nearQuote.cryptoAmount,
          unitRate: nearQuote.unitRate,
          providerPayload: nearQuote.providerPayload,
        })
        logCrypto('quote.success', {
          action,
          pairId,
          executionRail,
          amount,
          cryptoAmount: nearQuote.cryptoAmount,
          unitRate: nearQuote.unitRate,
        })
        return NextResponse.json({ data, success: true })
      }
      const data = await createCryptoQuote({
        userId: user.id,
        pairId: requestedAsset.id,
        side: action,
        amountNgn: amount,
      })
      logCrypto('quote.success', {
        action,
        pairId,
        executionRail,
        amount,
        cryptoAmount: data.quote.cryptoAmount,
        unitRate: data.quote.unitRate,
      })
      return NextResponse.json({ data, success: true })
    } catch (error) {
      logCrypto('quote.error', {
        action,
        pairId,
        amount,
        walletAddress,
        error: error instanceof Error ? error.message : 'Quote creation failed.',
      })
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Quote creation failed.', success: false }, { status: 400 })
    }
  }

  if (intent === 'preflight') {
    const wallet = await getWalletByUserId(user.id)
    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found', success: false }, { status: 404 })
    }

    const asset = requestedAsset

    if (action !== 'buy') {
      logCrypto('preflight.success', {
        action,
        pairId: asset.id,
        amount,
        executionRail: null,
      })
      return NextResponse.json({ data: { ready: true }, success: true })
    }

    if (asset.baseExecutionEnabled !== true) {
      return NextResponse.json({
        error: `${asset.id} is not enabled for in-app execution yet.`,
        success: false,
      }, { status: 400 })
    }

    try {
      assertMinimumBuyAmount(asset, amount)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Amount is below the minimum buy size.',
        success: false,
      }, { status: 400 })
    }

    if (!walletAddress) {
      return NextResponse.json({ error: 'Destination wallet address is required', success: false }, { status: 400 })
    }
    try {
      assertDestinationWalletAddressForAsset(asset, walletAddress)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Destination wallet address is invalid.',
        success: false,
      }, { status: 400 })
    }

    if (wallet.balance < amount) {
      return NextResponse.json({ error: 'Insufficient NGN balance', success: false }, { status: 400 })
    }

    try {
      const executionRail = getExecutionRailForAsset(asset)
      if (executionRail === 'routed_treasury') {
        await assertLifiTreasuryCanExecuteBuy({ amountNgn: amount })
      } else if (executionRail === 'sui_treasury') {
        await assertSuiTreasuryCanExecuteBuy({ amountNgn: amount })
      } else if (executionRail === 'near_intents') {
        await assertNearIntentsTreasuryCanExecuteBuy({ amountNgn: amount })
      } else if (executionRail === 'ton_treasury') {
        await assertTonTreasuryCanExecuteBuy({ amountNgn: amount })
      } else {
        await assertTreasuryCanExecuteBuy({
          asset,
          pairId: asset.id,
          amountNgn: amount,
          cryptoAmount: asset.buyRate > 0 ? amount / asset.buyRate : 0,
          walletAddress,
        })
      }
      logCrypto('preflight.success', {
        action,
        pairId: asset.id,
        amount,
        executionRail,
        walletAddress,
      })
      return NextResponse.json({
        data: {
          ready: true,
          assetId: asset.id,
        },
        success: true,
      })
    } catch (error) {
      logCrypto('preflight.error', {
        action,
        pairId: asset.id,
        amount,
        executionRail: getExecutionRailForAsset(asset),
        walletAddress,
        error: error instanceof Error ? error.message : 'Treasury cannot fulfill this order right now.',
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Treasury cannot fulfill this order right now.',
        success: false,
      }, { status: 400 })
    }
  }

  const quoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : ''
  if (!quoteId) {
    return NextResponse.json({ error: 'quoteId is required.', success: false }, { status: 400 })
  }

  let asset
  let quote
  try {
    const consumed = await consumeCryptoQuote(user.id, quoteId, action)
    asset = consumed.asset
    quote = consumed.quote
  } catch (error) {
    logCrypto('execute.quote-consume-error', {
      action,
      pairId,
      quoteId,
      error: error instanceof Error ? error.message : 'Quote execution failed.',
    })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Quote execution failed.', success: false }, { status: 400 })
  }

  const wallet = await getWalletByUserId(user.id)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found', success: false }, { status: 404 })
  }

  const quotedAmount = quote.amountNgn
  const fee = 0
  const cryptoAmount = quote.cryptoAmount
  const ref = generateRef()
  let liveAsset = asset

  let transaction

  if (action === 'buy') {
    if (asset.baseExecutionEnabled !== true) {
      return NextResponse.json({
        error: `${asset.id} is not enabled for in-app execution yet.`,
        success: false,
      }, { status: 400 })
    }

    try {
      assertMinimumBuyAmount(asset, quotedAmount)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Amount is below the minimum buy size.',
        success: false,
      }, { status: 400 })
    }

    if (!walletAddress) {
      return NextResponse.json({ error: 'Destination wallet address is required', success: false }, { status: 400 })
    }
    try {
      assertDestinationWalletAddressForAsset(asset, walletAddress)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Destination wallet address is invalid.',
        success: false,
      }, { status: 400 })
    }

    const totalDebit = quotedAmount + fee
    if (wallet.balance < totalDebit) {
      return NextResponse.json({ error: 'Insufficient NGN balance', success: false }, { status: 400 })
    }
    try {
      const executionRail = getExecutionRailForAsset(asset)
      if (executionRail !== 'routed_treasury' && executionRail !== 'sui_treasury' && executionRail !== 'ton_treasury' && executionRail !== 'near_intents') {
        liveAsset = await assertQuoteStillMatchesLiveMarket(asset, action, quote.unitRate)
      }
    } catch (error) {
      logCrypto('execute.revalidation-error', {
        action,
        pairId: asset.id,
        amount: quotedAmount,
        quoteId,
        error: error instanceof Error ? error.message : 'Live market revalidation failed.',
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Live market revalidation failed.',
        success: false,
      }, { status: 400 })
    }
    try {
      const executionRail = getExecutionRailForAsset(asset)
      if (executionRail === 'routed_treasury') {
        await assertLifiTreasuryCanExecuteBuy({ amountNgn: quotedAmount })
      } else if (executionRail === 'sui_treasury') {
        await assertSuiTreasuryCanExecuteBuy({ amountNgn: quotedAmount })
      } else if (executionRail === 'ton_treasury') {
        await assertTonTreasuryCanExecuteBuy({ amountNgn: quotedAmount })
      } else {
        await assertTreasuryCanExecuteBuy({
          asset,
          pairId: asset.id,
          amountNgn: quotedAmount,
          cryptoAmount,
          walletAddress,
        })
      }
    } catch (error) {
      logCrypto('execute.treasury-error', {
        action,
        pairId: asset.id,
        amount: quotedAmount,
        executionRail: getExecutionRailForAsset(asset),
        walletAddress,
        error: error instanceof Error ? error.message : 'Treasury cannot fulfill this order right now.',
      })
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Treasury cannot fulfill this order right now.',
        success: false,
      }, { status: 400 })
    }

    transaction = {
      id: ref,
      type: 'crypto_buy' as const,
      status: 'pending' as const,
      amount: -quotedAmount,
      fee,
      description: `Buy ${formatCrypto(cryptoAmount, liveAsset.symbol)}`,
      reference: ref,
      createdAt: new Date().toISOString(),
      icon: '₿',
      metadata: {
        pairId: liveAsset.id,
        symbol: liveAsset.symbol,
        network: liveAsset.network,
        quoteId: quote.id,
        quoteExpiresAt: quote.expiresAt,
        settlementFlow: 'release_locked',
        settlementKind: 'treasury_buy',
        walletAsset: 'NGN',
        executionRail: getExecutionRailForAsset(liveAsset),
        executionChain: liveAsset.network,
        executionStatus: 'awaiting_swap',
        walletAddress,
        cryptoAmount,
        unitRate: quote.unitRate,
        liveRate: liveAsset.buyRate,
      },
    }
  } else {
    const receiveMethod = body.receiveMethod === 'wallet' ? 'wallet' : 'exchange'
    const netCredit = quotedAmount - fee
    if (netCredit <= 0) {
      return NextResponse.json({ error: 'Amount is too small after fees', success: false }, { status: 400 })
    }
    try {
      liveAsset = await assertQuoteStillMatchesLiveMarket(asset, action, quote.unitRate)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Live market revalidation failed.',
        success: false,
      }, { status: 400 })
    }

    transaction = {
      id: ref,
      type: 'crypto_sell' as const,
      status: 'pending' as const,
      amount: netCredit,
      fee,
      description: `Sell ${formatCrypto(cryptoAmount, liveAsset.symbol)}`,
      reference: ref,
      createdAt: new Date().toISOString(),
      icon: '₿',
      metadata: {
        pairId: liveAsset.id,
        symbol: liveAsset.symbol,
        network: liveAsset.network,
        quoteId: quote.id,
        quoteExpiresAt: quote.expiresAt,
        settlementFlow: 'credit_on_success',
        settlementKind: 'crypto_sell_order',
        walletAsset: 'NGN',
        receiveMethod,
        exchange: typeof body.exchange === 'string' ? body.exchange : undefined,
        walletAddress: typeof body.walletAddress === 'string' ? body.walletAddress : undefined,
        cryptoAmount,
        unitRate: quote.unitRate,
        liveRate: liveAsset.sellRate,
      },
    }
  }

  const result = await applyWalletMutation({
    userId: user.id,
    asset: 'NGN',
    balanceDelta: action === 'buy' ? -quotedAmount : 0,
    lockedBalanceDelta: action === 'buy' ? quotedAmount : 0,
    minimumAvailableBalance: action === 'buy' ? quotedAmount : undefined,
    transaction,
  })
  const cryptoOrder = await createCryptoOrder({
    userId: user.id,
    transactionId: result.transaction.id,
    quoteId: quote.id,
    pairId: liveAsset.id,
    side: action,
    amountNgn: quotedAmount,
    cryptoAmount,
    unitRate: quote.unitRate,
    destinationType: action === 'buy' || body.receiveMethod === 'wallet' ? 'wallet' : 'exchange',
    destinationLabel: action === 'buy'
      ? `${liveAsset.symbol} wallet on ${liveAsset.network}`
      : body.receiveMethod === 'wallet'
        ? `${liveAsset.symbol} wallet on ${liveAsset.network}`
        : typeof body.exchange === 'string'
          ? body.exchange
          : 'Exchange',
    walletAddress: typeof body.walletAddress === 'string' ? body.walletAddress.trim() : undefined,
    exchange: typeof body.exchange === 'string' ? body.exchange : undefined,
    provider: action === 'buy'
      ? getExecutionRailForAsset(liveAsset) === 'routed_treasury'
        ? 'lifi'
        : getExecutionRailForAsset(liveAsset) === 'sui_treasury'
          ? 'lifi'
        : getExecutionRailForAsset(liveAsset) === 'near_intents'
          ? 'near_intents'
        : getExecutionRailForAsset(liveAsset) === 'ton_treasury'
          ? 'ston'
          : undefined
      : undefined,
    providerStatus: action === 'buy' && (getExecutionRailForAsset(liveAsset) === 'routed_treasury' || getExecutionRailForAsset(liveAsset) === 'sui_treasury' || getExecutionRailForAsset(liveAsset) === 'near_intents' || getExecutionRailForAsset(liveAsset) === 'ton_treasury') ? 'QUOTE_LOCKED' : undefined,
    providerPayload: action === 'buy' && (getExecutionRailForAsset(liveAsset) === 'routed_treasury' || getExecutionRailForAsset(liveAsset) === 'sui_treasury' || getExecutionRailForAsset(liveAsset) === 'near_intents' || getExecutionRailForAsset(liveAsset) === 'ton_treasury') ? quote.providerPayload : undefined,
    status: 'pending',
    executionRail: action === 'buy' ? getExecutionRailForAsset(liveAsset) ?? undefined : undefined,
    executionStatus: action === 'buy' ? 'awaiting_swap' : undefined,
    executionReference: action === 'buy' ? `swap_${ref}` : undefined,
  })
  logCrypto('execute.order-created', {
    action,
    pairId: liveAsset.id,
    orderId: cryptoOrder.id,
    transactionId: result.transaction.id,
    amount: quotedAmount,
    cryptoAmount,
    executionRail: cryptoOrder.executionRail,
  })
  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: action === 'buy' ? 'Crypto buy pending' : 'Crypto sale pending',
    message:
      action === 'buy'
        ? `${formatCrypto(cryptoAmount, liveAsset.symbol)} buy order is pending fulfillment on ${liveAsset.network}.`
        : `${formatCrypto(cryptoAmount, liveAsset.symbol)} sell order is pending confirmation on ${liveAsset.network}. NGN is credited after fulfillment.`,
    type: 'info',
  }))

  let finalOrder = cryptoOrder
  let finalTransaction = result.transaction
  let finalWallet = result.wallet

  if (action === 'buy') {
    try {
      const execution = await triggerCryptoOrderExecution({
        order: cryptoOrder,
        actorUserId: user.id,
        source: 'auto',
      })
      finalOrder = execution.order ?? cryptoOrder
      logCrypto('execute.broadcasted', {
        action,
        pairId: liveAsset.id,
        orderId: cryptoOrder.id,
        executionRail: cryptoOrder.executionRail,
        executionStatus: finalOrder.executionStatus,
      })
    } catch (error) {
      logCrypto('execute.broadcast-error', {
        action,
        pairId: liveAsset.id,
        orderId: cryptoOrder.id,
        executionRail: cryptoOrder.executionRail,
        error: error instanceof Error ? error.message : 'Automatic crypto execution failed.',
      })
      const latestOrder = await getCryptoOrderById(cryptoOrder.id)
      const safeToFail = latestOrder?.status === 'pending' && latestOrder.executionStatus !== 'broadcasted'

      if (latestOrder && safeToFail) {
        const failed = await settleCryptoOrderTerminalState({
          order: latestOrder,
          outcome: 'failed',
          actorUserId: user.id,
          source: 'auto_execution',
          metadata: {
            reason: error instanceof Error ? error.message : 'Automatic crypto execution failed.',
          },
        })
        finalOrder = failed.order ?? latestOrder
        finalTransaction = failed.transaction
        finalWallet = failed.wallet
      } else if (latestOrder) {
        finalOrder = latestOrder
      }
    }
  }

  logCrypto('execute.success', {
    action,
    pairId: liveAsset.id,
    orderId: finalOrder.id,
    transactionId: finalTransaction.id,
    status: finalOrder.status,
    executionStatus: finalOrder.executionStatus,
  })
  return NextResponse.json({
    data: { asset: liveAsset, quote, cryptoOrder: finalOrder, transaction: finalTransaction, wallet: finalWallet },
    success: true,
  })
}
