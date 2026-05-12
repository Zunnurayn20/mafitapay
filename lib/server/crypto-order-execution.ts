import { insertAuditLog, updateCryptoOrderExecution, updateCryptoOrderProviderState } from '@/lib/server/data'
import { getRoutedTreasuryPairConfig, type RoutedTreasuryPairId } from '@/lib/routed-assets'
import { broadcastBaseDeliveryForOrder, broadcastBaseTransaction, ensureBaseTokenAllowance, getBaseExecutorConfig } from '@/lib/server/base-executor'
import { kickBaseReceiptAutoSync, scheduleBaseReceiptAutoSync } from '@/lib/server/base-receipt-sync'
import { broadcastBscDeliveryForOrder } from '@/lib/server/bsc-executor'
import { kickBscReceiptAutoSync, scheduleBscReceiptAutoSync } from '@/lib/server/bsc-receipt-sync'
import { getLifiQuoteForOrder, prepareLifiBaseApproval } from '@/lib/server/lifi'
import { submitNearIntentsDepositForOrder } from '@/lib/server/near-intents'
import { kickNearReceiptAutoSync, scheduleNearReceiptAutoSync } from '@/lib/server/near-receipt-sync'
import { kickRoutedReceiptAutoSync, scheduleRoutedReceiptAutoSync } from '@/lib/server/routed-receipt-sync'
import { kickSuiReceiptAutoSync, scheduleSuiReceiptAutoSync } from '@/lib/server/sui-receipt-sync'
import { submitSuiTreasuryBridgeForOrder } from '@/lib/server/sui-treasury'
import { buildTonSwapExecutionForOrder } from '@/lib/server/ton-executor'
import { kickTonReceiptAutoSync, scheduleTonReceiptAutoSync } from '@/lib/server/ton-receipt-sync'
import { getZeroExBaseQuoteForOrder } from '@/lib/server/zerox'
import type { CryptoOrder } from '@/types'

type ExecutionSource = 'admin' | 'auto'
type ExecutionMode = 'delivery' | 'zerox_swap' | 'lifi_route' | 'sui_swap' | 'ton_swap' | 'near_swap'

function resolveExecutionMode(order: CryptoOrder): ExecutionMode {
  if (order.executionRail === 'routed_treasury') return 'lifi_route'
  if (order.executionRail === 'sui_treasury') return 'sui_swap'
  if (order.executionRail === 'near_intents') return 'near_swap'
  if (order.executionRail === 'ton_treasury') return 'ton_swap'
  if (order.pairId === 'ETH_BASE') return 'zerox_swap'
  return 'delivery'
}

function resolveMinimumApprovalAmountFromOrder(order: CryptoOrder) {
  const units = order.providerPayload && typeof order.providerPayload.treasuryUsdcUnits === 'string'
    ? order.providerPayload.treasuryUsdcUnits
    : null
  return units ? BigInt(units) : undefined
}

