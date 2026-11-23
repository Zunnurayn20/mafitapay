import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { getBillServiceConfig, getDetectedNetworkProviderName, isValidNigerianPhoneNumber, normalizeNigerianPhoneNumber } from '@/lib/bill-config'
import { applyWalletMutation, ensureCryptoMarketAutoRefreshScheduler, getAnyTransactionById, getBillProviders, getBillTypeSettings, getDisabledDataPlanCategories, getDisabledDataPlans, getNetworkProviders, getTransactionById, getWalletByUserId, isDataPlanDisabled, kickCryptoMarketRefresh, markProviderEventProcessed, recordProviderEvent, resolvePendingTransaction, updatePendingTransactionMetadata, verifySensitiveActionAuthorization } from '@/lib/server/data'
import { isDataPlanCategoryDisabled } from '@/lib/data-plan-categories'
import { createAmigoDataPayment, getAmigoPlanForPurchase, isAmigoBillsEnabled, listAmigoDataBundleNetworkProvidersSafe } from '@/lib/server/amigo-bills'
import { createAsbdataAirtimePayment, createAsbdataDataPayment, getAsbdataNetworkId, getAsbdataPlanForPurchase, getPricedAsbdataPlans, isAsbdataBillsEnabled, listAsbdataDataBundleNetworkProvidersSafe, type PricedAsbdataPlan } from '@/lib/server/asbdata-bills'
import { createBardetechAirtimePayment, createBardetechDataPayment, getBardetechNetworkId, getBardetechPlanForPurchase, getPricedBardetechPlans, isBardetechBillsEnabled, listBardetechDataBundleNetworkProvidersSafe, type PricedBardetechPlan } from '@/lib/server/bardetech-bills'
import { createFlutterwaveBillPayment, getFlutterwaveDataBundleForPurchase, isFlutterwaveBillsEnabled, isFlutterwaveBillTypeSupported, listFlutterwaveCableBillProvidersSafe, listFlutterwaveDataBundleNetworkProviders, listFlutterwaveElectricBillProvidersSafe } from '@/lib/server/flutterwave-bills'
import { ensureFlutterwaveBillSyncScheduler, kickPendingFlutterwaveBillSync } from '@/lib/server/flutterwave-bill-sync-batch'
import { ensureBardetechBillSyncScheduler } from '@/lib/server/bardetech-bill-sync'
import { ensureAsbdataBillSyncScheduler, syncAsbdataBill } from '@/lib/server/asbdata-bill-sync'
import { generateRef } from '@/lib/utils'
import { loadPricingRules, pricePlanNgn } from '@/lib/server/data-pricing'
import type { AmigoDataPaymentResult } from '@/lib/server/amigo-bills'
import type { AsbdataPaymentResult } from '@/lib/server/asbdata-bills'
import type { BardetechPaymentResult } from '@/lib/server/bardetech-bills'
import type { FlutterwaveBillPaymentResult } from '@/lib/server/flutterwave-bills'
import type { BillProvider, Transaction } from '@/types'

type AirtimeProvider = 'bardetech' | 'asbdata'

const BILL_REQUEST_ID_PATTERN = /^bill_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function buildBillRequestFingerprint(input: {
  serviceId: string
  serviceType: BillProvider['type']
  provider?: string
  account: string
  amount: number
  billerCode?: string
  itemCode?: string
  providerPlanId?: string
  providerNetworkId?: number
  providerName?: string
}) {
  return JSON.stringify({
    serviceId: input.serviceId,
    serviceType: input.serviceType,
    provider: input.provider ?? null,
    account: input.account,
    amount: input.amount,
    billerCode: input.billerCode ?? null,
    itemCode: input.itemCode ?? null,
    providerPlanId: input.providerPlanId ?? null,
    providerNetworkId: input.providerNetworkId ?? null,
    providerName: input.providerName ?? null,
  })
}

async function getBillRequestReplay(userId: string, requestId: string, fingerprint: string) {
  const existing = await getTransactionById(userId, requestId)
  if (existing) {
    const wallet = await getWalletByUserId(userId)
    const matchesRequest = existing.metadata?.billRequestFingerprint === fingerprint
    const error = !matchesRequest
      ? 'An earlier purchase attempt already uses this request. Its transaction status is included below; no new purchase was submitted.'
      : existing.status === 'failed'
        ? 'This purchase attempt already failed. Start a new attempt if you want to retry.'
        : null

    return NextResponse.json({
      ...(error ? { error } : {}),
      data: { transaction: existing, wallet, idempotentReplay: true },
      success: !error,
      code: !matchesRequest ? 'BILL_REQUEST_KEY_REUSED' : existing.status === 'failed' ? 'BILL_REQUEST_ALREADY_FAILED' : undefined,
    }, {
      status: error ? 409 : existing.status === 'pending' || existing.status === 'processing' ? 202 : 200,
    })
  }

  const existingAny = await getAnyTransactionById(requestId)
  if (existingAny) {
    return NextResponse.json({
      error: 'This purchase request could not be matched safely. Check transaction history before trying again.',
      success: false,
      code: 'BILL_REQUEST_KEY_REUSED',
    }, { status: 409 })
  }

  return null
}

