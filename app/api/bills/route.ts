import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { getBillServiceConfig, getDetectedNetworkProviderName, isValidNigerianPhoneNumber, normalizeNigerianPhoneNumber } from '@/lib/bill-config'
import { applyWalletMutation, ensureCryptoMarketAutoRefreshScheduler, getBillProviders, getNetworkProviders, getWalletByUserId, kickCryptoMarketRefresh, recordProviderEvent, verifySensitiveActionAuthorization } from '@/lib/server/data'
import { createAmigoDataPayment, getAmigoPlanForPurchase, isAmigoBillsEnabled, listAmigoDataBundleNetworkProvidersSafe } from '@/lib/server/amigo-bills'
import { createAsbdataAirtimePayment, createAsbdataDataPayment, getAsbdataNetworkId, getAsbdataPlanForPurchase, isAsbdataBillsEnabled, listAsbdataDataBundleNetworkProvidersSafe } from '@/lib/server/asbdata-bills'
import { createBardetechAirtimePayment, createBardetechDataPayment, getBardetechNetworkId, getBardetechPlanForPurchase, isBardetechBillsEnabled, listBardetechDataBundleNetworkProvidersSafe } from '@/lib/server/bardetech-bills'
import { createFlutterwaveBillPayment, isFlutterwaveBillsEnabled, isFlutterwaveBillTypeSupported, listFlutterwaveCableBillProvidersSafe, listFlutterwaveDataBundleNetworkProviders, listFlutterwaveElectricBillProvidersSafe } from '@/lib/server/flutterwave-bills'
import { ensureFlutterwaveBillSyncScheduler, kickPendingFlutterwaveBillSync } from '@/lib/server/flutterwave-bill-sync-batch'
import { generateRef } from '@/lib/utils'
import type { BillProvider, Transaction } from '@/types'

/**
 * Whether any configured provider can serve a bill type.
 *
 * Flutterwave covers everything it supports, but data and airtime can also be served by ASBDATA
 * or Amigo alone -- so this must not collapse back to a Flutterwave-only check, or those two
 * categories go dark whenever Flutterwave is unconfigured.
 */
function hasProviderForBillType(type: BillProvider['type']) {
  if (isFlutterwaveBillsEnabled() && isFlutterwaveBillTypeSupported(type)) return true
  if (type === 'data') return isAsbdataBillsEnabled() || isAmigoBillsEnabled() || isBardetechBillsEnabled()
  if (type === 'airtime') return isAsbdataBillsEnabled() || isBardetechBillsEnabled()
  return false
}

export async function GET(req: Request) {
  ensureFlutterwaveBillSyncScheduler()
  const user = await requireUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const forceRefresh = url.searchParams.get('refresh') === '1'
  const [baseProviders, baseNetworkProviders] = await Promise.all([
    getBillProviders(),
    getNetworkProviders(),
  ])
  let providers = baseProviders
  let networkProviders = baseNetworkProviders
  if (isFlutterwaveBillsEnabled()) {
    const [nextNetworkProviders, cableProviders, electricProviders] = await Promise.all([
      listFlutterwaveDataBundleNetworkProviders(networkProviders, { forceRefresh }),
      listFlutterwaveCableBillProvidersSafe(providers, { forceRefresh }),
      listFlutterwaveElectricBillProvidersSafe(providers, { forceRefresh }),
    ])
    networkProviders = nextNetworkProviders

    const cableById = new Map(cableProviders.map(provider => [provider.id, provider] as const))
    const electricById = new Map(electricProviders.map(provider => [provider.id, provider] as const))
    providers = providers.map(provider => {
      if (provider.type === 'cable') return cableById.get(provider.id) ?? provider
      if (provider.type === 'electric') return electricById.get(provider.id) ?? provider
      return provider
    })
  }
  if (isAmigoBillsEnabled()) {
    networkProviders = await listAmigoDataBundleNetworkProvidersSafe(networkProviders, { forceRefresh })
  }
  if (isAsbdataBillsEnabled()) {
    networkProviders = await listAsbdataDataBundleNetworkProvidersSafe(networkProviders, { forceRefresh })
  }
  if (isBardetechBillsEnabled()) {
    networkProviders = await listBardetechDataBundleNetworkProvidersSafe(networkProviders, { forceRefresh })
  }

  const hydratedProviders = providers
    .map(item => ({
      ...item,
      isActive:
        item.isActive !== false
        && hasProviderForBillType(item.type)
        && (
          (item.type !== 'cable' && item.type !== 'electric')
          || (Array.isArray(item.billers) && item.billers.length > 0)
        ),
    }))

  return NextResponse.json({ data: { providers: hydratedProviders, networkProviders }, success: true })
}