export async function triggerCryptoOrderExecution(input: {
  order: CryptoOrder
  actorUserId: string
  source: ExecutionSource
}) {
  const { order, actorUserId, source } = input

  if (order.executionRail !== 'base_legacy' && order.executionRail !== 'base_treasury' && order.executionRail !== 'bsc_treasury' && order.executionRail !== 'routed_treasury' && order.executionRail !== 'sui_treasury' && order.executionRail !== 'ton_treasury' && order.executionRail !== 'near_intents') {
    throw new Error('Only supported treasury execution orders can be executed through this flow.')
  }
  if (order.executionStatus === 'broadcasted' || order.executionStatus === 'settled') {
    throw new Error(`Order execution is already ${order.executionStatus}.`)
  }
  if (order.status !== 'pending') {
    throw new Error(`Crypto order is already ${order.status}.`)
  }

  const mode = resolveExecutionMode(order)
  let execution

  if (mode === 'zerox_swap') {
    const quote = await getZeroExBaseQuoteForOrder(order)
    const baseConfig = getBaseExecutorConfig()
    const allowanceSpender = quote.issues?.allowance?.spender || quote.allowanceTarget
    if (allowanceSpender) {
      await ensureBaseTokenAllowance({
        token: baseConfig.usdcAddress,
        spender: allowanceSpender,
        minimumAmount: BigInt(quote.sellAmount ?? '0'),
      })
    }
    execution = await broadcastBaseTransaction({
      to: quote.transaction!.to,
      data: quote.transaction!.data,
      value: quote.transaction!.value,
    })

    await updateCryptoOrderProviderState({
      id: order.id,
      provider: '0x',
      providerReference: quote.zid ?? null,
      providerStatus: 'BROADCASTED',
      providerPayload: {
        pairId: order.pairId,
        allowanceTarget: quote.allowanceTarget,
        buyAmount: quote.buyAmount,
        minBuyAmount: quote.minBuyAmount,
        buyToken: quote.buyToken,
        sellAmount: quote.sellAmount,
        sellToken: quote.sellToken,
        swapTxHash: execution.hash,
        route: quote.route,
        transaction: {
          to: quote.transaction?.to,
          value: quote.transaction?.value,
        },
      },
    })
  } else if (mode === 'lifi_route') {
    const storedPayload = order.provider === 'lifi' ? (order.providerPayload ?? {}) : {}
    const storedTransactionRequest =
      storedPayload.transactionRequest && typeof storedPayload.transactionRequest === 'object'
        ? storedPayload.transactionRequest as { to?: string; data?: string; value?: string }
        : null
    const storedApprovalAddress = typeof storedPayload.approvalAddress === 'string' ? storedPayload.approvalAddress : null
    let pair
    let quote
    let treasuryUsdcAmount
    let treasuryUsdcUnits
    let transactionRequest = storedTransactionRequest

    if (!transactionRequest?.to || !transactionRequest.data) {
      const fresh = await getLifiQuoteForOrder(order)
      pair = fresh.pair
      quote = fresh.quote
      treasuryUsdcAmount = fresh.treasuryUsdcAmount
      treasuryUsdcUnits = fresh.treasuryUsdcUnits
      transactionRequest = quote.transactionRequest ?? null
      if (!transactionRequest?.to || !transactionRequest.data) {
        throw new Error('LI.FI quote is missing executable transaction data.')
      }
      if (quote.estimate?.approvalAddress) {
        await prepareLifiBaseApproval({
          quote,
          minimumAmount: treasuryUsdcUnits ? BigInt(treasuryUsdcUnits) : undefined,
        })
      }
    } else {
      const routedConfig = getRoutedTreasuryPairConfig(order.pairId as RoutedTreasuryPairId)
      pair = {
        ...routedConfig,
        toChain: typeof storedPayload.toChain === 'string' || typeof storedPayload.toChain === 'number' ? String(storedPayload.toChain) : routedConfig.toChain,
        toToken: typeof storedPayload.toToken === 'string' ? storedPayload.toToken : routedConfig.toToken,
      }
      quote = {
        transactionId: typeof storedPayload.transactionId === 'string' ? storedPayload.transactionId : undefined,
        tool: typeof storedPayload.bridge === 'string' ? storedPayload.bridge : undefined,
        transactionRequest,
        includedSteps: Array.isArray(storedPayload.includedSteps) ? storedPayload.includedSteps as Array<{ id?: string; type?: string; tool?: string }> : undefined,
        estimate: {
          approvalAddress: storedApprovalAddress ?? undefined,
          toAmount: typeof storedPayload.toAmount === 'string' ? storedPayload.toAmount : undefined,
          toAmountMin: typeof storedPayload.toAmountMin === 'string' ? storedPayload.toAmountMin : undefined,
        },
      }
      treasuryUsdcAmount = typeof storedPayload.treasuryUsdcAmount === 'number' ? storedPayload.treasuryUsdcAmount : order.amountNgn
      treasuryUsdcUnits = typeof storedPayload.treasuryUsdcUnits === 'string' ? storedPayload.treasuryUsdcUnits : ''
      if (storedApprovalAddress) {
        await prepareLifiBaseApproval({
          quote,
          minimumAmount: resolveMinimumApprovalAmountFromOrder(order),
        })
      }
    }

    execution = await broadcastBaseTransaction({
      to: transactionRequest.to,
      data: transactionRequest.data,
      value: transactionRequest.value,
    })

    await updateCryptoOrderProviderState({
      id: order.id,
      provider: 'lifi',
      providerOrderId: quote.transactionId ?? null,
      providerReference: quote.tool ?? null,
      providerStatus: 'ROUTE_BROADCASTED',
      providerPayload: {
        pairId: order.pairId,
        bridge: quote.tool,
        sendingTxHash: execution.hash,
        toChain: pair.toChain,
        toToken: pair.toToken,
        treasuryUsdcAmount,
        treasuryUsdcUnits,
        quotedCryptoAmount: order.cryptoAmount,
        toAmount: quote.estimate?.toAmount,
        toAmountMin: quote.estimate?.toAmountMin,
        transactionId: quote.transactionId,
        explorerLink: quote.transactionId ? `https://explorer.li.fi/tx/${quote.transactionId}` : null,
        includedSteps: quote.includedSteps,
      },
    })
  } else if (mode === 'sui_swap') {
    const suiExecution = await submitSuiTreasuryBridgeForOrder(order)
    execution = {
      hash: suiExecution.hash,
    }

    await updateCryptoOrderProviderState({
      id: order.id,
      provider: 'lifi',
      providerOrderId: typeof suiExecution.providerPayload.quotedBridgeTransactionId === 'string' ? suiExecution.providerPayload.quotedBridgeTransactionId : null,
      providerReference: typeof suiExecution.providerPayload.bridge === 'string' ? suiExecution.providerPayload.bridge : null,
      providerStatus: 'ROUTE_BROADCASTED',
      providerPayload: suiExecution.providerPayload,
    })
  } else if (mode === 'ton_swap') {
    const tonExecution = await buildTonSwapExecutionForOrder(order)
    execution = {
      hash: typeof tonExecution.providerPayload.externalMessageHash === 'string' && tonExecution.providerPayload.externalMessageHash
        ? tonExecution.providerPayload.externalMessageHash
        : `ton_query_${tonExecution.queryId}`,
    }

    await updateCryptoOrderProviderState({
      id: order.id,
      provider: 'ston',
      providerReference: tonExecution.routerAddress,
      providerStatus: 'SWAP_SUBMITTED',
      providerPayload: tonExecution.providerPayload,
    })
  } else if (mode === 'near_swap') {
    const nearExecution = await submitNearIntentsDepositForOrder(order)
    execution = {
      hash: nearExecution.hash,
    }

    await updateCryptoOrderProviderState({
      id: order.id,
      provider: 'near_intents',
      providerOrderId: typeof nearExecution.providerPayload.correlationId === 'string' ? nearExecution.providerPayload.correlationId : null,
      providerReference: typeof nearExecution.providerPayload.depositAddress === 'string' ? nearExecution.providerPayload.depositAddress : null,
      providerStatus: 'KNOWN_DEPOSIT_TX',
      providerPayload: nearExecution.providerPayload,
    })
  } else if (order.executionRail === 'bsc_treasury') {
    execution = await broadcastBscDeliveryForOrder(order)
  } else {
    execution = await broadcastBaseDeliveryForOrder(order)
  }

  const updated = await updateCryptoOrderExecution({
    id: order.id,
    executionRail: order.executionRail ?? 'base_treasury',
    executionStatus: 'broadcasted',
    executionReference: order.executionReference ?? `base_exec_${order.id}`,
    destinationTxHash: mode === 'zerox_swap' || mode === 'lifi_route' || mode === 'sui_swap' || mode === 'ton_swap' || mode === 'near_swap' ? null : execution.hash,
  })

  await insertAuditLog({
    userId: order.userId,
    actorUserId,
    action: `crypto_order.execution.broadcasted.${mode}.${source}`,
    entityType: 'crypto_order',
    entityId: order.id,
    metadata: {
      pairId: order.pairId,
      side: order.side,
      mode,
      txHash: execution.hash,
      walletAddress: order.walletAddress,
    },
  })

  if (order.executionRail === 'bsc_treasury') {
    scheduleBscReceiptAutoSync(order.id, actorUserId)
    await kickBscReceiptAutoSync()
  } else if (order.executionRail === 'routed_treasury') {
    scheduleRoutedReceiptAutoSync(order.id, actorUserId)
    await kickRoutedReceiptAutoSync()
  } else if (order.executionRail === 'sui_treasury') {
    scheduleSuiReceiptAutoSync(order.id, actorUserId)
    await kickSuiReceiptAutoSync()
  } else if (order.executionRail === 'near_intents') {
    scheduleNearReceiptAutoSync(order.id, actorUserId)
    await kickNearReceiptAutoSync()
  } else if (order.executionRail === 'ton_treasury') {
    scheduleTonReceiptAutoSync(order.id, actorUserId)
    await kickTonReceiptAutoSync()
  } else {
    scheduleBaseReceiptAutoSync(order.id, actorUserId)
    await kickBaseReceiptAutoSync()
  }

  return {
    order: updated,
    execution,
    mode,
  }
}