function normalizeSmePlanSize(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '')
  const match = normalized.match(/^(\d+(?:\.\d+)?)(gb|g|mb|m)$/)
  if (!match) return normalized
  const amount = Number(match[1])
  const megabytes = match[2].startsWith('g') ? amount * 1000 : amount
  return `${Number(megabytes.toFixed(4))}mb`
}

function getPreferredSmeProvider(size: string): 'bardetech' | 'asbdata' {
  return normalizeSmePlanSize(size) === '5000mb' ? 'bardetech' : 'asbdata'
}

function normalizeSmePlanValidity(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '')
  const match = normalized.match(/(\d+(?:\.\d+)?)(hours?|hrs?|days?|dys?|weeks?|wks?|months?|mths?|years?|yrs?)/)
  if (!match) return normalized.replace(/days?/g, 'day').replace(/hours?/g, 'hour')
  const quantity = Number(match[1])
  const unit = match[2]
  const days = unit.startsWith('hour') || unit.startsWith('hr') ? quantity / 24
    : unit.startsWith('week') || unit.startsWith('wk') ? quantity * 7
      : unit.startsWith('month') || unit.startsWith('mth') ? quantity * 30
        : unit.startsWith('year') || unit.startsWith('yr') ? quantity * 365
          : quantity
  return `days:${Number(days.toFixed(4))}`
}

type SmeFallbackPlan =
  | { provider: 'bardetech'; plan: PricedBardetechPlan }
  | { provider: 'asbdata'; plan: PricedAsbdataPlan }

async function getEquivalentSmeFallbackPlans(input: {
  network: string
  size: string
  validity: string
  retailNgn: number
  excludeProvider: 'bardetech' | 'asbdata'
  excludePlanId: number
  excludePlanType: string
}): Promise<SmeFallbackPlan[]> {
  const [bardetechResult, asbdataResult] = await Promise.all([
    isBardetechBillsEnabled()
      ? getPricedBardetechPlans().then(plans => ({ plans, error: null as string | null })).catch(error => ({ plans: [], error: error instanceof Error ? error.message : 'catalog lookup failed' }))
      : Promise.resolve({ plans: [], error: 'provider disabled' }),
    isAsbdataBillsEnabled()
      ? getPricedAsbdataPlans().then(plans => ({ plans, error: null as string | null })).catch(error => ({ plans: [], error: error instanceof Error ? error.message : 'catalog lookup failed' }))
      : Promise.resolve({ plans: [], error: 'provider disabled' }),
  ])
  const allCandidates: SmeFallbackPlan[] = [
    ...bardetechResult.plans.map(plan => ({ provider: 'bardetech' as const, plan })),
    ...asbdataResult.plans.map(plan => ({ provider: 'asbdata' as const, plan })),
  ]
  const candidates = allCandidates.filter(candidate => {
    const reasons: string[] = []
    if (candidate.plan.network.toLowerCase() !== input.network.toLowerCase()) reasons.push('network')
    if (normalizeSmePlanSize(candidate.plan.size) !== normalizeSmePlanSize(input.size)) reasons.push('size')
    if (normalizeSmePlanValidity(candidate.plan.validity) !== normalizeSmePlanValidity(input.validity)) reasons.push('validity')
    if (candidate.plan.planTypeNormalized !== 'SME' && candidate.plan.planTypeNormalized !== 'SME2') reasons.push('plan_type')
    if (candidate.plan.costNgn > input.retailNgn + 0.009) reasons.push('provider_cost_exceeds_sale')
    if (candidate.provider === input.excludeProvider && candidate.plan.planId === input.excludePlanId) reasons.push('already_selected')
    if (candidate.provider === input.excludeProvider && candidate.plan.planTypeNormalized === input.excludePlanType) reasons.push('same_provider_and_plan_type')
    if (reasons.length) {
      console.info('[bills] provider.fallback.candidate_skipped', JSON.stringify({
        provider: candidate.provider,
        planId: candidate.plan.planId,
        planType: candidate.plan.planTypeNormalized,
        reasons,
      }))
      return false
    }
    return true
  })
  console.info('[bills] provider.fallback.candidates', JSON.stringify({
    network: input.network,
    size: input.size,
    validity: input.validity,
    saleNgn: input.retailNgn,
    bardetechCatalog: bardetechResult.error ? `unavailable: ${bardetechResult.error}` : 'loaded',
    asbdataCatalog: asbdataResult.error ? `unavailable: ${asbdataResult.error}` : 'loaded',
    matched: candidates.map(candidate => ({ provider: candidate.provider, planId: candidate.plan.planId, planType: candidate.plan.planTypeNormalized, costNgn: candidate.plan.costNgn })),
  }))

  const preferredProvider = getPreferredSmeProvider(input.size)
  return candidates.sort((left, right) => (
    (left.provider === preferredProvider ? 0 : 1) - (right.provider === preferredProvider ? 0 : 1)
    || (left.plan.planTypeNormalized === 'SME' ? 0 : 1) - (right.plan.planTypeNormalized === 'SME' ? 0 : 1)
    || left.plan.costNgn - right.plan.costNgn
  ))
}

