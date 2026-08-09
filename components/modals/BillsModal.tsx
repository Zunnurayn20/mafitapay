'use client'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { createBiometricApproval } from '@/lib/client/biometric'
import { useNativeTransactionBiometric } from '@/hooks/useNativeTransactionBiometric'
import { refreshBillCatalog, useBillProviders, useNetworkProviders } from '@/lib/client/catalogs'
import {
  getBillServiceConfig,
  getDetectedNetworkProviderName,
  isValidNigerianPhoneNumber,
  normalizeNigerianPhoneNumber,
} from '@/lib/bill-config'
import { useAppStore } from '@/store'
import { readClipboardText } from '@/lib/clipboard'
import { generateRef } from '@/lib/utils'

interface BillsModalProps { open: boolean; onClose: () => void }
type TouchedState = { amount: boolean; account: boolean; provider: boolean }
type DataBundleGroupKey = 'best_offers' | 'daily' | 'weekly' | 'monthly' | 'night' | 'special'
type Step = 'form' | 'phone' | 'pin'

const INITIAL_TOUCHED: TouchedState = { amount: false, account: false, provider: false }

const DATA_BUNDLE_GROUPS: Array<{ key: DataBundleGroupKey; label: string }> = [
  { key: 'best_offers', label: 'Best Offers' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'night', label: 'Night' },
  { key: 'special', label: 'Special' },
]
const NETWORK_PROVIDER_DISPLAY_ORDER = ['mtn', 'airtel', 'glo', '9mobile'] as const

function getBillerLogo(name: string) {
  const normalized = name.trim().toLowerCase()
  if (normalized.includes('dstv')) return '/billers/dstv.svg'
  if (normalized.includes('gotv')) return '/billers/gotv.png'
  if (normalized.includes('startimes') || normalized.includes('star times')) return '/billers/startimes.png'
  if (normalized.includes('ekedc')) return '/billers/ekedc.png'
  if (normalized.includes('ikedc')) return '/billers/ikedc.png'
  if (normalized.includes('ibedc')) return '/billers/ibedc.png'
  if (normalized.includes('eedc')) return '/billers/eedc.png'
  if (normalized.includes('phed')) return '/billers/phed.png'
  if (normalized.includes('bedc')) return '/billers/bedc.png'
  if (normalized.includes('yedc')) return '/billers/yedc.png'
  if (normalized.includes('kedco')) return '/billers/kedco.png'
  if (normalized.includes('kedc') || normalized.includes('kaedc') || normalized.includes('kaduna')) return '/billers/kadc.png'
  if (normalized.includes('aedc')) return '/billers/aedc.png'
  return null
}

function isStrictDailyValidity(validity?: string) {
  const normalized = validity?.toLowerCase() ?? ''
  return normalized === '1 day' || normalized === '24hrs' || normalized === '24 hours'
}

function getNetworkProviderOrder(name: string) {
  const normalized = name.trim().toLowerCase()
  if (normalized.includes('mtn')) return NETWORK_PROVIDER_DISPLAY_ORDER.indexOf('mtn')
  if (normalized.includes('airtel')) return NETWORK_PROVIDER_DISPLAY_ORDER.indexOf('airtel')
  if (normalized.includes('glo')) return NETWORK_PROVIDER_DISPLAY_ORDER.indexOf('glo')
  if (normalized.includes('9mobile') || normalized.includes('etisalat')) return NETWORK_PROVIDER_DISPLAY_ORDER.indexOf('9mobile')
  return NETWORK_PROVIDER_DISPLAY_ORDER.length
}

function getDataBundleGroup(bundle: { itemName: string; validity?: string }) {
  const name = bundle.itemName.toLowerCase()
  const validity = bundle.validity?.toLowerCase() ?? ''

  if (name.includes('broadband') || name.includes('router only') || name.includes('fup unlimited')) {
    return null
  }
  if (isStrictDailyValidity(bundle.validity)) return 'daily'
  if (validity.includes('night') || name.includes('night')) return 'night'
  if (validity.includes('day') || name.includes('(1 day)') || name.includes('(2 days)')) return 'best_offers'
  if (validity.includes('week')) return 'weekly'
  if (validity.includes('month')) return 'monthly'
  return 'special'
}

function getDataBundleSubtitle(bundle: { itemName: string; label: string; validity?: string }) {
  const normalized = bundle.itemName
    .replace(/^mtn\s+/i, '')
    .replace(/^airtel\s+/i, '')
    .replace(/^glo\s+/i, '')
    .replace(/^9mobile\s+/i, '')
    .replace(/^etisalat\s+/i, '')
    .trim()

  const withoutPrimaryLabel = normalized.replace(bundle.label, '').trim()
  const withoutGenericWords = withoutPrimaryLabel
    .replace(/data purchase/gi, '')
    .replace(/data bundle/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!withoutGenericWords) return null
  return withoutGenericWords
}

function getSpecialBundleContext(bundle: { itemName: string; validity?: string }) {
  const normalized = bundle.itemName.toLowerCase()
  if (normalized.includes('youtube')) return 'Includes YouTube bonus'
  if (normalized.includes('min')) return 'Includes voice minutes'
  if (normalized.includes('night')) return 'Night plan'
  return bundle.validity ? null : 'Validity not provided by network'
}

type BundlePriceComparison = {
  label: string
  amount: number
  provider?: 'flutterwave' | 'amigo' | 'asbdata'
}

