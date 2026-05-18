import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { getBillServiceConfig, getDetectedNetworkProviderName, isValidNigerianPhoneNumber, normalizeNigerianPhoneNumber } from '@/lib/bill-config'
import { applyWalletMutation, ensureCryptoMarketAutoRefreshScheduler, getBillProviders, getNetworkProviders, getWalletByUserId, kickCryptoMarketRefresh, recordProviderEvent, verifySensitiveActionAuthorization } from '@/lib/server/data'
import { AMIGO_PLATFORM_MARKUP_NGN, createAmigoDataPayment, isAmigoBillsEnabled, listAmigoDataBundleNetworkProvidersSafe } from '@/lib/server/amigo-bills'
import { createFlutterwaveBillPayment, isFlutterwaveBillsEnabled, isFlutterwaveBillTypeSupported, listFlutterwaveCableBillProvidersSafe, listFlutterwaveDataBundleNetworkProviders, listFlutterwaveElectricBillProvidersSafe } from '@/lib/server/flutterwave-bills'
import { ensureFlutterwaveBillSyncScheduler, kickPendingFlutterwaveBillSync } from '@/lib/server/flutterwave-bill-sync-batch'
import { generateRef } from '@/lib/utils'
import type { Transaction } from '@/types'

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

  const hydratedProviders = providers
    .map(item => ({
      ...item,
      isActive:
        item.isActive !== false
        && isFlutterwaveBillsEnabled()
        && isFlutterwaveBillTypeSupported(item.type)
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
  const billerCode = typeof body.billerCode === 'string' ? body.billerCode.trim() : undefined
  const itemCode = typeof body.itemCode === 'string' ? body.itemCode.trim() : undefined
  const providerPlanId = typeof body.providerPlanId === 'string' ? body.providerPlanId.trim() : undefined
  const providerNetworkId = Number(body.providerNetworkId)
  const rawAccount = typeof body.account === 'string' ? body.account.trim() : ''
  const providers = await getBillProviders()
  const selectedProvider = providers.find(item => item.name === service || item.id === service)

  if (!selectedProvider) {
    return NextResponse.json({ error: 'Unsupported bill service', success: false }, { status: 400 })
  }
  if (selectedProvider.isActive === false) {
    return NextResponse.json({ error: `${selectedProvider.name} is temporarily unavailable.`, success: false }, { status: 400 })
  }
  if (!isFlutterwaveBillsEnabled()) {
    return NextResponse.json({ error: 'Bills provider is not configured yet.', success: false }, { status: 503 })
  }
  if (!isFlutterwaveBillTypeSupported(selectedProvider.type)) {
    return NextResponse.json({ error: `${selectedProvider.name} is not live yet.`, success: false }, { status: 400 })
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

  const wallet = await getWalletByUserId(user.id)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found', success: false }, { status: 404 })
  }

  if (wallet.balance < numericAmount) {
    return NextResponse.json({ error: 'Insufficient balance', success: false }, { status: 400 })
  }

  try {
    await verifySensitiveActionAuthorization(user.id, { transactionPin, biometricApprovalToken })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Security approval failed.', success: false }, { status: 400 })
  }

  const ref = generateRef()
  const providerResult = selectedProvider.type === 'data' && isAmigoBillsEnabled() && providerPlanId && Number.isFinite(providerNetworkId)
    ? await createAmigoDataPayment({
      networkId: providerNetworkId,
      mobileNumber: account,
      planId: providerPlanId,
      reference: ref,
    })
    : await createFlutterwaveBillPayment({
      type: selectedProvider.type,
      networkProvider: provider,
      account,
      amount: numericAmount,
      reference: ref,
      billerCode,
      itemCode,
    })

  if (providerResult.status === 'failed') {
    await recordProviderEvent({
      externalEventId: providerResult.providerReference || `bill:${ref}:failed`,
      provider: providerResult.provider === 'amigo' ? 'amigo_data' : 'flutterwave_bills',
      reference: ref,
      status: providerResult.rawStatus || 'FAILED',
      failureReason: providerResult.reason,
      payload: providerResult.payload,
    })

    return NextResponse.json({ error: providerResult.reason || 'Bill payment failed.', success: false }, { status: 400 })
  }

  const transactionType = selectedProvider.type as Transaction['type']
  const transactionStatus: Transaction['status'] = providerResult.status === 'success' ? 'success' : 'pending'
  const platformFee = providerResult.provider === 'amigo' ? AMIGO_PLATFORM_MARKUP_NGN : 0
  const transaction = {
    id: ref,
    type: transactionType,
    status: transactionStatus,
    amount: -numericAmount,
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
      amount: numericAmount,
      providerName: providerResult.provider,
      providerReference: providerResult.providerReference,
      providerStatus: providerResult.rawStatus,
      billerCode: 'billerCode' in providerResult ? providerResult.billerCode : undefined,
      itemCode: 'itemCode' in providerResult ? providerResult.itemCode : undefined,
      itemName: 'itemName' in providerResult ? providerResult.itemName : undefined,
      providerPlanId: providerResult.provider === 'amigo' ? providerPlanId : undefined,
      providerNetworkId: providerResult.provider === 'amigo' && Number.isFinite(providerNetworkId) ? providerNetworkId : undefined,
      providerBaseAmount: providerResult.provider === 'amigo' ? numericAmount - platformFee : numericAmount,
      platformFee,
      settlementFlow: providerResult.status === 'pending' ? 'release_locked' : 'none',
      settlementKind: 'provider_bill',
      walletAsset: 'NGN',
    },
  }

  const result = await applyWalletMutation({
    userId: user.id,
    balanceDelta: -numericAmount,
    lockedBalanceDelta: providerResult.status === 'pending' ? numericAmount : 0,
    minimumAvailableBalance: numericAmount,
    transaction,
  })
  await recordProviderEvent({
    externalEventId: providerResult.providerReference || `bill:${ref}:${providerResult.rawStatus || providerResult.status}`,
    provider: providerResult.provider === 'amigo' ? 'amigo_data' : 'flutterwave_bills',
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