function getConfiguredAirtimeProviders(): AirtimeProvider[] {
  return [
    ...(isBardetechBillsEnabled() ? ['bardetech' as const] : []),
    ...(isAsbdataBillsEnabled() ? ['asbdata' as const] : []),
  ]
}

/** Whether any configured provider can serve a bill type. */
function hasProviderForBillType(type: BillProvider['type']) {
  if (type === 'airtime') return getConfiguredAirtimeProviders().length > 0
  if (isFlutterwaveBillsEnabled() && isFlutterwaveBillTypeSupported(type)) return true
  if (type === 'data') return isAsbdataBillsEnabled() || isAmigoBillsEnabled() || isBardetechBillsEnabled()
  return false
}

export async function GET(req: Request) {
  ensureFlutterwaveBillSyncScheduler()
  ensureBardetechBillSyncScheduler()
  ensureAsbdataBillSyncScheduler()
  const user = await requireUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const forceRefresh = url.searchParams.get('refresh') === '1'
  const [baseProviders, baseNetworkProviders, billTypeSettings, disabledDataPlanCategories, disabledDataPlans] = await Promise.all([
    getBillProviders(),
    getNetworkProviders(),
    getBillTypeSettings(),
    getDisabledDataPlanCategories(),
    getDisabledDataPlans(),
  ])
  const enabledBillTypes = new Set(billTypeSettings.filter(setting => setting.enabled).map(setting => setting.type))
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

  const flutterwavePricingRules = await loadPricingRules()
  networkProviders = networkProviders.map(network => ({
    ...network,
    dataBundles: network.dataBundles?.map(bundle => {
      if (bundle.provider !== 'flutterwave') return bundle
      const priced = pricePlanNgn(flutterwavePricingRules, {
        vendor: 'flutterwave',
        network: network.name,
        planType: 'STANDARD',
        variationCode: bundle.itemCode,
      }, bundle.amount)
      return { ...bundle, amount: priced.retailNgn }
    }),
  }))

  networkProviders = networkProviders.map(network => ({
    ...network,
    dataBundles: network.dataBundles?.filter(bundle => (
      !isDataPlanCategoryDisabled(disabledDataPlanCategories, 'network', network.name)
      && !isDataPlanCategoryDisabled(disabledDataPlanCategories, 'plan_type', bundle.planType)
      && !(bundle.provider === 'flutterwave' && bundle.providerNetworkId !== undefined
        && disabledDataPlans.some(plan => plan.vendor === 'flutterwave'
          && plan.networkId === bundle.providerNetworkId
          && plan.planId === (bundle.providerPlanId || bundle.itemCode)))
    )),
  }))

  const hydratedProviders = providers
    .map(item => ({
      ...item,
      isActive:
        item.isActive !== false
        && enabledBillTypes.has(item.type)
        && hasProviderForBillType(item.type)
        && (
          (item.type !== 'cable' && item.type !== 'electric')
          || (Array.isArray(item.billers) && item.billers.length > 0)
        ),
    }))

  return NextResponse.json({ data: { providers: hydratedProviders, networkProviders }, success: true })
}

export async function POST(req: Request) {
  try {
    return await handleBillPayment(req)
  } catch (error) {
    console.error('[bills] POST failed', error)
    return NextResponse.json({
      error: 'Bill payment failed. Please try again.',
      success: false,
    }, { status: 500 })
  }
}