/**
 * Savings badge for a non-Flutterwave plan, versus the cheapest Flutterwave plan of the same size.
 * Flutterwave is the baseline because it is the only provider always configured, so it is the
 * price the user would otherwise have paid.
 */
function getPriceHintVsFlutterwave(
  bundle: BundlePriceComparison,
  bundles: BundlePriceComparison[],
) {
  if (!bundle.provider || bundle.provider === 'flutterwave') return null

  const comparableFlutterwavePlans = bundles.filter(candidate =>
    candidate.provider === 'flutterwave' && candidate.label === bundle.label
  )
  if (comparableFlutterwavePlans.length === 0) return null

  const nearestFlutterwavePlan = comparableFlutterwavePlans.reduce((best, candidate) =>
    candidate.amount < best.amount ? candidate : best
  )
  if (bundle.amount >= nearestFlutterwavePlan.amount) return null

  const savings = nearestFlutterwavePlan.amount - bundle.amount
  const savingsPercent = Math.round((savings / nearestFlutterwavePlan.amount) * 100)
  return {
    savings,
    savingsPercent,
  }
}

/**
 * Plan category shown in the picker. Vendors publish this as SME / GIFTING / CORPORATE GIFTING
 * and friends; normalizePlanType canonicalizes it server-side. Flutterwave publishes no category
 * at all, so those bundles land in Standard rather than a category of their own.
 */
const ALL_PLAN_CATEGORIES = '__all__'

function getPlanCategory(bundle: { planType?: string }) {
  return bundle.planType?.trim() || 'STANDARD'
}

function formatPlanCategoryLabel(category: string) {
  if (category === ALL_PLAN_CATEGORIES) return 'All'
  // Vendor values arrive shouted (CORPORATE GIFTING); title-case so the pills match the rest of
  // the UI, but keep SME/SME2/CG-style acronyms uppercase.
  return category
    .split(' ')
    .map(word => (word.length <= 3 || /\d/.test(word) ? word : `${word[0]}${word.slice(1).toLowerCase()}`))
    .join(' ')
}