export async function POST(req: Request) {
  ensureCryptoMarketAutoRefreshScheduler()
  void kickCryptoMarketRefresh()
  ensureFlutterwaveBillSyncScheduler()
  void kickPendingFlutterwaveBillSync()
  const body = await req.json()
  const user = await requireUser()
  if (!user) return unauthorized()

  const numericAmount = Number(body.amount)
  const service = typeof body.service === 'string' ? body.service : ''
  const provider = typeof body.provider === 'string' ? body.provider : undefined
  const transactionPin = typeof body.transactionPin === 'string' ? body.transactionPin.trim() : ''
  const biometricApprovalToken = typeof body.biometricApprovalToken === 'string' ? body.biometricApprovalToken.trim() : ''
  const confirmWithBiometric = body.confirmWithBiometric === true
  const billerCode = typeof body.billerCode === 'string' ? body.billerCode.trim() : undefined
  const itemCode = typeof body.itemCode === 'string' ? body.itemCode.trim() : undefined
  const providerPlanId = typeof body.providerPlanId === 'string' ? body.providerPlanId.trim() : undefined
  const providerNetworkId = Number(body.providerNetworkId)
  // Which provider issued the selected bundle. Amigo and ASBDATA both send a plan id plus a
  // network id and their network ids disagree, so the fields alone cannot identify the provider.
  // Older app builds omit this; fall back to the previous inference in that case.
  const providerName = typeof body.providerName === 'string' ? body.providerName.trim() : undefined
  const rawAccount = typeof body.account === 'string' ? body.account.trim() : ''
  const providers = await getBillProviders()
  const selectedProvider = providers.find(item => item.name === service || item.id === service)

  if (!selectedProvider) {
    return NextResponse.json({ error: 'Unsupported bill service', success: false }, { status: 400 })
  }
  if (selectedProvider.isActive === false) {
    return NextResponse.json({ error: `${selectedProvider.name} is temporarily unavailable.`, success: false }, { status: 400 })
  }
  if (!hasProviderForBillType(selectedProvider.type)) {
    return NextResponse.json({ error: `${selectedProvider.name} is not live yet.`, success: false }, { status: 503 })
  }

  const serviceConfig = getBillServiceConfig(selectedProvider)
  if (!serviceConfig) {
    return NextResponse.json({ error: 'Bill service is not configured correctly.', success: false }, { status: 400 })
  }

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return NextResponse.json({ error: 'Invalid amount', success: false }, { status: 400 })
  }

  if (numericAmount < serviceConfig.minAmount) {
    return NextResponse.json({ error: `Minimum amount for ${serviceConfig.displayName} is ₦${serviceConfig.minAmount.toLocaleString('en-NG')}.`, success: false }, { status: 400 })
  }

  if (numericAmount > serviceConfig.maxAmount) {
    return NextResponse.json({ error: `Maximum amount for ${serviceConfig.displayName} is ₦${serviceConfig.maxAmount.toLocaleString('en-NG')}.`, success: false }, { status: 400 })
  }

  if (serviceConfig.requiresNetwork) {
    const networkProviders = await getNetworkProviders()
    const networkMatch = networkProviders.find(item => item.name === provider)
    if (!networkMatch) {
      return NextResponse.json({ error: `Select a valid network provider for ${serviceConfig.displayName}.`, success: false }, { status: 400 })
    }

    if (selectedProvider.type === 'airtime' || selectedProvider.type === 'data') {
      const normalizedPhoneNumber = normalizeNigerianPhoneNumber(rawAccount)
      if (!isValidNigerianPhoneNumber(normalizedPhoneNumber)) {
        return NextResponse.json({ error: 'Enter a valid Nigerian phone number.', success: false }, { status: 400 })
      }

      const detectedProviderName = getDetectedNetworkProviderName(normalizedPhoneNumber, networkProviders)
      if (detectedProviderName && provider !== detectedProviderName) {
        return NextResponse.json({ error: `This phone number matches ${detectedProviderName}.`, success: false }, { status: 400 })
      }
    }
  }

  const account = selectedProvider.type === 'airtime' || selectedProvider.type === 'data'
    ? normalizeNigerianPhoneNumber(rawAccount)
    : rawAccount

  if (serviceConfig.requiresAccount && !account) {
    return NextResponse.json({ error: `${serviceConfig.accountLabel} is required.`, success: false }, { status: 400 })
  }

  if ((selectedProvider.type === 'airtime' || selectedProvider.type === 'data') && !isValidNigerianPhoneNumber(account)) {
    return NextResponse.json({ error: 'Enter a valid phone number.', success: false }, { status: 400 })
  }

  // Which provider owns this purchase. Prefer the name the client sent; fall back to the old
  // inference (plan id + network id implied Amigo) so app builds predating providerName still work.
  const hasPlanSelection = Boolean(providerPlanId) && Number.isFinite(providerNetworkId)
  const resolvedDataProvider = selectedProvider.type !== 'data' || !hasPlanSelection
    ? null
    : providerName === 'asbdata' || providerName === 'amigo' || providerName === 'flutterwave' || providerName === 'bardetech'
      ? providerName
      : 'amigo'

  // Server-authoritative price for plan-based data. Client amount is only used to detect that
  // the catalog moved under the user mid-checkout — never to decide what we charge.
  let chargeAmount = numericAmount
  let platformFee = 0
  let providerBaseAmount = numericAmount
  let pricingRuleId: string | null = null

  if (
    resolvedDataProvider === 'asbdata'
    && isAsbdataBillsEnabled()
    && providerPlanId
    && Number.isFinite(providerNetworkId)
  ) {
    const plan = await getAsbdataPlanForPurchase(providerNetworkId, providerPlanId)
    if (!plan) {
      return NextResponse.json({ error: 'This data plan is no longer available.', success: false }, { status: 400 })
    }
    if (Math.abs(numericAmount - plan.retailNgn) > 0.009) {
      return NextResponse.json({
        error: "This plan's price changed. Please review the new price and try again.",
        code: 'PRICE_CHANGED',
        amount: plan.retailNgn,
        success: false,
      }, { status: 409 })
    }
    chargeAmount = plan.retailNgn
    platformFee = plan.marginNgn
    providerBaseAmount = plan.costNgn
    pricingRuleId = plan.ruleId
  } else if (
    resolvedDataProvider === 'amigo'
    && isAmigoBillsEnabled()
    && providerPlanId
    && Number.isFinite(providerNetworkId)
  ) {
    const plan = await getAmigoPlanForPurchase(providerNetworkId, providerPlanId)
    if (!plan) {
      return NextResponse.json({ error: 'This data plan is no longer available.', success: false }, { status: 400 })
    }
    if (Math.abs(numericAmount - plan.retailNgn) > 0.009) {
      return NextResponse.json({
        error: "This plan's price changed. Please review the new price and try again.",
        code: 'PRICE_CHANGED',
        amount: plan.retailNgn,
        success: false,
      }, { status: 409 })
    }
    chargeAmount = plan.retailNgn
    platformFee = plan.marginNgn
    providerBaseAmount = plan.costNgn
    pricingRuleId = plan.ruleId
  } else if (
    resolvedDataProvider === 'bardetech'
    && isBardetechBillsEnabled()
    && providerPlanId
    && Number.isFinite(providerNetworkId)
  ) {
    const plan = await getBardetechPlanForPurchase(providerNetworkId, providerPlanId)
    if (!plan) {
      return NextResponse.json({ error: 'This data plan is no longer available.', success: false }, { status: 400 })
    }
    if (Math.abs(numericAmount - plan.retailNgn) > 0.009) {
      return NextResponse.json({
        error: "This plan's price changed. Please review the new price and try again.",
        code: 'PRICE_CHANGED',
        amount: plan.retailNgn,
        success: false,
      }, { status: 409 })
    }
    chargeAmount = plan.retailNgn
    platformFee = plan.marginNgn
    providerBaseAmount = plan.costNgn
    pricingRuleId = plan.ruleId
  }

  const wallet = await getWalletByUserId(user.id)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found', success: false }, { status: 404 })
  }

  if (wallet.balance < chargeAmount) {
    return NextResponse.json({ error: 'Insufficient balance', success: false }, { status: 400 })
  }

  try {
    await verifySensitiveActionAuthorization(user.id, { transactionPin, biometricApprovalToken, confirmWithBiometric })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Security approval failed.', success: false }, { status: 400 })
  }

  const ref = generateRef()

  const asbdataAirtimeNetworkId = selectedProvider.type === 'airtime' && isAsbdataBillsEnabled()
    ? getAsbdataNetworkId(provider ?? '')
    : undefined

  // Only consulted when ASBDATA cannot serve the topup, so the two never race for the same sale.
  const bardetechAirtimeNetworkId = selectedProvider.type === 'airtime'
    && isBardetechBillsEnabled()
    && asbdataAirtimeNetworkId === undefined
    ? getBardetechNetworkId(provider ?? '')
    : undefined

  const flutterwaveInput = {
    type: selectedProvider.type,
    networkProvider: provider,
    account,
    amount: chargeAmount,
    reference: ref,
    billerCode,
    itemCode,
  }

  const providerStartedAt = Date.now()
  let providerResult = resolvedDataProvider === 'asbdata' && isAsbdataBillsEnabled() && providerPlanId
    ? await createAsbdataDataPayment({
      networkId: providerNetworkId,
      mobileNumber: account,
      planId: providerPlanId,
      reference: ref,
    })
    : resolvedDataProvider === 'bardetech' && isBardetechBillsEnabled() && providerPlanId
      ? await createBardetechDataPayment({
        networkId: providerNetworkId,
        mobileNumber: account,
        planId: providerPlanId,
        reference: ref,
      })
      : resolvedDataProvider === 'amigo' && isAmigoBillsEnabled() && providerPlanId
        ? await createAmigoDataPayment({
          networkId: providerNetworkId,
          mobileNumber: account,
          planId: providerPlanId,
          reference: ref,
        })
        : asbdataAirtimeNetworkId !== undefined
          ? await createAsbdataAirtimePayment({
            networkId: asbdataAirtimeNetworkId,
            mobileNumber: account,
            amount: chargeAmount,
            reference: ref,
          })
          : bardetechAirtimeNetworkId !== undefined
            ? await createBardetechAirtimePayment({
              networkId: bardetechAirtimeNetworkId,
              mobileNumber: account,
              amount: chargeAmount,
              reference: ref,
            })
            : await createFlutterwaveBillPayment(flutterwaveInput)

  // Airtime falls back to Flutterwave when the VTU vendor rejects the request outright. Never retry
  // an indeterminate result -- a topup that actually landed must not be sent a second time.
  if (
    (providerResult.provider === 'asbdata' || providerResult.provider === 'bardetech')
    && providerResult.status === 'failed'
    && !providerResult.indeterminate
    && selectedProvider.type === 'airtime'
    && isFlutterwaveBillsEnabled()
    && isFlutterwaveBillTypeSupported('airtime')
  ) {
    const failedVendor = providerResult.provider
    console.warn(`[${failedVendor}] airtime failed for ref=${ref}, falling back to Flutterwave: ${providerResult.reason ?? 'unknown'}`)
    await recordProviderEvent({
      externalEventId: `bill:${ref}:${failedVendor}-airtime-failed`,
      provider: `${failedVendor}_airtime`,
      reference: ref,
      status: providerResult.rawStatus || 'FAILED',
      failureReason: providerResult.reason,
      payload: providerResult.payload,
    })
    providerResult = await createFlutterwaveBillPayment(flutterwaveInput)
  }

  console.info('[bills] provider.completed', JSON.stringify({
    reference: ref,
    type: selectedProvider.type,
    provider: providerResult.provider,
    status: providerResult.status,
    providerStatus: providerResult.rawStatus ?? null,
    elapsedMs: Date.now() - providerStartedAt,
  }))

  const providerEventName = providerResult.provider === 'asbdata'
    ? (selectedProvider.type === 'airtime' ? 'asbdata_airtime' : 'asbdata_data')
    : providerResult.provider === 'bardetech'
      ? (selectedProvider.type === 'airtime' ? 'bardetech_airtime' : 'bardetech_data')
      : providerResult.provider === 'amigo'
        ? 'amigo_data'
        : 'flutterwave_bills'

  if (providerResult.status === 'failed') {
    await recordProviderEvent({
      externalEventId: providerResult.providerReference || `bill:${ref}:failed`,
      provider: providerEventName,
      reference: ref,
      status: providerResult.rawStatus || 'FAILED',
      failureReason: providerResult.reason,
      payload: providerResult.payload,
    })

    return NextResponse.json({ error: providerResult.reason || 'Bill payment failed.', success: false }, { status: 400 })
  }

  const transactionType = selectedProvider.type as Transaction['type']
  const transactionStatus: Transaction['status'] = providerResult.status === 'success' ? 'success' : 'pending'
  // Plan-based data: platformFee is the margin from pricing rules. Flutterwave / airtime quote
  // retail, so there is nothing to split out unless we priced a plan above.
  const isPlanBasedProvider = providerResult.provider === 'amigo' || (
    (providerResult.provider === 'asbdata' || providerResult.provider === 'bardetech')
    && selectedProvider.type === 'data'
  )
  const transaction = {
    id: ref,
    type: transactionType,
    status: transactionStatus,
    amount: -chargeAmount,
    fee: platformFee,
    description: `${serviceConfig.displayName} Payment`,
    reference: ref,
    createdAt: new Date().toISOString(),
    icon: selectedProvider.icon,
    metadata: {
      serviceId: selectedProvider.id,
      serviceType: selectedProvider.type,
      serviceName: serviceConfig.displayName,
      provider: serviceConfig.requiresNetwork ? provider : undefined,
      account,
      amount: chargeAmount,
      providerName: providerResult.provider,
      providerReference: providerResult.providerReference,
      providerStatus: providerResult.rawStatus,
      billerCode: 'billerCode' in providerResult ? providerResult.billerCode : undefined,
      itemCode: 'itemCode' in providerResult ? providerResult.itemCode : undefined,
      itemName: 'itemName' in providerResult ? providerResult.itemName : undefined,
      providerPlanId: isPlanBasedProvider ? providerPlanId : undefined,
      providerNetworkId: isPlanBasedProvider && Number.isFinite(providerNetworkId) ? providerNetworkId : undefined,
      providerBaseAmount: isPlanBasedProvider ? providerBaseAmount : chargeAmount,
      platformFee,
      pricingRuleId: pricingRuleId || undefined,
      settlementFlow: providerResult.status === 'pending' ? 'release_locked' : 'none',
      settlementKind: 'provider_bill',
      walletAsset: 'NGN',
    },
  }

  const result = await applyWalletMutation({
    userId: user.id,
    balanceDelta: -chargeAmount,
    lockedBalanceDelta: providerResult.status === 'pending' ? chargeAmount : 0,
    minimumAvailableBalance: chargeAmount,
    transaction,
  })
  await recordProviderEvent({
    externalEventId: providerResult.providerReference || `bill:${ref}:${providerResult.rawStatus || providerResult.status}`,
    provider: providerEventName,
    reference: ref,
    status: providerResult.rawStatus || providerResult.status,
    payload: providerResult.payload,
  })
  await appendNotification(user.id, createNotification({
    userId: user.id,
    title: providerResult.status === 'success' ? `${serviceConfig.displayName} payment successful` : `${serviceConfig.displayName} payment submitted`,
    message: providerResult.status === 'success'
      ? `₦${numericAmount.toLocaleString('en-NG')} ${serviceConfig.displayName} payment completed`
      : `₦${numericAmount.toLocaleString('en-NG')} ${serviceConfig.displayName} payment is being processed`,
    type: providerResult.status === 'success' ? 'success' : 'info',
  }))
  void kickPendingFlutterwaveBillSync()

  return NextResponse.json({
    data: {
      transaction: result.transaction,
      wallet: result.wallet,
      providerStatus: providerResult.rawStatus,
    },
    success: true,
  })
}