async function handleBillPayment(req: Request) {
  ensureCryptoMarketAutoRefreshScheduler()
  void kickCryptoMarketRefresh()
  ensureFlutterwaveBillSyncScheduler()
  ensureBardetechBillSyncScheduler()
  ensureAsbdataBillSyncScheduler()
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
  // Which provider issued the selected bundle. Amigo and ASBDATA both send a plan id plus a
  // network id and their network ids disagree, so the fields alone cannot identify the provider.
  // Older app builds omit this; fall back to the previous inference in that case.
  const providerName = typeof body.providerName === 'string' ? body.providerName.trim() : undefined
  const rawAccount = typeof body.account === 'string' ? body.account.trim() : ''
  const rawRequestId = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
  if (rawRequestId && !BILL_REQUEST_ID_PATTERN.test(rawRequestId)) {
    return NextResponse.json({ error: 'Invalid purchase request. Please restart this payment.', success: false }, { status: 400 })
  }
  const requestId = rawRequestId || undefined
  const [providers, billTypeSettings] = await Promise.all([getBillProviders(), getBillTypeSettings()])
  const selectedProvider = providers.find(item => item.name === service || item.id === service)

  if (!selectedProvider) {
    return NextResponse.json({ error: 'Unsupported bill service', success: false }, { status: 400 })
  }
  if (!billTypeSettings.some(setting => setting.type === selectedProvider.type && setting.enabled)) {
    return NextResponse.json({ error: `${selectedProvider.name} is temporarily unavailable.`, success: false }, { status: 503 })
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

  const requestFingerprint = buildBillRequestFingerprint({
    serviceId: selectedProvider.id,
    serviceType: selectedProvider.type,
    provider,
    account,
    amount: numericAmount,
    billerCode,
    itemCode,
    providerPlanId,
    providerNetworkId,
    providerName,
  })
  if (requestId) {
    const replay = await getBillRequestReplay(user.id, requestId, requestFingerprint)
    if (replay) return replay
  }

  const airtimeNetworkIds = new Map<AirtimeProvider, number>()
  if (selectedProvider.type === 'airtime') {
    for (const airtimeProvider of getConfiguredAirtimeProviders()) {
      const networkId = airtimeProvider === 'bardetech'
        ? getBardetechNetworkId(provider || '')
        : getAsbdataNetworkId(provider || '')
      if (networkId !== undefined) airtimeNetworkIds.set(airtimeProvider, networkId)
    }
    if (airtimeNetworkIds.size === 0) {
      return NextResponse.json({ error: 'Airtime is temporarily unavailable for this network.', success: false }, { status: 503 })
    }
  }
  const airtimeProviders = [...airtimeNetworkIds.keys()]

  // Which provider owns this purchase. Prefer the name the client sent; fall back to the old
  // inference (plan id + network id implied Amigo) so app builds predating providerName still work.
  const hasPlanSelection = Boolean(providerPlanId) && Number.isFinite(providerNetworkId)
  const resolvedDataProvider = selectedProvider.type !== 'data' || !hasPlanSelection
    ? null
    : providerName === 'asbdata' || providerName === 'amigo' || providerName === 'flutterwave' || providerName === 'bardetech'
      ? providerName
      : 'amigo'

  if (selectedProvider.type === 'data') {
    if (
      resolvedDataProvider === 'flutterwave'
      && providerPlanId
      && Number.isFinite(providerNetworkId)
      && await isDataPlanDisabled('flutterwave', providerNetworkId, providerPlanId)
    ) {
      return NextResponse.json({ error: 'This data plan is temporarily unavailable.', success: false }, { status: 503 })
    }
    const disabledCategories = await getDisabledDataPlanCategories()
    if (isDataPlanCategoryDisabled(disabledCategories, 'network', provider)) {
      return NextResponse.json({ error: 'Data plans for this network are temporarily unavailable.', success: false }, { status: 503 })
    }
    if ((!resolvedDataProvider || resolvedDataProvider === 'flutterwave') && isDataPlanCategoryDisabled(disabledCategories, 'plan_type', 'STANDARD')) {
      return NextResponse.json({ error: 'Standard data plans are temporarily unavailable.', success: false }, { status: 503 })
    }
  }

  // Server-authoritative price for plan-based data. Client amount is only used to detect that
  // the catalog moved under the user mid-checkout — never to decide what we charge.
  let chargeAmount = numericAmount
  let platformFee = 0
  let providerBaseAmount = numericAmount
  let pricingRuleId: string | null = null
  let asbdataPlan: PricedAsbdataPlan | null = null
  let bardetechPlan: PricedBardetechPlan | null = null

  if (
    resolvedDataProvider === 'asbdata'
    && isAsbdataBillsEnabled()
    && providerPlanId
    && Number.isFinite(providerNetworkId)
  ) {
    asbdataPlan = await getAsbdataPlanForPurchase(providerNetworkId, providerPlanId)
    if (!asbdataPlan) {
      return NextResponse.json({ error: 'This data plan is no longer available.', success: false }, { status: 400 })
    }
    if (Math.abs(numericAmount - asbdataPlan.retailNgn) > 0.009) {
      return NextResponse.json({
        error: "This plan's price changed. Please review the new price and try again.",
        code: 'PRICE_CHANGED',
        amount: asbdataPlan.retailNgn,
        success: false,
      }, { status: 409 })
    }
    chargeAmount = asbdataPlan.retailNgn
    platformFee = asbdataPlan.marginNgn
    providerBaseAmount = asbdataPlan.costNgn
    pricingRuleId = asbdataPlan.ruleId
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
    bardetechPlan = plan
  } else if (
    resolvedDataProvider === 'flutterwave'
    && isFlutterwaveBillsEnabled()
    && providerPlanId
    && Number.isFinite(providerNetworkId)
  ) {
    const item = await getFlutterwaveDataBundleForPurchase(provider, itemCode || providerPlanId)
    if (!item) {
      return NextResponse.json({ error: 'This data plan is no longer available.', success: false }, { status: 400 })
    }
    const priced = pricePlanNgn(await loadPricingRules(), {
      vendor: 'flutterwave',
      network: provider,
      planType: 'STANDARD',
      variationCode: item.itemCode,
    }, item.amount)
    if (Math.abs(numericAmount - priced.retailNgn) > 0.009) {
      return NextResponse.json({
        error: "This plan's price changed. Please review the new price and try again.",
        code: 'PRICE_CHANGED',
        amount: priced.retailNgn,
        success: false,
      }, { status: 409 })
    }
    chargeAmount = priced.retailNgn
    platformFee = priced.marginNgn
    providerBaseAmount = priced.costNgn
    pricingRuleId = priced.ruleId
  }

  const wallet = await getWalletByUserId(user.id)
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found', success: false }, { status: 404 })
  }

  if (wallet.balance < chargeAmount) {
    return NextResponse.json({ error: 'Insufficient balance', success: false }, { status: 400 })
  }

  try {
    await verifySensitiveActionAuthorization(user.id, { transactionPin, biometricApprovalToken })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Security approval failed.', success: false }, { status: 400 })
  }

  const ref = generateRef()
  const transactionId = requestId || ref

  const flutterwaveInput = {
    type: selectedProvider.type,
    networkProvider: provider,
    account,
    amount: selectedProvider.type === 'data' && resolvedDataProvider === 'flutterwave'
      ? providerBaseAmount
      : chargeAmount,
    reference: ref,
    billerCode,
    itemCode,
  }

  const expectedProvider = selectedProvider.type === 'airtime'
    ? airtimeProviders[0]!
    : resolvedDataProvider && (
        resolvedDataProvider === 'amigo' ? isAmigoBillsEnabled()
          : resolvedDataProvider === 'asbdata' ? isAsbdataBillsEnabled()
            : resolvedDataProvider === 'bardetech' ? isBardetechBillsEnabled()
              : false
      )
      ? resolvedDataProvider
      : 'flutterwave'
  const reservationTransaction: Transaction = {
    id: transactionId,
    type: selectedProvider.type as Transaction['type'],
    status: 'pending',
    amount: -chargeAmount,
    fee: platformFee,
    description: `${serviceConfig.displayName} Payment`,
    reference: ref,
    createdAt: new Date().toISOString(),
    icon: selectedProvider.icon,
    metadata: {
      serviceId: selectedProvider.id,
      billRequestFingerprint: requestFingerprint,
      serviceType: selectedProvider.type,
      serviceName: serviceConfig.displayName,
      provider: serviceConfig.requiresNetwork ? provider : undefined,
      account,
      amount: chargeAmount,
      providerName: expectedProvider,
      // Flutterwave can retrieve the eventual outcome by our client reference if the
      // synchronous request times out after the provider accepted it.
      providerReference: expectedProvider === 'flutterwave' ? ref : undefined,
      platformFee,
      providerPlanId: selectedProvider.type === 'data' && resolvedDataProvider ? providerPlanId : undefined,
      requestedProviderPlanId: selectedProvider.type === 'data' && resolvedDataProvider ? providerPlanId : undefined,
      providerNetworkId: selectedProvider.type === 'data' && resolvedDataProvider && Number.isFinite(providerNetworkId) ? providerNetworkId : undefined,
      providerBaseAmount: selectedProvider.type === 'data' && resolvedDataProvider ? providerBaseAmount : undefined,
      purchaseEconomics: selectedProvider.type === 'data' && resolvedDataProvider ? {
        version: 1,
        saleNgn: chargeAmount,
        providerCostNgn: providerBaseAmount,
        spreadNgn: chargeAmount - providerBaseAmount,
        costBasis: 'provider_plan_catalog',
        costStatus: 'quoted',
      } : undefined,
      pricingRuleId: pricingRuleId || undefined,
      settlementFlow: 'release_locked',
      settlementKind: 'provider_bill',
      walletAsset: 'NGN',
    },
  }
  let reservation: Awaited<ReturnType<typeof applyWalletMutation>>
  try {
    reservation = await applyWalletMutation({
      userId: user.id,
      balanceDelta: -chargeAmount,
      lockedBalanceDelta: chargeAmount,
      minimumAvailableBalance: chargeAmount,
      transaction: reservationTransaction,
    })
  } catch (error) {
    if (requestId) {
      const replay = await getBillRequestReplay(user.id, requestId, requestFingerprint)
      if (replay) return replay
    }
    if (error instanceof Error && error.message === 'Insufficient balance') {
      return NextResponse.json({ error: 'Insufficient balance', success: false }, { status: 400 })
    }
    throw error
  }

  const providerStartedAt = Date.now()
  const activeProvider = expectedProvider
  let providerResult: AsbdataPaymentResult | BardetechPaymentResult | AmigoDataPaymentResult | FlutterwaveBillPaymentResult
  try {
    providerResult = selectedProvider.type === 'airtime' && expectedProvider === 'bardetech'
      ? await createBardetechAirtimePayment({
        networkId: airtimeNetworkIds.get('bardetech')!,
        mobileNumber: account,
        amount: chargeAmount,
        reference: ref,
      })
      : selectedProvider.type === 'airtime' && expectedProvider === 'asbdata'
        ? await createAsbdataAirtimePayment({
          networkId: airtimeNetworkIds.get('asbdata')!,
          mobileNumber: account,
          amount: chargeAmount,
          reference: ref,
        })
      : resolvedDataProvider === 'asbdata' && isAsbdataBillsEnabled() && providerPlanId
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
          : await createFlutterwaveBillPayment(flutterwaveInput)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Provider request ended without a confirmed response.'
    await recordProviderEvent({
      externalEventId: `bill:${ref}:request-indeterminate`,
      provider: selectedProvider.type === 'airtime'
        ? activeProvider === 'bardetech' ? 'bardetech_airtime' : 'asbdata_airtime'
        : `${activeProvider}_bills`,
      reference: ref,
      status: 'INDETERMINATE',
      failureReason: reason,
      payload: { message: reason },
    })
    return NextResponse.json({
      data: { transaction: reservation.transaction, wallet: reservation.wallet },
      message: 'Payment is awaiting provider confirmation. Reserved funds will be released if the provider confirms failure.',
      success: true,
    }, { status: 202 })
  }

  // Airtime uses the configured primary provider, then tries the other configured vendor only
  // after an explicit rejection. Never retry an indeterminate result: the first provider may
  // already have delivered airtime, and a second purchase could double-credit.
  if (
    selectedProvider.type === 'airtime'
    && providerResult.provider === expectedProvider
    && providerResult.status === 'failed'
    && !providerResult.indeterminate
  ) {
    const primaryFailure = providerResult
    const primaryProvider = primaryFailure.provider as AirtimeProvider
    const fallbackProviders = airtimeProviders.filter(candidate => candidate !== primaryProvider)
    const primaryFailureEventId = `bill:${ref}:${primaryProvider}-fallback:${primaryFailure.rawStatus || 'FAILED'}`
    await recordProviderEvent({
      externalEventId: primaryFailureEventId,
      provider: primaryProvider === 'bardetech' ? 'bardetech_airtime' : 'asbdata_airtime',
      reference: ref,
      status: primaryFailure.rawStatus || 'FAILED',
      failureReason: primaryFailure.reason,
      payload: primaryFailure.payload,
    })
    await markProviderEventProcessed(primaryFailureEventId)

    for (const fallbackProvider of fallbackProviders) {
      const networkId = airtimeNetworkIds.get(fallbackProvider)
      if (networkId === undefined) continue

      console.info('[bills] provider.fallback.start', JSON.stringify({ reference: ref, type: 'airtime', provider: fallbackProvider }))
      let fallbackResult: BardetechPaymentResult | AsbdataPaymentResult
      try {
        fallbackResult = fallbackProvider === 'bardetech'
          ? await createBardetechAirtimePayment({ networkId, mobileNumber: account, amount: chargeAmount, reference: ref })
          : await createAsbdataAirtimePayment({ networkId, mobileNumber: account, amount: chargeAmount, reference: ref })
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Fallback provider request ended without a confirmed response.'
        fallbackResult = fallbackProvider === 'bardetech'
          ? { provider: 'bardetech', reference: ref, status: 'failed', rawStatus: 'INDETERMINATE', reason, networkId, indeterminate: true }
          : { provider: 'asbdata', reference: ref, status: 'failed', rawStatus: 'INDETERMINATE', reason, networkId, indeterminate: true }
      }
      providerResult = fallbackResult
      console.info('[bills] provider.fallback.completed', JSON.stringify({
        reference: ref,
        type: 'airtime',
        provider: fallbackResult.provider,
        status: fallbackResult.status,
        providerStatus: fallbackResult.rawStatus ?? null,
      }))

      if (fallbackResult.status !== 'failed' || fallbackResult.indeterminate) break

      const fallbackFailureEventId = `bill:${ref}:${fallbackResult.provider}:fallback:${fallbackResult.rawStatus || 'FAILED'}`
      await recordProviderEvent({
        externalEventId: fallbackFailureEventId,
        provider: fallbackResult.provider === 'bardetech' ? 'bardetech_airtime' : 'asbdata_airtime',
        reference: ref,
        status: fallbackResult.rawStatus || 'FAILED',
        failureReason: fallbackResult.reason,
        payload: fallbackResult.payload,
      })
      await markProviderEventProcessed(fallbackFailureEventId)
    }
  }

  // SME/SME2 bundles can be duplicated across ASBDATA and Bardetech. Keep the customer price
  // locked and try equivalent routes in priority order, but only after an explicit rejection.
  // A timeout/indeterminate response may already have delivered, so it must never be retried.
  const selectedSmePlan = expectedProvider === 'bardetech' ? bardetechPlan
    : expectedProvider === 'asbdata' ? asbdataPlan
      : null
  if (
    selectedProvider.type === 'data'
    && (expectedProvider === 'bardetech' || expectedProvider === 'asbdata')
    && providerResult.provider === expectedProvider
    && providerResult.status === 'failed'
    && !providerResult.indeterminate
    && selectedSmePlan
    && (selectedSmePlan.planTypeNormalized === 'SME' || selectedSmePlan.planTypeNormalized === 'SME2')
  ) {
    const primaryFailure = providerResult
    const alternatives = await getEquivalentSmeFallbackPlans({
      network: selectedSmePlan.network,
      size: selectedSmePlan.size,
      validity: selectedSmePlan.validity,
      retailNgn: chargeAmount,
      excludeProvider: expectedProvider,
      excludePlanId: selectedSmePlan.planId,
      excludePlanType: selectedSmePlan.planTypeNormalized,
    })
    if (alternatives.length > 0) {
      const primaryFailureEventId = `bill:${ref}:${expectedProvider}-sme-fallback:${selectedSmePlan.planId}:${primaryFailure.rawStatus || 'FAILED'}`
      await recordProviderEvent({
        externalEventId: primaryFailureEventId,
        provider: expectedProvider === 'bardetech' ? 'bardetech_data' : 'asbdata_data',
        reference: ref,
        status: primaryFailure.rawStatus || 'FAILED',
        failureReason: primaryFailure.reason,
        payload: primaryFailure.payload,
      })
      await markProviderEventProcessed(primaryFailureEventId)

      for (const candidate of alternatives) {
        const alternatePlan = candidate.plan
        console.info('[bills] provider.fallback.start', JSON.stringify({
          reference: ref,
          type: 'data',
          provider: candidate.provider,
          selectedProvider: expectedProvider,
          selectedPlanId: selectedSmePlan.planId,
          alternatePlanId: alternatePlan.planId,
          planType: alternatePlan.planTypeNormalized,
        }))

        let alternateResult: AsbdataPaymentResult | BardetechPaymentResult
        try {
          alternateResult = candidate.provider === 'bardetech'
            ? await createBardetechDataPayment({
              networkId: alternatePlan.networkId,
              mobileNumber: account,
              planId: String(alternatePlan.planId),
              reference: ref,
            })
            : await createAsbdataDataPayment({
              networkId: alternatePlan.networkId,
              mobileNumber: account,
              planId: String(alternatePlan.planId),
              reference: ref,
            })
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Equivalent provider request ended without a confirmed response.'
          alternateResult = candidate.provider === 'bardetech'
            ? { provider: 'bardetech', reference: ref, status: 'failed', rawStatus: 'INDETERMINATE', reason, networkId: alternatePlan.networkId, planId: alternatePlan.planId, indeterminate: true }
            : { provider: 'asbdata', reference: ref, status: 'failed', rawStatus: 'INDETERMINATE', reason, networkId: alternatePlan.networkId, planId: alternatePlan.planId, indeterminate: true }
        }

        providerResult = alternateResult
        asbdataPlan = candidate.provider === 'asbdata' ? alternatePlan : null
        bardetechPlan = candidate.provider === 'bardetech' ? alternatePlan : null
        providerBaseAmount = alternatePlan.costNgn
        platformFee = chargeAmount - alternatePlan.costNgn
        pricingRuleId = alternatePlan.ruleId
        console.info('[bills] provider.fallback.completed', JSON.stringify({
          reference: ref,
          type: 'data',
          provider: candidate.provider,
          planId: alternatePlan.planId,
          status: alternateResult.status,
          providerStatus: alternateResult.rawStatus ?? null,
        }))

        if (alternateResult.status !== 'failed' || alternateResult.indeterminate) break

        const alternateFailureEventId = `bill:${ref}:${candidate.provider}-sme-alternate:${alternatePlan.planId}:${alternateResult.rawStatus || 'FAILED'}`
        await recordProviderEvent({
          externalEventId: alternateFailureEventId,
          provider: candidate.provider === 'bardetech' ? 'bardetech_data' : 'asbdata_data',
          reference: ref,
          status: alternateResult.rawStatus || 'FAILED',
          failureReason: alternateResult.reason,
          payload: alternateResult.payload,
        })
        await markProviderEventProcessed(alternateFailureEventId)
      }
    }
  }

  console.info('[bills] provider.completed', JSON.stringify({
    reference: ref,
    type: selectedProvider.type,
    provider: providerResult.provider,
    status: providerResult.status,
    providerStatus: providerResult.rawStatus ?? null,
    billerCode: 'billerCode' in providerResult ? providerResult.billerCode ?? null : null,
    itemCode: 'itemCode' in providerResult ? providerResult.itemCode ?? null : null,
    elapsedMs: Date.now() - providerStartedAt,
  }))

  const providerEventName = providerResult.provider === 'asbdata'
    ? (selectedProvider.type === 'airtime' ? 'asbdata_airtime' : 'asbdata_data')
    : providerResult.provider === 'bardetech'
      ? (selectedProvider.type === 'airtime' ? 'bardetech_airtime' : 'bardetech_data')
      : providerResult.provider === 'amigo'
        ? 'amigo_data'
        : 'flutterwave_bills'

  if (providerResult.status === 'failed' && 'indeterminate' in providerResult && providerResult.indeterminate) {
    const eventId = providerResult.providerReference || `bill:${ref}:indeterminate`
    await recordProviderEvent({
      externalEventId: eventId,
      provider: providerEventName,
      reference: ref,
      status: providerResult.rawStatus || 'INDETERMINATE',
      failureReason: providerResult.reason,
      payload: providerResult.payload,
    })
    const pendingTransaction = await updatePendingTransactionMetadata(user.id, transactionId, {
      ...reservationTransaction.metadata,
      providerName: providerResult.provider,
      providerReference: providerResult.providerReference || (providerResult.provider === 'flutterwave' ? ref : undefined),
      providerStatus: providerResult.rawStatus || 'INDETERMINATE',
      ...((providerResult.provider === 'asbdata' || providerResult.provider === 'bardetech')
        && selectedProvider.type === 'data' && providerResult.planId !== undefined
        ? {
            providerPlanId: String(providerResult.planId),
            providerNetworkId: providerResult.networkId ?? providerNetworkId,
            requestedProviderPlanId: providerPlanId,
            providerFallbackUsed: providerResult.provider !== expectedProvider || String(providerResult.planId) !== providerPlanId,
            providerFallbackFromPlanId: providerResult.provider !== expectedProvider || String(providerResult.planId) !== providerPlanId ? providerPlanId : undefined,
            providerBaseAmount,
            platformFee,
            pricingRuleId: pricingRuleId || undefined,
          }
        : {}),
    })
    if (!pendingTransaction) throw new Error('Unable to preserve pending bill payment details.')
    if (providerResult.provider === 'flutterwave') void kickPendingFlutterwaveBillSync()
    if (providerResult.provider === 'asbdata' && providerResult.providerReference) {
      void syncAsbdataBill(ref).catch(error => {
        console.warn('[bills] ASBDATA follow-up status lookup failed:', error instanceof Error ? error.message : 'unknown error')
      })
    }
    return NextResponse.json({
      data: { transaction: pendingTransaction, wallet: reservation.wallet },
      message: 'Payment is awaiting provider confirmation. Reserved funds will be released if the provider confirms failure.',
      success: true,
    }, { status: 202 })
  }

  if (providerResult.status === 'failed') {
    const eventId = providerResult.providerReference || `bill:${ref}:failed`
    await recordProviderEvent({
      externalEventId: eventId,
      provider: providerEventName,
      reference: ref,
      status: providerResult.rawStatus || 'FAILED',
      failureReason: providerResult.reason,
      payload: providerResult.payload,
    })

    const released = await resolvePendingTransaction(user.id, transactionId, 'failed')
    if (released && released.transaction.status !== 'failed') {
      return NextResponse.json({ error: 'The provider reported conflicting bill payment results. Please contact support.', success: false }, { status: 409 })
    }
    await markProviderEventProcessed(eventId)

    return NextResponse.json({
      error: released
        ? `We couldn't complete this purchase. Any reserved funds have been released. Contact support with reference ${ref} if you need help.`
        : `We couldn't complete this purchase. Check your balance, and contact support with reference ${ref} if the amount has not been returned.`,
      data: released ? { transaction: released.transaction, wallet: released.wallet } : undefined,
      success: false,
    }, { status: 400 })
  }

  // Plan-based data: platformFee is the margin from pricing rules. Flutterwave / airtime quote
  // retail, so there is nothing to split out unless we priced a plan above.
  const isPlanBasedProvider = providerResult.provider === 'amigo' || (
    (providerResult.provider === 'asbdata' || providerResult.provider === 'bardetech' || providerResult.provider === 'flutterwave')
    && selectedProvider.type === 'data'
  )
  const completedPlanId = (providerResult.provider === 'asbdata' || providerResult.provider === 'bardetech') && providerResult.planId !== undefined
    ? String(providerResult.planId)
    : providerResult.provider === 'flutterwave' && providerResult.itemCode
      ? providerResult.itemCode
      : providerPlanId
  const transaction = {
    id: transactionId,
    type: selectedProvider.type as Transaction['type'],
    status: 'pending',
    amount: -chargeAmount,
    fee: platformFee,
    description: `${serviceConfig.displayName} Payment`,
    reference: ref,
    createdAt: new Date().toISOString(),
    icon: selectedProvider.icon,
    metadata: {
      serviceId: selectedProvider.id,
      billRequestFingerprint: requestFingerprint,
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
      providerPlanId: isPlanBasedProvider ? completedPlanId : undefined,
      requestedProviderPlanId: isPlanBasedProvider && providerPlanId ? providerPlanId : undefined,
      providerFallbackUsed: isPlanBasedProvider && completedPlanId && providerPlanId
        ? providerResult.provider !== expectedProvider || completedPlanId !== providerPlanId
        : undefined,
      providerFallbackFromPlanId: isPlanBasedProvider && completedPlanId && providerPlanId && (providerResult.provider !== expectedProvider || completedPlanId !== providerPlanId)
        ? providerPlanId
        : undefined,
      providerNetworkId: isPlanBasedProvider && Number.isFinite(providerNetworkId) ? providerNetworkId : undefined,
      providerBaseAmount: isPlanBasedProvider ? providerBaseAmount : chargeAmount,
      platformFee,
      purchaseEconomics: {
        version: 1,
        saleNgn: chargeAmount,
        providerCostNgn: isPlanBasedProvider ? providerBaseAmount : null,
        spreadNgn: isPlanBasedProvider ? chargeAmount - providerBaseAmount : null,
        costBasis: isPlanBasedProvider ? 'provider_plan_catalog' : 'provider_cost_not_reported',
        costStatus: isPlanBasedProvider ? 'quoted' : 'unknown',
      },
      pricingRuleId: pricingRuleId || undefined,
      settlementFlow: 'release_locked',
      settlementKind: 'provider_bill',
      walletAsset: 'NGN',
    },
  }

  const metadataUpdated = await updatePendingTransactionMetadata(user.id, transactionId, transaction.metadata)
  if (!metadataUpdated) throw new Error('Unable to update reserved bill payment details.')
  const result = providerResult.status === 'success'
    ? await resolvePendingTransaction(user.id, transactionId, 'success')
    : { transaction: metadataUpdated, wallet: await getWalletByUserId(user.id) }
  if (!result) throw new Error('Unable to settle bill payment reservation.')
  if (providerResult.status === 'success' && result.transaction.status !== 'success') {
    return NextResponse.json({ error: 'The provider reported conflicting bill payment results. Please contact support.', success: false }, { status: 409 })
  }
  if (!result.wallet) throw new Error('Unable to load the updated bill payment wallet.')
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