export function BillsModal({ open, onClose }: BillsModalProps) {
  const { modalData, openModal, refreshSession, setModalData, closeModal, showToast, transactions, securitySettings } = useAppStore()
  const { nativeTransactionBiometricEnabled, nativeBiometricBusy, confirmWithNativeBiometric } = useNativeTransactionBiometric()
  const billProviders = useBillProviders().filter(item => item.isActive !== false)
  const networkProviders = useNetworkProviders()
  const orderedNetworkProviders = [...networkProviders].sort((a, b) => getNetworkProviderOrder(a.name) - getNetworkProviderOrder(b.name))
  const service = (modalData.service as string) || 'Airtime'
  const selectedBillProvider = billProviders.find(item => item.name === service || item.id === service) ?? billProviders[0]
  const serviceConfig = getBillServiceConfig(selectedBillProvider)
  const serviceName = serviceConfig?.displayName ?? selectedBillProvider?.name ?? service
  const [provider, setProvider] = useState('MTN Nigeria')
  const [amount, setAmount]     = useState('')
  const [account, setAccount]   = useState('')
  const [selectedBillerCode, setSelectedBillerCode] = useState('')
  const [selectedBundleCode, setSelectedBundleCode] = useState('')
  const [selectedDataBundleGroup, setSelectedDataBundleGroup] = useState<DataBundleGroupKey>('best_offers')
  const [selectedPlanCategory, setSelectedPlanCategory] = useState<string>(ALL_PLAN_CATEGORIES)
  const [touched, setTouched]   = useState<TouchedState>(INITIAL_TOUCHED)
  const [showRecentAccounts, setShowRecentAccounts] = useState(false)
  const formAccountInputRef = useRef<HTMLInputElement>(null)
  const phoneAccountInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('form')
  const [pinVersion, setPinVersion] = useState(0)
  const [pendingRequest, setPendingRequest] = useState<{
    amount: number
    billerCode?: string
    itemCode?: string
    providerPlanId?: string
    providerNetworkId?: number
    providerName?: 'flutterwave' | 'amigo' | 'asbdata'
  } | null>(null)
  const needsProvider = serviceConfig?.requiresNetwork ?? false
  const needsAccount = serviceConfig?.requiresAccount ?? true
  const amts = serviceConfig?.quickAmounts ?? [1000, 2000, 5000, 10000]
  const isDataService = serviceConfig?.type === 'data'
  const isElectricService = serviceConfig?.type === 'electric'
  const isPackageBillService = serviceConfig?.type === 'cable' || serviceConfig?.type === 'electric'
  const isPhoneService = serviceConfig?.type === 'airtime' || serviceConfig?.type === 'data'
  const defaultNetworkProviderName = orderedNetworkProviders[0]?.name || 'MTN Nigeria'
  const selectedNetworkProvider = orderedNetworkProviders.find(item => item.name === provider)
  const dataBundles = isDataService ? (selectedNetworkProvider?.dataBundles ?? []) : []
  const visibleDataBundles = isDataService
    ? dataBundles.filter(bundle => getDataBundleGroup(bundle) !== null)
    : []
  // Categories come from the bundles actually loaded, not a hardcoded list -- vendors differ on
  // which ones they publish, and a pill that filters to nothing is worse than no pill.
  const planCategories = Array.from(new Set(visibleDataBundles.map(getPlanCategory))).sort()
  // The picker only earns its space when there is a real choice to make.
  const showPlanCategoryPicker = planCategories.length > 1
  // Switching network can retire the picked category; fall back rather than showing an empty list.
  const activePlanCategory = showPlanCategoryPicker && planCategories.includes(selectedPlanCategory)
    ? selectedPlanCategory
    : ALL_PLAN_CATEGORIES
  const categoryFilteredBundles = activePlanCategory === ALL_PLAN_CATEGORIES
    ? visibleDataBundles
    : visibleDataBundles.filter(bundle => getPlanCategory(bundle) === activePlanCategory)
  // Duration groups are built from the category-filtered set, so picking SME drops any duration tab
  // that has no SME plans instead of leaving a tab that opens onto nothing.
  const groupedDataBundles = DATA_BUNDLE_GROUPS
    .map(group => ({
      ...group,
      bundles: categoryFilteredBundles.filter(bundle => getDataBundleGroup(bundle) === group.key),
    }))
    .filter(group => group.bundles.length > 0)
  const activeDataBundleGroup = groupedDataBundles.find(group => group.key === selectedDataBundleGroup) ?? groupedDataBundles[0]
  const shownDataBundles = activeDataBundleGroup?.bundles ?? []
  const selectedDataBundle = isDataService ? dataBundles.find(bundle => bundle.itemCode === selectedBundleCode) : null
  const packageBillers = isPackageBillService ? (selectedBillProvider?.billers ?? []) : []
  const selectedPackageBiller = isPackageBillService
    ? packageBillers.find(biller => biller.billerCode === selectedBillerCode) ?? packageBillers[0]
    : null
  const selectedPackageItem = isPackageBillService
    ? selectedPackageBiller?.items.find(item => item.itemCode === selectedBundleCode) ?? null
    : null
  const normalizedAccount = isPhoneService ? normalizeNigerianPhoneNumber(account) : account.trim()
  const accountLabel = isPackageBillService
    ? selectedPackageBiller?.accountLabel || serviceConfig?.accountLabel || 'Account'
    : serviceConfig?.accountLabel || 'Account'
  const accountPlaceholder = isPackageBillService
    ? selectedPackageBiller?.accountLabel || serviceConfig?.accountPlaceholder || 'Enter account detail'
    : serviceConfig?.accountPlaceholder || 'Enter account detail'
  const detectedProviderName = isPhoneService ? getDetectedNetworkProviderName(account, orderedNetworkProviders) : null
  const recentPhoneAccounts = isPhoneService
    ? Array.from(
        transactions
          .filter(tx =>
            tx.type === serviceConfig?.type
            && typeof tx.metadata?.account === 'string'
            && tx.metadata.account.trim()
          )
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
          .reduce((map, tx) => {
            const rawAccount = String(tx.metadata?.account ?? '')
            const normalized = normalizeNigerianPhoneNumber(rawAccount)
            if (!normalized || map.has(normalized)) return map
            map.set(normalized, {
              account: normalized,
              provider: typeof tx.metadata?.provider === 'string' ? tx.metadata.provider : undefined,
            })
            return map
          }, new Map<string, { account: string; provider?: string }>()),
      )
        .map(([, value]) => value)
        .slice(0, 5)
    : []

  useEffect(() => {
    if (!open) return
    setAmount('')
    setAccount('')
    setSelectedBillerCode('')
    setSelectedBundleCode('')
    setSelectedDataBundleGroup('best_offers')
    setSelectedPlanCategory(ALL_PLAN_CATEGORIES)
    setTouched(INITIAL_TOUCHED)
    setShowRecentAccounts(false)
    setProvider(defaultNetworkProviderName)
    setStep('form')
    setPinVersion(0)
    setPendingRequest(null)
  }, [defaultNetworkProviderName, open, service])

  useEffect(() => {
    if (!isPackageBillService) return
    if (selectedPackageBiller && selectedBillerCode !== selectedPackageBiller.billerCode) {
      setSelectedBillerCode(selectedPackageBiller.billerCode)
    }
  }, [isPackageBillService, selectedBillerCode, selectedPackageBiller])

  useEffect(() => {
    if (!open) return
    if (!provider && orderedNetworkProviders[0]?.name) {
      setProvider(orderedNetworkProviders[0].name)
    }
  }, [open, orderedNetworkProviders, provider])

  useEffect(() => {
    if (!open) return
    void refreshBillCatalog({ force: true })
  }, [open, service])

  useEffect(() => {
    if (!open || !needsProvider || !detectedProviderName || provider === detectedProviderName) return
    // For data the network is chosen before the number, and switching it here would swap the whole
    // plan list out from under a plan the user already picked. Surface the mismatch instead.
    if (isDataService) return
    setProvider(detectedProviderName)
  }, [detectedProviderName, isDataService, needsProvider, open, provider])

  useEffect(() => {
    if (!isDataService) return
    if (selectedBundleCode && !selectedDataBundle) {
      setSelectedBundleCode('')
      setAmount('')
    }
  }, [isDataService, selectedBundleCode, selectedDataBundle])

  useEffect(() => {
    if (!isDataService || groupedDataBundles.length === 0) return
    if (!groupedDataBundles.some(group => group.key === selectedDataBundleGroup)) {
      setSelectedDataBundleGroup(groupedDataBundles[0].key)
    }
  }, [groupedDataBundles, isDataService, selectedDataBundleGroup])

  const amountNumber = Number(amount)
  const amountError = (() => {
    if (isDataService) {
      if (!selectedBundleCode || !selectedDataBundle) return 'Select a valid data plan.'
      return null
    }
    if (isPackageBillService) {
      if (!selectedBillerCode || !selectedPackageItem) return 'Select a valid package.'
      if (isElectricService || selectedPackageItem.amount <= 0) {
        if (!amount.trim()) return 'Enter an amount.'
        if (!Number.isFinite(amountNumber) || amountNumber <= 0) return 'Enter a valid amount.'
        if (serviceConfig && amountNumber < serviceConfig.minAmount) return `Minimum amount is ₦${serviceConfig.minAmount.toLocaleString('en-NG')}.`
        if (serviceConfig && amountNumber > serviceConfig.maxAmount) return `Maximum amount is ₦${serviceConfig.maxAmount.toLocaleString('en-NG')}.`
      }
      return null
    }

    if (!amount.trim()) return 'Enter an amount.'
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return 'Enter a valid amount.'
    if (serviceConfig && amountNumber < serviceConfig.minAmount) return `Minimum amount is ₦${serviceConfig.minAmount.toLocaleString('en-NG')}.`
    if (serviceConfig && amountNumber > serviceConfig.maxAmount) return `Maximum amount is ₦${serviceConfig.maxAmount.toLocaleString('en-NG')}.`
    return null
  })()

  const accountError = (() => {
    if (!needsAccount) return null
    if (!account.trim()) return `Enter ${accountLabel.toLowerCase()}.`
    if (isPhoneService && !isValidNigerianPhoneNumber(account)) return 'Enter a valid Nigerian phone number.'
    return null
  })()

  const providerError = (() => {
    if (!needsProvider) return null
    if (!provider.trim()) return 'Select a network provider.'
    if (detectedProviderName && provider !== detectedProviderName) {
      return `This phone number matches ${detectedProviderName}.`
    }
    return null
  })()

  async function pasteAccount(inputRef: React.RefObject<HTMLInputElement | null>) {
    const result = await readClipboardText()
    if (result.ok) {
      // Pasted numbers often arrive as "+234 803 ..." or with separators; normalizing here
      // means the provider detection below sees the same shape the blur handler produces.
      setAccount(isPhoneService ? normalizeNigerianPhoneNumber(result.text) : result.text)
      setTouched(current => ({ ...current, account: true }))
      setShowRecentAccounts(false)
      return
    }
    if (result.reason === 'empty') {
      showToast('Clipboard is empty.', 'error')
      return
    }
    inputRef.current?.focus()
    showToast(`Press and hold the ${accountLabel.toLowerCase()} field to paste.`, 'error')
  }

  async function confirm(overrides?: {
    amount?: string
    selectedBundleCode?: string
    selectedDataBundle?: typeof selectedDataBundle
    transactionPin?: string
    biometricApprovalToken?: string
    confirmWithBiometric?: boolean
  }) {
    const nextAmount = overrides?.amount ?? amount
    const nextSelectedBundleCode = overrides?.selectedBundleCode ?? selectedBundleCode
    const nextSelectedDataBundle = overrides?.selectedDataBundle ?? selectedDataBundle
    const transactionPin = overrides?.transactionPin
    const biometricApprovalToken = overrides?.biometricApprovalToken
    const confirmWithBiometric = overrides?.confirmWithBiometric
    const nextAmountNumber = Number(nextAmount)
    const nextAmountError = isDataService
      ? (!nextSelectedBundleCode || !nextSelectedDataBundle ? 'Select a valid data plan.' : null)
      : isPackageBillService
        ? (
          !selectedBillerCode || !selectedPackageItem
            ? 'Select a valid package.'
            : (isElectricService || selectedPackageItem.amount <= 0)
              ? (!nextAmount.trim()
                ? 'Enter an amount.'
                : !Number.isFinite(nextAmountNumber) || nextAmountNumber <= 0
                  ? 'Enter a valid amount.'
                  : serviceConfig && nextAmountNumber < serviceConfig.minAmount
                    ? `Minimum amount is ₦${serviceConfig.minAmount.toLocaleString('en-NG')}.`
                    : serviceConfig && nextAmountNumber > serviceConfig.maxAmount
                      ? `Maximum amount is ₦${serviceConfig.maxAmount.toLocaleString('en-NG')}.`
                      : null)
              : null
        )
      : (!nextAmount.trim()
        ? 'Enter an amount.'
        : !Number.isFinite(nextAmountNumber) || nextAmountNumber <= 0
          ? 'Enter a valid amount.'
          : serviceConfig && nextAmountNumber < serviceConfig.minAmount
            ? `Minimum amount is ₦${serviceConfig.minAmount.toLocaleString('en-NG')}.`
            : serviceConfig && nextAmountNumber > serviceConfig.maxAmount
              ? `Maximum amount is ₦${serviceConfig.maxAmount.toLocaleString('en-NG')}.`
              : null)

    setTouched({ amount: true, account: true, provider: true })

    if (nextAmountError || accountError || providerError) {
      showToast(nextAmountError || accountError || providerError || 'Complete the required fields.', 'error')
      return
    }

    const amt = Number(nextAmount)
    const nextRequest = {
      amount: amt,
      ...(nextSelectedDataBundle ? {
        billerCode: nextSelectedDataBundle.billerCode,
        itemCode: nextSelectedDataBundle.itemCode,
        providerPlanId: nextSelectedDataBundle.providerPlanId,
        providerNetworkId: nextSelectedDataBundle.providerNetworkId,
        // Amigo and ASBDATA both send a plan id and a network id, and their network ids disagree
        // (9mobile is 9 on Amigo, 3 on ASBDATA). The server cannot tell them apart from the
        // fields alone, so name the provider that issued this bundle.
        providerName: nextSelectedDataBundle.provider,
      } : {}),
      ...(selectedPackageItem ? {
        billerCode: selectedPackageItem.billerCode,
        itemCode: selectedPackageItem.itemCode,
      } : {}),
    }

    if (!transactionPin && !biometricApprovalToken && !confirmWithBiometric) {
      setPendingRequest(nextRequest)
      setPinVersion(current => current + 1)
      setStep('pin')
      return
    }

    try {
      const response = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          service: serviceName,
          provider,
          account: normalizedAccount,
          amount: amt,
          transactionPin,
          biometricApprovalToken,
          confirmWithBiometric,
          billerCode: nextRequest.billerCode,
          itemCode: nextRequest.itemCode,
          providerPlanId: nextRequest.providerPlanId,
          providerNetworkId: nextRequest.providerNetworkId,
          providerName: nextRequest.providerName,
        }),
      })
      const payload = await response.json()

      if (!response.ok || payload.success === false) {
        // Server re-priced the plan; show the new figure and send the user back to review.
        if (response.status === 409 && payload?.code === 'PRICE_CHANGED' && Number.isFinite(Number(payload.amount))) {
          const nextAmount = Number(payload.amount)
          setAmount(String(nextAmount))
          showToast(payload.error || 'This plan\'s price changed. Please review and try again.', 'error')
          setPinVersion(current => current + 1)
          setStep('form')
          return
        }
        throw new Error(payload.error || 'Bill payment failed.')
      }

      await refreshSession()
      closeModal()
      setTimeout(() => {
        const txStatus = payload.data.transaction?.status
        setModalData({
          headline: txStatus === 'success' ? `${serviceName} Purchased!` : `${serviceName} Submitted`,
          body: txStatus === 'success'
            ? `₦${amt.toLocaleString()} ${serviceName} payment was successful.`
            : `₦${amt.toLocaleString()} ${serviceName} payment is being processed. We will update your transaction status shortly.`,
          ref: payload.data.transaction.reference || generateRef(),
        })
        openModal('success')
      }, 100)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Bill payment failed.', 'error')
      setPinVersion(current => current + 1)
      setStep('pin')
    }
  }

  async function handleBiometricApproval() {
    try {
      const approval = await createBiometricApproval()
      await confirm({
        amount: pendingRequest ? String(pendingRequest.amount) : amount,
        biometricApprovalToken: approval.token,
      })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Biometric approval failed.', 'error')
      setPinVersion(current => current + 1)
    }
  }

  async function handleNativeBiometricApproval() {
    const result = await confirmWithNativeBiometric({
      title: 'Confirm bill payment',
      subtitle: 'Use fingerprint or face instead of PIN',
    })
    if (!result.verified) {
      if (!result.cancelled) {
        showToast(result.message || 'Biometric verification failed.', 'error')
      }
      return
    }
    await confirm({
      amount: pendingRequest ? String(pendingRequest.amount) : amount,
      confirmWithBiometric: true,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={`Pay ${serviceName}`}>
      {step === 'form' ? (
      <div className="p-6 flex flex-col gap-4">
        {needsProvider && (
          <div>
            <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-[1px] mb-2">Network</div>
            <div className="grid grid-cols-4 gap-2">
              {orderedNetworkProviders.map(p => (
                <div key={p.name} onClick={() => {
                  setProvider(p.name)
                  if (isDataService) {
                    setSelectedBundleCode('')
                    setAmount('')
                    setSelectedDataBundleGroup('best_offers')
                    setSelectedPlanCategory(ALL_PLAN_CATEGORIES)
                  }
                  setTouched(current => ({ ...current, provider: true }))
                }}
                  className={`p-2.5 text-center border cursor-pointer transition-all ${provider === p.name ? 'bg-[rgba(79,70,229,.1)] border-[var(--gold)]' : 'bg-[var(--clay2)] border-[var(--border)]'} ${touched.provider && providerError && provider === p.name ? 'border-[var(--red)]' : ''}`}>
                  {p.icon.startsWith('/') ? (
                    <div className="mb-1 flex justify-center">
                      <Image src={p.icon} alt={p.name} width={36} height={36} className="h-9 w-9 object-contain" />
                    </div>
                  ) : (
                    <div className="text-lg mb-1">{p.icon}</div>
                  )}
                  <div className="text-[8px] font-bold text-[var(--text2)]">{p.name.split(' ')[0]}</div>
                </div>
              ))}
            </div>
            {touched.provider && providerError && <div className="text-[10px] text-[var(--red2)] mt-1">{providerError}</div>}
          </div>
        )}
        {needsAccount && !isDataService && (
          <div>
            <Input
              label={accountLabel}
              ref={formAccountInputRef}
              placeholder={accountPlaceholder}
              value={account}
              inputMode={isPhoneService ? 'tel' : undefined}
              suffix={isPhoneService ? 'PASTE' : undefined}
              onSuffixClick={isPhoneService ? () => void pasteAccount(formAccountInputRef) : undefined}
              onFocus={() => {
                if (isPhoneService && recentPhoneAccounts.length > 0) {
                  setShowRecentAccounts(true)
                }
              }}
              onChange={e => {
                setAccount(e.target.value)
                setTouched(current => ({ ...current, account: true }))
              }}
              onBlur={() => {
                globalThis.setTimeout(() => setShowRecentAccounts(false), 120)
                setTouched(current => ({ ...current, account: true }))
                if (isPhoneService) {
                  setAccount(current => normalizeNigerianPhoneNumber(current))
                }
              }}
              error={touched.account ? accountError ?? undefined : undefined}
            />
            {isPhoneService && showRecentAccounts && recentPhoneAccounts.length > 0 && (
              <div className="mt-2 border border-[var(--border)] bg-[var(--clay2)] p-2">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Numbers</div>
                <div className="space-y-1.5">
                  {recentPhoneAccounts.map(item => (
                    <button
                      key={`${serviceName}-${item.account}`}
                      type="button"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => {
                        setAccount(item.account)
                        if (item.provider) setProvider(item.provider)
                        setTouched(current => ({ ...current, account: true, provider: true }))
                        setShowRecentAccounts(false)
                      }}
                      className="flex w-full items-center justify-between gap-3 border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-left transition-all hover:border-[var(--gold2)] hover:bg-[var(--clay)]"
                    >
                      <span className="text-[11px] font-semibold text-[var(--text)]">{item.account}</span>
                      <span className="text-[9px] text-[var(--muted)]">{item.provider || 'Recent purchase'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {isPhoneService && detectedProviderName && !accountError && (
              <div className="text-[10px] text-[var(--muted)] mt-1">Detected network: {detectedProviderName}</div>
            )}
          </div>
        )}
        {isDataService ? (
          <div>
            <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-[1px] mb-2">Select Data Plan</div>
            {showPlanCategoryPicker && (
              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                {[ALL_PLAN_CATEGORIES, ...planCategories].map(category => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setSelectedPlanCategory(category)}
                    className={`shrink-0 border px-3 py-2 text-[9px] font-bold uppercase tracking-[0.8px] transition-all ${
                      activePlanCategory === category
                        ? 'border-[var(--gold)] bg-[rgba(79,70,229,.1)] text-[var(--gold2)]'
                        : 'border-[var(--border)] bg-[var(--clay2)] text-[var(--muted)]'
                    }`}
                  >
                    {formatPlanCategoryLabel(category)}
                  </button>
                ))}
              </div>
            )}
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
              {groupedDataBundles.map(group => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setSelectedDataBundleGroup(group.key)}
                  className={`shrink-0 border px-3 py-2 text-[9px] font-bold uppercase tracking-[0.8px] transition-all ${
                    activeDataBundleGroup?.key === group.key
                      ? 'border-[var(--gold)] bg-[rgba(79,70,229,.1)] text-[var(--gold2)]'
                      : 'border-[var(--border)] bg-[var(--clay2)] text-[var(--muted)]'
                  }`}
                >
                  {group.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {shownDataBundles.map(bundle => {
                const subtitle = getDataBundleSubtitle(bundle)
                const validityDisplay = bundle.validity
                const specialContext = activeDataBundleGroup?.key === 'special' ? getSpecialBundleContext(bundle) : null
                const priceHint = getPriceHintVsFlutterwave(bundle, dataBundles)
                // Under a specific category every card shares it, so the label only earns space
                // on All, where two same-size plans can differ only by category.
                const categoryLabel = showPlanCategoryPicker && activePlanCategory === ALL_PLAN_CATEGORIES
                  ? formatPlanCategoryLabel(getPlanCategory(bundle))
                  : null
                return (
                  <button
                    key={`${provider}-${bundle.itemCode}`}
                          onClick={() => {
                            setAmount(String(bundle.amount))
                            setSelectedBundleCode(bundle.itemCode)
                            setTouched(current => ({ ...current, amount: true }))
                            // The number is collected on the next screen, so a plan tap no longer
                            // has enough to submit -- it advances instead of confirming.
                            setShowRecentAccounts(false)
                            setStep('phone')
                          }}
                          className={`border p-3 text-left transition-all ${
                            selectedBundleCode === bundle.itemCode
                        ? 'border-[var(--gold)] bg-[rgba(79,70,229,.1)]'
                        : 'border-[var(--border)] bg-[var(--clay2)] hover:border-[var(--gold2)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <div className="text-[12px] font-bold text-[var(--text)]">
                            {bundle.label}
                            {validityDisplay ? ` - ${validityDisplay}` : ''}
                          </div>
                        </div>
                      </div>
                      {bundle.provider === 'amigo' && (
                        <div className="shrink-0 rounded-full border border-emerald-500 bg-emerald-500 px-2 py-0.5 text-[7px] font-bold uppercase tracking-[0.8px] text-white shadow-[0_6px_18px_rgba(34,197,94,.22)]">
                          Amigo
                        </div>
                      )}
                      {bundle.provider === 'asbdata' && (
                        <div className="shrink-0 rounded-full border border-blue-500 bg-blue-500 px-2 py-0.5 text-[7px] font-bold uppercase tracking-[0.8px] text-white shadow-[0_6px_18px_rgba(59,130,246,.22)]">
                          ASBData
                        </div>
                      )}
                    </div>
                    {categoryLabel && (
                      <div className="mt-1 text-[8px] font-bold uppercase tracking-[0.8px] text-[var(--muted)]">{categoryLabel}</div>
                    )}
                    {subtitle && (
                      <div className="mt-1 text-[9px] text-[var(--muted)]">{subtitle}</div>
                    )}
                    {priceHint && (
                      <div className="mt-1 text-[9px] font-semibold text-emerald-300">
                        Save ₦{priceHint.savings.toLocaleString('en-NG')} vs Flutterwave
                        {priceHint.savingsPercent > 0 ? ` · ${priceHint.savingsPercent}% lower` : ''}
                      </div>
                    )}
                    {specialContext && (
                      <div className="mt-1 text-[9px] text-[var(--muted)]">{specialContext}</div>
                    )}
                    <div className="mt-1 text-[10px] font-semibold text-[var(--gold2)]">₦{bundle.amount.toLocaleString('en-NG')}</div>
                  </button>
                )
              })}
            </div>
            {activeDataBundleGroup?.key === 'special' && (
              <div className="mt-2 text-[10px] text-[var(--muted)]">
                Some special plans do not include an explicit expiry in the provider catalog. We only show validity when the network states it.
              </div>
            )}
            {touched.amount && amountError && <div className="text-[10px] text-[var(--red2)] mt-1">{amountError}</div>}
          </div>
        ) : isPackageBillService ? (
          <div className="space-y-4">
            <div>
              <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-[1px] mb-2">Biller</div>
              <div className="grid grid-cols-2 gap-2">
                {packageBillers.map(biller => (
                  <button
                    key={biller.billerCode}
                    type="button"
                    onClick={() => {
                      setSelectedBillerCode(biller.billerCode)
                      setSelectedBundleCode('')
                      setAmount('')
                      setTouched(current => ({ ...current, amount: true }))
                    }}
                    className={`border p-2 transition-all ${
                      selectedPackageBiller?.billerCode === biller.billerCode
                        ? 'border-[var(--gold)] bg-[rgba(79,70,229,.1)]'
                        : 'border-[var(--border)] bg-[var(--clay2)] hover:border-[var(--gold2)]'
                    }`}
                  >
                    {getBillerLogo(biller.name) ? (
                      <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded-lg bg-[rgba(255,255,255,.02)]">
                        <Image
                          src={getBillerLogo(biller.name)!}
                          alt={`${biller.name} logo`}
                          width={160}
                          height={64}
                          className="h-full w-full object-contain"
                        />
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            {selectedPackageBiller && (
              <div>
                <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-[1px] mb-2">Package</div>
                <div className="grid grid-cols-2 gap-2">
                  {selectedPackageBiller.items.map(item => (
                    <button
                      key={`${selectedPackageBiller.billerCode}-${item.itemCode}`}
                      type="button"
                      onClick={() => {
                        setSelectedBundleCode(item.itemCode)
                        setAmount(item.amount > 0 && !isElectricService ? String(item.amount) : '')
                        setTouched(current => ({ ...current, amount: true }))
                      }}
                      className={`border p-3 text-left transition-all ${
                        selectedBundleCode === item.itemCode
                          ? 'border-[var(--gold)] bg-[rgba(79,70,229,.1)]'
                          : 'border-[var(--border)] bg-[var(--clay2)] hover:border-[var(--gold2)]'
                      }`}
                    >
                      <div className="text-[11px] font-bold text-[var(--text)]">{item.label}</div>
                      <div className="mt-1 text-[10px] font-semibold text-[var(--gold2)]">
                        {item.amount > 0 && !isElectricService ? `₦${item.amount.toLocaleString('en-NG')}` : 'Enter amount'}
                      </div>
                    </button>
                  ))}
                </div>
                {(isElectricService || (selectedPackageItem && selectedPackageItem.amount <= 0)) && (
                  <div className="mt-3">
                    <Input
                      prefix="₦"
                      type="number"
                      placeholder="Enter amount"
                      value={amount}
                      onChange={e => {
                        setAmount(e.target.value)
                        setTouched(current => ({ ...current, amount: true }))
                      }}
                      onBlur={() => setTouched(current => ({ ...current, amount: true }))}
                      error={touched.amount ? amountError ?? undefined : undefined}
                      className="text-lg font-bold font-display"
                    />
                  </div>
                )}
                {touched.amount && amountError && <div className="text-[10px] text-[var(--red2)] mt-1">{amountError}</div>}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-[1px] mb-2">Amount (NGN)</div>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {amts.map(q => (
                <button key={q} onClick={() => {
                  setAmount(String(q))
                  setTouched(current => ({ ...current, amount: true }))
                }}
                  className="py-2 bg-[var(--clay2)] border border-[var(--border)] text-[var(--text2)] text-[10px] font-bold cursor-pointer hover:border-[var(--gold2)] transition-all">
                  ₦{q >= 1000 ? q/1000+'k' : q}
                </button>
              ))}
            </div>
            <Input
              prefix="₦"
              type="number"
              placeholder="Enter amount"
              value={amount}
              onChange={e => {
                setAmount(e.target.value)
                setTouched(current => ({ ...current, amount: true }))
              }}
              onBlur={() => setTouched(current => ({ ...current, amount: true }))}
              error={touched.amount ? amountError ?? undefined : undefined}
              className="text-lg font-bold font-display"
            />
          </div>
        )}
        {!isDataService && <Button onClick={() => void confirm()} className="w-full py-3.5">Pay {serviceName} →</Button>}
      </div>
      ) : step === 'phone' ? (
        <div className="p-6 flex flex-col gap-4">
          <div className="border border-[var(--border)] bg-[var(--clay2)] p-3">
            <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Selected plan</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <div className="text-[13px] font-bold text-[var(--text)]">
                {selectedDataBundle?.label}
                {selectedDataBundle?.validity ? ` · ${selectedDataBundle.validity}` : ''}
              </div>
              <div className="text-[12px] font-semibold text-[var(--gold2)]">
                ₦{Number(selectedDataBundle?.amount ?? 0).toLocaleString('en-NG')}
              </div>
            </div>
            <div className="mt-0.5 text-[9px] text-[var(--muted)]">{provider}</div>
          </div>

          <div>
            <Input
              label={accountLabel}
              ref={phoneAccountInputRef}
              placeholder={accountPlaceholder}
              value={account}
              inputMode="tel"
              autoFocus
              suffix="PASTE"
              onSuffixClick={() => void pasteAccount(phoneAccountInputRef)}
              onFocus={() => {
                if (recentPhoneAccounts.length > 0) setShowRecentAccounts(true)
              }}
              onChange={e => {
                setAccount(e.target.value)
                setTouched(current => ({ ...current, account: true }))
              }}
              onBlur={() => {
                globalThis.setTimeout(() => setShowRecentAccounts(false), 120)
                setTouched(current => ({ ...current, account: true }))
                setAccount(current => normalizeNigerianPhoneNumber(current))
              }}
              error={touched.account ? accountError ?? undefined : undefined}
            />
            {showRecentAccounts && recentPhoneAccounts.length > 0 && (
              <div className="mt-2 border border-[var(--border)] bg-[var(--clay2)] p-2">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Numbers</div>
                <div className="space-y-1.5">
                  {recentPhoneAccounts.map(item => (
                    <button
                      key={`${serviceName}-phone-${item.account}`}
                      type="button"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => {
                        setAccount(item.account)
                        setTouched(current => ({ ...current, account: true }))
                        setShowRecentAccounts(false)
                      }}
                      className="flex w-full items-center justify-between gap-3 border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-left transition-all hover:border-[var(--gold2)] hover:bg-[var(--clay)]"
                    >
                      <span className="text-[11px] font-semibold text-[var(--text)]">{item.account}</span>
                      <span className="text-[9px] text-[var(--muted)]">{item.provider || 'Recent purchase'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* The network was chosen before the number, so a mismatch is caught here rather than
                silently switching the plan list. Going back keeps the number already typed. */}
            {detectedProviderName && detectedProviderName !== provider && (
              <div className="mt-2 border border-[var(--red)] bg-[rgba(220,38,38,.08)] p-2.5">
                <div className="text-[10px] font-semibold text-[var(--red2)]">
                  This number looks like {detectedProviderName}, but you picked {provider}.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProvider(detectedProviderName)
                    setSelectedBundleCode('')
                    setAmount('')
                    setSelectedDataBundleGroup('best_offers')
                    setSelectedPlanCategory(ALL_PLAN_CATEGORIES)
                    setStep('form')
                  }}
                  className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.8px] text-[var(--gold2)] underline"
                >
                  Switch to {detectedProviderName} plans
                </button>
              </div>
            )}
            {detectedProviderName && detectedProviderName === provider && !accountError && (
              <div className="mt-1 text-[10px] text-[var(--muted)]">Detected network: {detectedProviderName}</div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowRecentAccounts(false)
                setStep('form')
              }}
              className="shrink-0 border border-[var(--border)] bg-[var(--clay2)] px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--text2)] transition-all hover:border-[var(--gold2)]"
            >
              Back
            </button>
            <Button onClick={() => void confirm()} className="flex-1 py-3.5">
              Continue →
            </Button>
          </div>
        </div>
      ) : (
        <PinPad
          key={pinVersion}
          onComplete={(pin) => void confirm({
            amount: pendingRequest ? String(pendingRequest.amount) : amount,
            transactionPin: pin,
          })}
          title={nativeTransactionBiometricEnabled ? 'PIN or biometrics' : 'Confirm Transaction PIN'}
          subtitle="Check the details, then enter your PIN to pay."
          details={[
            { label: 'Service', value: serviceName },
            ...(needsProvider ? [{ label: 'Network', value: provider }] : []),
            ...(needsAccount && account ? [{ label: 'Recipient', value: account }] : []),
            {
              label: 'Amount',
              value: `₦${Number(pendingRequest?.amount ?? amount ?? 0).toLocaleString('en-NG')}`,
              emphasis: true,
            },
          ]}
          footer={(
            <button
              type="button"
              onClick={() => setStep('form')}
              className="text-[10px] font-bold uppercase tracking-[.8px] text-[var(--gold2)] underline"
            >
              ← Edit payment
            </button>
          )}
          secondaryActionLabel={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? 'Use passkey' : undefined}
          secondaryActionIconOnly
          onSecondaryAction={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? () => void handleBiometricApproval() : undefined}
          onBiometric={nativeTransactionBiometricEnabled ? () => void handleNativeBiometricApproval() : undefined}
          biometricBusy={nativeBiometricBusy}
        />
      )}
    </Modal>
  )
}
