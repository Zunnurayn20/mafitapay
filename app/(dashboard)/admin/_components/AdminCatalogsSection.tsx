'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { Modal } from '@/components/ui/Modal'
import {
  Callout,
  Disclosure,
  FieldGrid,
  FormSection,
  MoneyField,
  NumberField,
  RatePreview,
  ReadOnlyField,
  SelectField,
  TextField,
  ToggleField,
} from '@/components/admin/AdminForm'
import { computeBuyRate, computeSellRate, DEFAULT_USD_MARGIN_NGN, getDefaultCryptoMarketSourceId, impliedUsdNgn } from '@/lib/crypto-market'
import { CONTRACT_LOOKUP_NETWORKS, isContractLookupNetwork } from '@/lib/crypto-contract-lookup'
import { getDefaultNetworkFeeNgn } from '@/lib/crypto-rules'
import { buildCryptoPairId, findRoutedTreasuryPairId } from '@/lib/routed-assets'
import type { CryptoAsset } from '@/types'
import type { AdminSubmodule } from '../admin-config'
import type { AdminWorkspaceState } from '../useAdminWorkspace'

function formatNgn(value: number) {
  return `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
}

function pricingPreview(asset: Pick<CryptoAsset, 'marketPriceUsd' | 'marketRate' | 'buyMarginNgnPerUsd' | 'sellMarginNgnPerUsd' | 'buyRate' | 'sellRate' | 'symbol'>) {
  const usd = asset.marketPriceUsd ?? 0
  const mid = asset.marketRate
  const usdNgn = impliedUsdNgn(usd, mid)
  const buyMargin = asset.buyMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN
  const sellMargin = asset.sellMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN
  return {
    usdNgn,
    buyFx: usdNgn > 0 ? usdNgn + buyMargin : 0,
    sellFx: usdNgn > 0 ? Math.max(0, usdNgn - sellMargin) : 0,
    buyRate: asset.buyRate || computeBuyRate(usd, mid, buyMargin),
    sellRate: asset.sellRate || computeSellRate(usd, mid, sellMargin),
    asymmetric: Math.abs(buyMargin - sellMargin) > 0.009,
  }
}

export function AdminCatalogsSection({ workspace, submodule }: { workspace: AdminWorkspaceState; submodule?: AdminSubmodule }) {
  const [showNewAssetForm, setShowNewAssetForm] = useState(false)
  const [showNewAssetAdvanced, setShowNewAssetAdvanced] = useState(false)
  const [showEditorAdvanced, setShowEditorAdvanced] = useState(false)
  const [selectedCryptoAssetId, setSelectedCryptoAssetId] = useState<string | null>(null)
  const [showNewRewardRuleForm, setShowNewRewardRuleForm] = useState(false)
  const [selectedRewardRuleId, setSelectedRewardRuleId] = useState<string | null>(null)
  const [showNewBillProviderForm, setShowNewBillProviderForm] = useState(false)
  const [selectedBillProviderId, setSelectedBillProviderId] = useState<string | null>(null)
  const {
    CRYPTO_NETWORK_OPTIONS,
    CRYPTO_EXECUTION_RAIL_OPTIONS,
    ROUTED_ADDRESS_FAMILY_OPTIONS,
    ROUTED_PROFILE_OPTIONS,
    REWARD_KIND_OPTIONS,
    REWARD_TRIGGER_OPTIONS,
    REWARD_AUDIENCE_OPTIONS,
    REWARD_TRANSACTION_TYPE_OPTIONS,
    BILL_PROVIDER_TYPES,
    CRYPTO_LOGO_SUGGESTIONS,
    BILL_ICON_SUGGESTIONS,
    ADMIN_ENDPOINTS,
    cryptoCatalogFilter,
    setCryptoCatalogFilter,
    saveCryptoPricing,
    savingCryptoPricing,
    saveCryptoPair,
    savingCryptoPairId,
    discardCryptoPairEdits,
    dirtyCryptoPairIds,
    dirtyCryptoPairIdSet,
    hasUnsavedCryptoEdits,
    newCryptoAsset,
    setNewCryptoAsset,
    applyNewAssetRoutedProfile,
    getRoutedProfileConfig,
    draftMarketRatePreview,
    draftMarketPriceUsdPreview,
    createCryptoPair,
    uploadCryptoLogo,
    uploadingCryptoLogoId,
    contractLookupAddress,
    setContractLookupAddress,
    lookingUpContract,
    contractLookup,
    lookupCryptoToken,
    resetContractLookup,
    primeNewCryptoAssetDefaults,
    visibleCryptoPricing,
    setCryptoPricing,
    setCryptoPairArchived,
    customRoutedProfileIds,
    setCustomRoutedProfileIds,
    findRoutedProfileForAsset,
    parseOptionalNumber,
    renderPricingSourceLabel,
    rewardRuleReport,
    reviewingRewardRequestId,
    reviewRewardRequest,
    newRewardRule,
    setNewRewardRule,
    toggleRewardTransactionType,
    addRewardRuleDraft,
    rewardRules,
    setRewardRules,
    saveRewardRuleCatalog,
    savingRewardRules,
    billCatalogFilter,
    setBillCatalogFilter,
    newBillProvider,
    setNewBillProvider,
    addBillProviderDraft,
    visibleBillProviders,
    setBillProviderCatalog,
    setBillProviderArchived,
    saveBillProviderCatalog,
    savingBillProviders,
    drafts,
    setDrafts,
    saveConfig,
    saving,
  } = workspace
  const showAssets = !submodule || submodule === 'assets'
  const showRewards = !submodule || submodule === 'rewards'
  const showBills = !submodule || submodule === 'bills'
  const showRaw = !submodule || submodule === 'raw'
  const selectedCryptoAsset = visibleCryptoPricing.find(item => item.id === selectedCryptoAssetId) ?? null
  const selectedRewardRule = rewardRules.find(rule => rule.id === selectedRewardRuleId) ?? null
  const selectedBillProvider = visibleBillProviders.find(provider => provider.id === selectedBillProviderId) ?? null

  // Same three numbers, same maths as the editor — pricingPreview() is the single source so the
  // create and edit paths cannot drift apart.
  const draftPreview = pricingPreview({
    marketPriceUsd: draftMarketPriceUsdPreview,
    marketRate: draftMarketRatePreview,
    buyMarginNgnPerUsd: newCryptoAsset.buyMarginNgnPerUsd,
    sellMarginNgnPerUsd: newCryptoAsset.sellMarginNgnPerUsd,
    buyRate: 0,
    sellRate: 0,
    symbol: newCryptoAsset.symbol,
  })
  const draftRoutedPreset = newCryptoAsset.routedProfile && newCryptoAsset.routedProfile !== 'custom'
    ? getRoutedProfileConfig(newCryptoAsset.routedProfile)
    : null
  const draftAdvancedSummary = newCryptoAsset.executionRail === 'routed_treasury'
    ? draftRoutedPreset
      ? `Routing filled in from the ${draftRoutedPreset.symbol} on ${draftRoutedPreset.network} preset`
      : 'Custom routing — chain, token and decimals set by hand'
    : 'Price feed, quote validity, execution rail, separate buy/sell margins'

  /**
   * A coin and network we already ship a routed treasury preset for needs no technical input: the
   * chain, token, decimals and address family all come from the preset. Only steps aside when the
   * operator has deliberately chosen custom routing.
   */
  function syncRoutedPresetFor(symbol: string, network: CryptoAsset['network']) {
    if (newCryptoAsset.routedProfile === 'custom') return
    const presetId = findRoutedTreasuryPairId(symbol, network)
    if (presetId) {
      applyNewAssetRoutedProfile(presetId)
      return
    }
    // No preset covers this combination, so drop routing copied from a previously matched preset
    // rather than letting it be saved against a pair it does not describe.
    if (newCryptoAsset.routedProfile) {
      setNewCryptoAsset(current => ({
        ...current,
        executionRail: '',
        routedProfile: '',
        routedToChain: '',
        routedToToken: '',
        routedDecimals: '',
        routedAddressFamily: '',
        minimumBuyNgn: '',
        maxQuoteDriftPercent: '',
      }))
    }
  }

  function openNewAssetForm() {
    // Seed the house margin on open rather than at mount, so it reflects the catalog as loaded.
    primeNewCryptoAssetDefaults()
    setShowNewAssetForm(true)
  }

  function closeNewAssetForm() {
    setShowNewAssetForm(false)
    setShowNewAssetAdvanced(false)
    resetContractLookup()
  }

  const selectedPairDirty = selectedCryptoAssetId ? dirtyCryptoPairIdSet.has(selectedCryptoAssetId) : false

  function closeCryptoEditor() {
    setSelectedCryptoAssetId(null)
    setShowEditorAdvanced(false)
  }

  async function saveSelectedCryptoPair(pairId: string) {
    // Only leave the editor once the server has confirmed, so a failed save keeps the operator in
    // front of their own edits instead of dropping them back to the grid.
    if (await saveCryptoPair(pairId)) closeCryptoEditor()
  }

  function discardSelectedCryptoPair(pairId: string) {
    discardCryptoPairEdits(pairId)
    closeCryptoEditor()
  }

  return (
    <>
      {!submodule && <Card className="p-6">
        <div className="text-[11px] font-bold text-[var(--text)]">Catalog Admin</div>
        <div className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
          Use the structured crypto pair form for token listings. Raw JSON is still available for the other catalogs.
        </div>
      </Card>}

      {showAssets && <Card className="p-5">
        <div className="mb-3 rounded-lg border border-[rgba(202,165,96,.25)] bg-[rgba(202,165,96,.06)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text)]">
          <strong className="text-[var(--gold2)]">How pricing works:</strong> the app loads the live dollar price of the coin,
          then adds <strong>your profit</strong> on every dollar (e.g. live ₦1500 + profit ₦50 = customers buy at ₦1550 per $1).
          A small <strong>network fee</strong> covers blockchain gas. Change those two numbers, then press Save.
        </div>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-bold text-[var(--text)]">Crypto Pricing Control</div>
            <div className="mt-1 text-[10px] text-[var(--muted)]">Manage per-pair market rates, spreads, quote TTL, and activation without editing raw JSON.</div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1">
              {(['all', 'active', 'archived'] as const).map(filter => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setCryptoCatalogFilter(filter)}
                  className={`px-2.5 py-1.5 text-[10px] font-bold border transition-all ${
                    cryptoCatalogFilter === filter
                      ? 'border-[var(--gold)] text-[var(--gold2)] bg-[rgba(79,70,229,.08)]'
                      : 'border-[var(--border)] text-[var(--text2)] bg-[var(--clay)] hover:border-[var(--border2)]'
                  }`}
                >
                  {filter === 'all' ? 'All' : filter === 'active' ? 'Active' : 'Archived'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={showNewAssetForm ? 'secondary' : 'primary'}
                onClick={() => (showNewAssetForm ? closeNewAssetForm() : openNewAssetForm())}
              >
                {showNewAssetForm ? 'Close New Pair' : 'New Pair'}
              </Button>
              {hasUnsavedCryptoEdits && (
                <Button onClick={() => void saveCryptoPricing()} disabled={savingCryptoPricing}>
                  {savingCryptoPricing
                    ? 'Saving…'
                    : `Save ${dirtyCryptoPairIds.length} unsaved change${dirtyCryptoPairIds.length === 1 ? '' : 's'}`}
                </Button>
              )}
            </div>
          </div>
        </div>
        {!showNewAssetForm && (
          <div className="mb-5 border border-[var(--border)] bg-[var(--coal)] px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[11px] font-bold text-[var(--text)]">Add Crypto Pair</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">Open the pair form only when you need to create a new executable or catalog asset.</div>
              </div>
              <Button onClick={openNewAssetForm}>Open Pair Form</Button>
            </div>
          </div>
        )}
        {showNewAssetForm && <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--coal)] p-5">
          <div className="mb-5">
            <div className="text-sm font-bold text-[var(--text)]">Add crypto pair</div>
            <div className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
              Set the coin, your profit per dollar, and a network fee. When we recognise the pair the
              technical routing fills itself in; anything left over stays under Advanced.
            </div>
          </div>
          <div className="space-y-5">
          <FormSection
            title="Start from the contract address"
            description="Paste the token's contract address and the symbol, name, decimals, price feed and logo fill themselves in — and we check the coin is one we can actually price before you can trade it. Native coins like BNB or ETH have no contract address; pick their routed preset under Advanced instead."
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <SelectField
                label="Chain"
                className="sm:w-52"
                value={isContractLookupNetwork(newCryptoAsset.network) ? newCryptoAsset.network : ''}
                onChange={event => {
                  const network = event.target.value as CryptoAsset['network']
                  if (!network) return
                  setNewCryptoAsset(current => ({ ...current, network }))
                  syncRoutedPresetFor(newCryptoAsset.symbol.trim().toUpperCase(), network)
                }}
                hint="EVM chains only."
              >
                <option value="">Select chain</option>
                {CONTRACT_LOOKUP_NETWORKS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </SelectField>
              <TextField
                label="Contract address"
                className="flex-1"
                value={contractLookupAddress}
                onChange={event => setContractLookupAddress(event.target.value)}
                placeholder="0x0000000000000000000000000000000000000000"
                hint={isContractLookupNetwork(newCryptoAsset.network)
                  ? 'Copy it from the block explorer, then press Look up.'
                  : `${newCryptoAsset.network} stores token details differently, so those pairs are filled in by hand below.`}
              />
              <div className="sm:pt-[26px]">
                <Button
                  onClick={() => void lookupCryptoToken(newCryptoAsset.network, contractLookupAddress)}
                  disabled={lookingUpContract || !isContractLookupNetwork(newCryptoAsset.network) || !contractLookupAddress.trim()}
                >
                  {lookingUpContract ? 'Looking up…' : 'Look up'}
                </Button>
              </div>
            </div>
            {contractLookup && (
              <div className="mt-4 space-y-3">
                <Callout
                  tone={contractLookup.verification === 'verified'
                    ? 'info'
                    : contractLookup.verification === 'unlisted' ? 'danger' : 'warn'}
                >
                  <strong>
                    {contractLookup.verification === 'verified'
                      ? 'Verified'
                      : contractLookup.verification === 'unlisted' ? 'Not listed' : 'Unconfirmed'}
                    :
                  </strong>{' '}
                  {contractLookup.verificationMessage}
                  {contractLookup.priceUsd != null && (
                    <> Live price ${contractLookup.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 6 })}.</>
                  )}
                </Callout>
                {contractLookup.warnings.length > 0 && (
                  <Callout tone="warn">
                    <ul className="list-disc space-y-1 pl-4">
                      {contractLookup.warnings.map(warning => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </Callout>
                )}
                <FieldGrid columns={4}>
                  <ReadOnlyField label="Chain ID" value={contractLookup.chainId} />
                  <ReadOnlyField label="Decimals" value={contractLookup.decimals ?? 'Unknown'} />
                  <ReadOnlyField label="Price feed" value={contractLookup.marketSourceId || 'None'} mono={false} />
                  <ReadOnlyField label="Token address" value={contractLookup.address} />
                </FieldGrid>
              </div>
            )}
          </FormSection>

          <FormSection title="Coin" description="What customers see in the app.">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <AssetLogo
                  src={newCryptoAsset.icon}
                  alt={`${newCryptoAsset.symbol || 'Asset'} logo preview`}
                  fallback={(newCryptoAsset.symbol || 'A').slice(0, 1)}
                  className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--clay)]"
                  imgClassName="h-10 w-10 object-contain"
                  textClassName="text-xl font-bold text-[var(--gold2)]"
                />
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition-colors hover:border-[var(--gold2)]">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={event => {
                      const file = event.target.files?.[0]
                      if (file) void uploadCryptoLogo(file, { draft: true, symbol: newCryptoAsset.symbol.trim().toUpperCase() })
                      event.currentTarget.value = ''
                    }}
                  />
                  {uploadingCryptoLogoId === 'draft' ? 'Uploading…' : 'Upload logo'}
                </label>
              </div>
              <FieldGrid columns={3} className="flex-1">
                <TextField
                  label="Symbol"
                  required
                  value={newCryptoAsset.symbol}
                  onChange={event => {
                    const raw = event.target.value
                    const symbol = raw.toUpperCase()
                    setNewCryptoAsset(current => ({
                      ...current,
                      symbol,
                      marketSourceId: current.marketSourceId || getDefaultCryptoMarketSourceId(raw),
                      icon: current.icon || CRYPTO_LOGO_SUGGESTIONS[symbol] || '',
                    }))
                    syncRoutedPresetFor(symbol, newCryptoAsset.network)
                  }}
                  placeholder="USDT"
                  hint="Logo and price feed fill in automatically for coins we know."
                />
                <TextField
                  label="Asset name"
                  required
                  value={newCryptoAsset.name}
                  onChange={event => setNewCryptoAsset(current => ({ ...current, name: event.target.value }))}
                  placeholder="Tether USD"
                />
                <SelectField
                  label="Network"
                  value={newCryptoAsset.network}
                  onChange={event => {
                    const network = event.target.value as CryptoAsset['network']
                    setNewCryptoAsset(current => ({ ...current, network }))
                    syncRoutedPresetFor(newCryptoAsset.symbol.trim().toUpperCase(), network)
                  }}
                >
                  {CRYPTO_NETWORK_OPTIONS.map((option: string) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </SelectField>
              </FieldGrid>
            </div>
          </FormSection>

          <FormSection title="Your pricing" description="The two numbers you change day to day.">
            <FieldGrid columns={2}>
              <MoneyField
                label="Your profit per $1"
                min={0}
                step="1"
                value={newCryptoAsset.buyMarginNgnPerUsd}
                onChange={event => {
                  const margin = Math.max(0, Number(event.target.value) || 0)
                  setNewCryptoAsset(current => ({
                    ...current,
                    buyMarginNgnPerUsd: margin,
                    sellMarginNgnPerUsd: margin,
                  }))
                }}
                hint="Live dollar rate ₦1,500 + profit ₦50 → customers buy at ₦1,550 per $1."
              />
              <MoneyField
                label="Network fee per order"
                min={0}
                step="1"
                value={newCryptoAsset.buyNetworkFeeNgn}
                onChange={event => {
                  const raw = event.target.value
                  const buyFee = raw.trim() === '' ? '' : String(Math.max(0, Number(raw) || 0))
                  setNewCryptoAsset(current => ({
                    ...current,
                    buyNetworkFeeNgn: buyFee,
                    sellNetworkFeeNgn: '0',
                  }))
                }}
                placeholder="Automatic"
                hint="Covers on-chain gas. Leave blank to use a safe default for this network."
              />
            </FieldGrid>
            {(draftMarketRatePreview > 0 || draftMarketPriceUsdPreview > 0) && (
              <RatePreview
                className="mt-4"
                usdNgn={draftPreview.usdNgn}
                buyFx={draftPreview.buyFx}
                sellFx={draftPreview.sellFx}
                note={draftPreview.asymmetric
                  ? 'Buy and sell profit are currently different. Open Advanced to edit them separately, or change “Your profit per $1” to set both equal.'
                  : undefined}
              />
            )}
          </FormSection>

          <FormSection title="Availability">
            <ToggleField
              label="Show this pair to customers"
              hint="Turn this off to create the pair without exposing it in the app yet."
              checked={newCryptoAsset.isActive}
              onChange={checked => setNewCryptoAsset(current => ({ ...current, isActive: checked }))}
            />
          </FormSection>
          <Disclosure
            open={showNewAssetAdvanced}
            onToggle={() => setShowNewAssetAdvanced(current => !current)}
            title="Advanced (optional)"
            summary={draftAdvancedSummary}
          >
            <div className="space-y-4">
              <FieldGrid columns={3}>
                <TextField
                  label="Live price feed ID"
                  value={newCryptoAsset.marketSourceId}
                  onChange={event => setNewCryptoAsset(current => ({ ...current, marketSourceId: event.target.value }))}
                  placeholder="tether, usd-coin, ethereum…"
                  hint="Filled in from the symbol. Change it only if the feed uses a different id."
                />
                <NumberField
                  label="Quote validity (seconds)"
                  min={30}
                  value={newCryptoAsset.quoteTtlSeconds}
                  onChange={event => setNewCryptoAsset(current => ({ ...current, quoteTtlSeconds: Number(event.target.value) }))}
                  hint="How long a customer’s quoted rate stays honoured."
                />
                <SelectField
                  label="Execution rail"
                  value={newCryptoAsset.executionRail}
                  onChange={event => setNewCryptoAsset(current => {
                    const nextRail = event.target.value as typeof current.executionRail
                    if (nextRail !== 'routed_treasury') {
                      return {
                        ...current,
                        executionRail: nextRail,
                        routedProfile: '',
                        routedToChain: '',
                        routedToToken: '',
                        routedDecimals: '',
                        routedAddressFamily: '',
                        minimumBuyNgn: '',
                        maxQuoteDriftPercent: '',
                      }
                    }
                    return { ...current, executionRail: nextRail }
                  })}
                  hint="Catalog Only lists the coin without trading it in-app."
                >
                  {CRYPTO_EXECUTION_RAIL_OPTIONS.map(option => (
                    <option key={option.value || 'none'} value={option.value}>{option.label}</option>
                  ))}
                </SelectField>
                <MoneyField
                  label="Buy profit only (per $1)"
                  min={0}
                  step="0.01"
                  value={newCryptoAsset.buyMarginNgnPerUsd}
                  onChange={event => setNewCryptoAsset(current => ({ ...current, buyMarginNgnPerUsd: Number(event.target.value) }))}
                />
                <MoneyField
                  label="Sell profit only (per $1)"
                  min={0}
                  step="0.01"
                  value={newCryptoAsset.sellMarginNgnPerUsd}
                  onChange={event => setNewCryptoAsset(current => ({ ...current, sellMarginNgnPerUsd: Number(event.target.value) }))}
                />
                <MoneyField
                  label="Buy network fee only"
                  min={0}
                  step="0.01"
                  value={newCryptoAsset.buyNetworkFeeNgn}
                  onChange={event => setNewCryptoAsset(current => ({ ...current, buyNetworkFeeNgn: event.target.value }))}
                />
                <TextField
                  label="Logo path or URL"
                  className="sm:col-span-2 lg:col-span-3"
                  value={newCryptoAsset.icon}
                  onChange={event => setNewCryptoAsset(current => ({ ...current, icon: event.target.value }))}
                  placeholder="/crypto-assets/usdt.png or https://…"
                  hint="Only needed if you are not uploading a file above."
                />
              </FieldGrid>
              <ToggleField
                label="In-app treasury trading enabled"
                checked={newCryptoAsset.baseExecutionEnabled}
                onChange={checked => setNewCryptoAsset(current => ({ ...current, baseExecutionEnabled: checked }))}
              />
              {newCryptoAsset.executionRail === 'routed_treasury' && (
                <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--coal)] p-4">
                  <SelectField
                    label="Routed profile"
                    value={newCryptoAsset.routedProfile}
                    onChange={event => applyNewAssetRoutedProfile(event.target.value)}
                    className="sm:max-w-sm"
                    hint="Presets carry the chain, token and decimals so you never type them."
                  >
                    <option value="">Select profile</option>
                    {ROUTED_PROFILE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                    <option value="custom">Custom</option>
                  </SelectField>
                  {draftRoutedPreset && (
                    <Callout>
                      Routed via chain <strong>{draftRoutedPreset.toChain}</strong> · token{' '}
                      <span className="font-mono">{draftRoutedPreset.toToken}</span> ·{' '}
                      <strong>{draftRoutedPreset.decimals}</strong> decimals
                    </Callout>
                  )}
                  {newCryptoAsset.routedProfile === 'custom' && (
                    <FieldGrid columns={3}>
                      <TextField
                        label="Routed chain ID"
                        value={newCryptoAsset.routedToChain}
                        onChange={event => setNewCryptoAsset(current => ({ ...current, routedToChain: event.target.value, routedProfile: 'custom' }))}
                        placeholder="42161"
                      />
                      <TextField
                        label="Routed token address"
                        value={newCryptoAsset.routedToToken}
                        onChange={event => setNewCryptoAsset(current => ({ ...current, routedToToken: event.target.value, routedProfile: 'custom' }))}
                        placeholder="0x0000000000000000000000000000000000000000"
                      />
                      <NumberField
                        label="Routed decimals"
                        min={0}
                        value={newCryptoAsset.routedDecimals}
                        onChange={event => setNewCryptoAsset(current => ({ ...current, routedDecimals: event.target.value, routedProfile: 'custom' }))}
                        placeholder="18"
                      />
                      <SelectField
                        label="Address family"
                        value={newCryptoAsset.routedAddressFamily}
                        onChange={event => setNewCryptoAsset(current => ({
                          ...current,
                          routedAddressFamily: event.target.value as typeof current.routedAddressFamily,
                          routedProfile: 'custom',
                        }))}
                      >
                        <option value="">Select family</option>
                        {ROUTED_ADDRESS_FAMILY_OPTIONS.map((option: string) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </SelectField>
                      <MoneyField
                        label="Minimum buy"
                        min={1}
                        value={newCryptoAsset.minimumBuyNgn}
                        onChange={event => setNewCryptoAsset(current => ({ ...current, minimumBuyNgn: event.target.value, routedProfile: 'custom' }))}
                        placeholder="500"
                      />
                      <NumberField
                        label="Max quote drift (%)"
                        min={0.01}
                        step="0.01"
                        value={newCryptoAsset.maxQuoteDriftPercent}
                        onChange={event => setNewCryptoAsset(current => ({ ...current, maxQuoteDriftPercent: event.target.value, routedProfile: 'custom' }))}
                        placeholder="1"
                      />
                    </FieldGrid>
                  )}
                </div>
              )}
            </div>
          </Disclosure>
          </div>
          <div className="mt-5 flex flex-col gap-4 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-end sm:justify-between">
            <ReadOnlyField
              label="Pair ID"
              value={buildCryptoPairId(newCryptoAsset.symbol || 'TOKEN', newCryptoAsset.network)}
              hint="Generated from the symbol and network."
              className="sm:max-w-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={closeNewAssetForm}>Cancel</Button>
              <Button onClick={createCryptoPair} disabled={savingCryptoPricing}>
                {savingCryptoPricing ? 'Creating…' : 'Create Pair'}
              </Button>
            </div>
          </div>
        </div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleCryptoPricing.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedCryptoAssetId(item.id)}
              className={`flex min-h-[88px] items-center justify-between gap-3 border p-3 text-left transition-all ${
                selectedCryptoAssetId === item.id
                  ? 'border-[var(--gold)] bg-[rgba(202,165,96,.08)]'
                  : 'border-[var(--border)] bg-[var(--clay)] hover:border-[var(--border2)]'
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <AssetLogo
                  src={item.icon}
                  alt={`${item.symbol} logo preview`}
                  fallback={item.symbol.slice(0, 1)}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--coal)]"
                  imgClassName="h-7 w-7 object-contain"
                  textClassName="text-base font-bold text-[var(--gold2)]"
                />
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-bold text-[var(--text)]">{item.id}</div>
                  <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.name} · {item.network}</div>
                </div>
              </div>
              <div className="flex flex-shrink-0 flex-col items-end gap-1">
                <span className={`border px-2 py-1 text-[8px] font-bold uppercase tracking-[.8px] ${item.isActive === false ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]' : 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]'}`}>
                  {item.isActive === false ? 'Archived' : 'Active'}
                </span>
                <span className="text-[9px] font-mono text-[var(--muted)]">
                  +{formatNgn(item.buyMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN)}/$
                </span>
              </div>
            </button>
          ))}
        </div>
        <Modal
          open={Boolean(selectedCryptoAsset)}
          onClose={closeCryptoEditor}
          // While edits are pending the X, Escape and the backdrop are all disabled, so the only ways
          // out are Save changes and Discard changes. Nothing can be lost by a stray click.
          dismissible={!selectedPairDirty}
          title={selectedCryptoAsset ? selectedCryptoAsset.id : 'Asset Editor'}
          subtitle={selectedCryptoAsset ? `${selectedCryptoAsset.name} · ${selectedCryptoAsset.network}` : undefined}
          size="lg"
          className="max-w-4xl"
        >
        {selectedCryptoAsset && (() => {
          const item = selectedCryptoAsset
          return (
            <div className="space-y-5 p-5">
              <FormSection
                title="Coin"
                description="What customers see in the app."
                actions={(
                  <Button
                    size="sm"
                    variant={item.isActive === false ? 'secondary' : 'danger'}
                    onClick={() => setCryptoPairArchived(item.id, item.isActive !== false)}
                  >
                    {item.isActive === false ? 'Restore Pair' : 'Archive Pair'}
                  </Button>
                )}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="flex shrink-0 flex-col items-center gap-2">
                    <AssetLogo
                      src={item.icon}
                      alt={`${item.symbol} logo preview`}
                      fallback={item.symbol.slice(0, 1)}
                      className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--clay)]"
                      imgClassName="h-10 w-10 object-contain"
                      textClassName="text-xl font-bold text-[var(--gold2)]"
                    />
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition-colors hover:border-[var(--gold2)]">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={event => {
                          const file = event.target.files?.[0]
                          if (file) void uploadCryptoLogo(file, { pairId: item.id, symbol: item.symbol })
                          event.currentTarget.value = ''
                        }}
                      />
                      {uploadingCryptoLogoId === item.id ? 'Uploading…' : 'Upload logo'}
                    </label>
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <ToggleField
                      label="Show this pair to customers"
                      hint="Turning this off hides the pair in the app once you save."
                      checked={item.isActive !== false}
                      onChange={checked => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, isActive: checked } : asset))}
                    />
                    {item.isActive === false && (
                      <Callout tone="warn">
                        This pair is archived. It will stay in history and admin records, but users cannot
                        actively trade it once you save.
                      </Callout>
                    )}
                  </div>
                </div>
              </FormSection>

              <FormSection title="Your pricing" description="The two numbers you change day to day.">
                <FieldGrid columns={2}>
                  <MoneyField
                    label="Your profit per $1"
                    min={0}
                    step="1"
                    value={item.buyMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN}
                    onChange={event => setCryptoPricing(current => current.map(asset => {
                      if (asset.id !== item.id) return asset
                      const margin = Math.max(0, Number(event.target.value) || 0)
                      const usd = asset.marketPriceUsd ?? 0
                      return {
                        ...asset,
                        buyMarginNgnPerUsd: margin,
                        sellMarginNgnPerUsd: margin,
                        buyRate: computeBuyRate(usd, asset.marketRate, margin),
                        sellRate: computeSellRate(usd, asset.marketRate, margin),
                      }
                    }))}
                    hint="How much extra you earn on every dollar of this coin. Live rate ₦1,500 + profit ₦50 → customers buy at ₦1,550 per $1."
                  />
                  <MoneyField
                    label="Network fee per order"
                    min={0}
                    step="1"
                    value={item.buyNetworkFeeNgn ?? ''}
                    placeholder={String(getDefaultNetworkFeeNgn(item.network, 'buy', item.id))}
                    onChange={event => {
                      const raw = event.target.value
                      setCryptoPricing(current => current.map(asset => {
                        if (asset.id !== item.id) return asset
                        if (raw.trim() === '') {
                          return { ...asset, buyNetworkFeeNgn: undefined, sellNetworkFeeNgn: 0 }
                        }
                        const buyFee = Math.max(0, Number(raw) || 0)
                        return {
                          ...asset,
                          buyNetworkFeeNgn: buyFee,
                          sellNetworkFeeNgn: 0,
                        }
                      }))
                    }}
                    hint="Extra charge so the customer covers on-chain gas. Leave blank to use the automatic amount for this network."
                  />
                </FieldGrid>
                {(() => {
                  const preview = pricingPreview(item)
                  return (
                    <RatePreview
                      className="mt-4"
                      usdNgn={preview.usdNgn}
                      buyFx={preview.buyFx}
                      sellFx={preview.sellFx}
                      note={preview.asymmetric
                        ? 'Buy and sell profit are currently different. Open Advanced to edit them separately, or change “Your profit per $1” above to set both equal.'
                        : undefined}
                    />
                  )
                })()}
              </FormSection>

              <Disclosure
                open={showEditorAdvanced}
                onToggle={() => setShowEditorAdvanced(current => !current)}
                title="Advanced"
                summary={item.executionRail === 'routed_treasury'
                  ? (customRoutedProfileIds[item.id] || findRoutedProfileForAsset(item) === 'custom'
                      ? 'Custom routing — chain, token and decimals set by hand'
                      : 'Routing comes from a built-in preset')
                  : 'Price feed, quote validity, execution rail, separate buy/sell margins'}
              >
                <div className="space-y-4">
                  <FieldGrid columns={2}>
                    <TextField
                      label="Live price feed ID"
                      value={item.marketSourceId}
                      onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, marketSourceId: event.target.value } : asset))}
                      hint="The feed id used for this coin’s live price."
                    />
                    <NumberField
                      label="Quote validity (seconds)"
                      min={30}
                      value={item.quoteTtlSeconds}
                      onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, quoteTtlSeconds: Number(event.target.value) } : asset))}
                      hint="How long a customer’s quoted rate stays honoured."
                    />
                    <SelectField
                      label="Execution rail"
                      value={item.executionRail ?? ''}
                      onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? (() => {
                        const nextRail = (event.target.value || undefined) as typeof asset.executionRail
                        if (nextRail !== 'routed_treasury') {
                          return {
                            ...asset,
                            executionRail: nextRail,
                            routedToChain: undefined,
                            routedToToken: undefined,
                            routedDecimals: undefined,
                            routedAddressFamily: undefined,
                            minimumBuyNgn: undefined,
                            maxQuoteDriftPercent: undefined,
                          }
                        }
                        return { ...asset, executionRail: nextRail }
                      })() : asset))}
                      hint="Catalog Only lists the coin without trading it in-app."
                    >
                      {CRYPTO_EXECUTION_RAIL_OPTIONS.map(option => (
                        <option key={option.value || 'none'} value={option.value}>{option.label}</option>
                      ))}
                    </SelectField>
                    <TextField
                      label="Logo path or URL"
                      value={item.icon}
                      onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, icon: event.target.value } : asset))}
                      hint="Only needed if you are not uploading a file above."
                    />
                    <MoneyField
                      label="Buy profit only (per $1)"
                      min={0}
                      step="0.01"
                      value={item.buyMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN}
                      onChange={event => setCryptoPricing(current => current.map(asset => {
                        if (asset.id !== item.id) return asset
                        const margin = Math.max(0, Number(event.target.value) || 0)
                        return {
                          ...asset,
                          buyMarginNgnPerUsd: margin,
                          buyRate: computeBuyRate(asset.marketPriceUsd ?? 0, asset.marketRate, margin),
                        }
                      }))}
                    />
                    <MoneyField
                      label="Sell profit only (per $1)"
                      min={0}
                      step="0.01"
                      value={item.sellMarginNgnPerUsd ?? DEFAULT_USD_MARGIN_NGN}
                      onChange={event => setCryptoPricing(current => current.map(asset => {
                        if (asset.id !== item.id) return asset
                        const margin = Math.max(0, Number(event.target.value) || 0)
                        return {
                          ...asset,
                          sellMarginNgnPerUsd: margin,
                          sellRate: computeSellRate(asset.marketPriceUsd ?? 0, asset.marketRate, margin),
                        }
                      }))}
                    />
                    <MoneyField
                      label="Buy network fee only"
                      min={0}
                      step="0.01"
                      value={item.buyNetworkFeeNgn ?? ''}
                      placeholder={String(getDefaultNetworkFeeNgn(item.network, 'buy', item.id))}
                      onChange={event => {
                        const raw = event.target.value
                        setCryptoPricing(current => current.map(asset => asset.id === item.id ? {
                          ...asset,
                          buyNetworkFeeNgn: raw.trim() === '' ? undefined : Math.max(0, Number(raw)),
                        } : asset))
                      }}
                    />
                  </FieldGrid>
                  {item.executionRail === 'routed_treasury' && (
                    <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--coal)] p-4">
                      <SelectField
                        label="Routed profile"
                        className="sm:max-w-sm"
                        hint="Presets carry the chain, token and decimals so you never type them."
                        value={customRoutedProfileIds[item.id] ? 'custom' : findRoutedProfileForAsset(item)}
                        onChange={event => {
                          const profileId = event.target.value
                          if (profileId === 'custom') {
                            setCustomRoutedProfileIds((state: Record<string, boolean>) => ({ ...state, [item.id]: true }))
                            return
                          }
                          const config = getRoutedProfileConfig(profileId)
                          if (!config) return
                          setCustomRoutedProfileIds((state: Record<string, boolean>) => ({ ...state, [item.id]: false }))
                          setCryptoPricing(current => current.map(asset => asset.id === item.id ? {
                            ...asset,
                            symbol: config.symbol,
                            network: config.network,
                            executionRail: 'routed_treasury',
                            routedToChain: config.toChain,
                            routedToToken: config.toToken,
                            routedDecimals: config.decimals,
                            routedAddressFamily: config.addressFamily,
                            minimumBuyNgn: config.minimumBuyNgn,
                            maxQuoteDriftPercent: config.maxQuoteDriftPercent,
                          } : asset))
                        }}
                      >
                        {ROUTED_PROFILE_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                        <option value="custom">Custom</option>
                      </SelectField>
                  {!(customRoutedProfileIds[item.id] || findRoutedProfileForAsset(item) === 'custom') && (
                    <Callout>
                      Routed via chain <strong>{item.routedToChain}</strong> · token{' '}
                      <span className="font-mono">{item.routedToToken}</span> ·{' '}
                      <strong>{item.routedDecimals}</strong> decimals
                    </Callout>
                  )}
                  {(customRoutedProfileIds[item.id] || findRoutedProfileForAsset(item) === 'custom') && (
                    <FieldGrid columns={2}>
                      <TextField
                        label="Routed chain ID"
                        value={item.routedToChain ?? ''}
                        onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, routedToChain: event.target.value } : asset))}
                      />
                      <TextField
                        label="Routed token address"
                        value={item.routedToToken ?? ''}
                        onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, routedToToken: event.target.value } : asset))}
                      />
                      <NumberField
                        label="Routed decimals"
                        min={0}
                        value={item.routedDecimals ?? ''}
                        onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, routedDecimals: parseOptionalNumber(event.target.value) } : asset))}
                      />
                      <SelectField
                        label="Address family"
                        value={item.routedAddressFamily ?? ''}
                        onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, routedAddressFamily: (event.target.value || undefined) as typeof asset.routedAddressFamily } : asset))}
                      >
                        <option value="">Select family</option>
                        {ROUTED_ADDRESS_FAMILY_OPTIONS.map((option: string) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </SelectField>
                      <MoneyField
                        label="Minimum buy"
                        min={1}
                        value={item.minimumBuyNgn ?? ''}
                        onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, minimumBuyNgn: parseOptionalNumber(event.target.value) } : asset))}
                      />
                      <NumberField
                        label="Max quote drift (%)"
                        min={0.01}
                        step="0.01"
                        value={item.maxQuoteDriftPercent ?? ''}
                        onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, maxQuoteDriftPercent: parseOptionalNumber(event.target.value) } : asset))}
                      />
                    </FieldGrid>
                  )}
                    </div>
                  )}
                  <ToggleField
                    label="Treasury execution enabled"
                    hint="Lets the in-app treasury settle this pair. Unavailable while the pair is archived."
                    checked={item.baseExecutionEnabled === true}
                    disabled={item.isActive === false}
                    onChange={checked => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, baseExecutionEnabled: checked } : asset))}
                  />
                </div>
              </Disclosure>
              <FormSection
                title="Live rates"
                description="Read-only — derived from the live feed and the profit you set above."
                actions={(
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${item.pricingSource === 'live' ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]' : item.pricingSource === 'backup' ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]' : 'border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] text-[var(--red2)]'}`}>
                    {renderPricingSourceLabel(item.pricingSource)}
                  </span>
                )}
              >
                <FieldGrid columns={3}>
                  <ReadOnlyField
                    label={renderPricingSourceLabel(item.pricingSource)}
                    value={`₦${item.marketRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`}
                  />
                  <ReadOnlyField
                    label="Derived buy rate"
                    value={`₦${item.buyRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`}
                  />
                  <ReadOnlyField
                    label="Derived sell rate"
                    value={`₦${item.sellRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`}
                  />
                </FieldGrid>
                <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
                  {item.executionRail === 'routed_treasury'
                    ? 'Routed execution config is admin-controlled for this asset.'
                    : 'Pricing and execution flags are operator-controlled.'}
                </p>
              </FormSection>

              <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--coal)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs leading-relaxed text-[var(--muted)]">
                  {dirtyCryptoPairIdSet.has(item.id)
                    ? 'Not saved yet — nothing here is live until you press Save changes.'
                    : 'All changes saved.'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {dirtyCryptoPairIdSet.has(item.id) ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => discardSelectedCryptoPair(item.id)}
                        disabled={savingCryptoPairId === item.id}
                      >
                        Discard changes
                      </Button>
                      <Button
                        onClick={() => void saveSelectedCryptoPair(item.id)}
                        disabled={savingCryptoPairId === item.id}
                      >
                        {savingCryptoPairId === item.id ? 'Saving…' : 'Save changes'}
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={closeCryptoEditor}>Close</Button>
                  )}
                </div>
              </div>
            </div>
          )
        })()}
        </Modal>
        {!selectedCryptoAsset && visibleCryptoPricing.length > 0 && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">
            Select any asset tile to open its editor.
          </div>
        )}
        {visibleCryptoPricing.length === 0 && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">
            No crypto pairs match the current filter.
          </div>
        )}
      </Card>}

      {showRewards && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold text-[var(--text)]">Reward Rules</div>
            <div className="mt-1 text-[10px] text-[var(--muted)]">Control referral and bonus payouts from admin. The engine currently supports signup rewards and first successful transaction rewards.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={showNewRewardRuleForm ? 'secondary' : 'primary'}
              onClick={() => setShowNewRewardRuleForm(current => !current)}
            >
              {showNewRewardRuleForm ? 'Close New Rule' : 'New Rule'}
            </Button>
            <Button onClick={() => void saveRewardRuleCatalog()} disabled={savingRewardRules}>
              {savingRewardRules ? 'Saving…' : 'Save Reward Rules'}
            </Button>
          </div>
        </div>
        <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Reward Payout Summary</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border border-[var(--border)] bg-[var(--coal)] px-3 py-3">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Total Awards</div>
                <div className="mt-1 text-[18px] font-bold text-[var(--text)]">{rewardRuleReport?.totalAwards ?? 0}</div>
              </div>
              <div className="border border-[var(--border)] bg-[var(--coal)] px-3 py-3">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Total Payout</div>
                <div className="mt-1 text-[18px] font-bold text-[var(--green2)]">₦{(rewardRuleReport?.totalPayoutNgn ?? 0).toLocaleString('en-NG')}</div>
              </div>
              <div className="border border-[var(--border)] bg-[var(--coal)] px-3 py-3">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Pending Approval</div>
                <div className="mt-1 text-[18px] font-bold text-[var(--gold2)]">{rewardRuleReport?.pendingApprovalCount ?? 0}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(rewardRuleReport?.byRule ?? []).slice(0, 6).map(item => (
                <div key={item.ruleId} className="flex items-center justify-between gap-3 border border-[var(--border)] bg-[var(--coal)] px-3 py-2">
                  <div>
                    <div className="text-[11px] font-bold text-[var(--text)]">{item.ruleName}</div>
                    <div className="mt-1 text-[9px] text-[var(--muted)]">
                      {item.totalAwards} award{item.totalAwards === 1 ? '' : 's'}
                      {item.pendingManualCount > 0 ? ` · ${item.pendingManualCount} pending` : ''}
                      {item.lastAwardAt ? ` · last ${new Date(item.lastAwardAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-bold text-[var(--green2)]">₦{item.totalPayoutNgn.toLocaleString('en-NG')}</div>
                    <div className={`mt-1 text-[9px] font-bold ${item.isActive ? 'text-[var(--green2)]' : 'text-[var(--muted)]'}`}>{item.isActive ? 'ACTIVE' : 'INACTIVE'}</div>
                  </div>
                </div>
              ))}
              {(rewardRuleReport?.byRule?.length ?? 0) === 0 && (
                <div className="border border-[var(--border)] bg-[var(--coal)] px-3 py-3 text-[10px] text-[var(--muted)]">
                  No reward payouts recorded yet.
                </div>
              )}
            </div>
          </div>
          <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Recent Reward Awards</div>
            <div className="space-y-2">
              {(rewardRuleReport?.recentAwards ?? []).map(item => (
                <div key={item.transactionId} className="border border-[var(--border)] bg-[var(--coal)] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold text-[var(--text)]">{item.rewardRuleName}</div>
                      <div className="mt-1 text-[9px] text-[var(--muted)]">
                        Beneficiary: {item.beneficiaryName}
                        {item.sourceUserName ? ` · Triggered by ${item.sourceUserName}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-bold text-[var(--green2)]">₦{item.amountNgn.toLocaleString('en-NG')}</div>
                      <div className="mt-1 text-[9px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] text-[var(--muted)]">{item.rewardType} · {item.reference} · {item.status.toUpperCase()}</div>
                </div>
              ))}
              {(rewardRuleReport?.recentAwards?.length ?? 0) === 0 && (
                <div className="border border-[var(--border)] bg-[var(--coal)] px-3 py-3 text-[10px] text-[var(--muted)]">
                  No reward transactions yet.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mb-4 border border-[var(--border)] bg-[var(--clay)] p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Manual Review Queue</div>
          <div className="space-y-2">
            {(rewardRuleReport?.recentRequests ?? []).map(request => (
              <div key={request.id} className="border border-[var(--border)] bg-[var(--coal)] px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold text-[var(--text)]">{request.rewardRuleName}</div>
                    <div className="mt-1 text-[9px] text-[var(--muted)]">
                      Beneficiary: {request.beneficiaryName} · Triggered by {request.sourceUserName}
                    </div>
                    <div className="mt-1 text-[9px] text-[var(--muted)]">
                      {request.status.toUpperCase()}
                      {request.statusReason ? ` · ${request.statusReason}` : ''}
                    </div>
                    {request.reviewedByName ? (
                      <div className="mt-1 text-[9px] text-[var(--muted)]">
                        Reviewed by {request.reviewedByName}
                        {request.reviewedAt ? ` · ${new Date(request.reviewedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-bold text-[var(--gold2)]">₦{request.amountNgn.toLocaleString('en-NG')}</div>
                    <div className="mt-1 text-[9px] text-[var(--muted)]">{new Date(request.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => void reviewRewardRequest(request, 'reject')}
                        disabled={reviewingRewardRequestId === request.id || request.status === 'approved'}
                      >
                        {reviewingRewardRequestId === request.id ? 'Working…' : 'Reject'}
                      </Button>
                      <Button
                        onClick={() => void reviewRewardRequest(request, 'approve')}
                        disabled={reviewingRewardRequestId === request.id || request.status === 'approved'}
                      >
                        {reviewingRewardRequestId === request.id ? 'Working…' : 'Approve'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {(rewardRuleReport?.recentRequests?.length ?? 0) === 0 && (
              <div className="border border-[var(--border)] bg-[var(--coal)] px-3 py-3 text-[10px] text-[var(--muted)]">
                No pending or guarded reward requests yet.
              </div>
            )}
          </div>
        </div>
        {!showNewRewardRuleForm && (
          <div className="mb-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">
            Open the rule form only when you need to add a new reward rule.
          </div>
        )}
        {showNewRewardRuleForm && <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
          <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Add Reward Rule</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-[10px] text-[var(--muted)]">
              Rule ID
              <input type="text" value={newRewardRule.id} onChange={event => setNewRewardRule(current => ({ ...current, id: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Rule Name
              <input type="text" value={newRewardRule.name} onChange={event => setNewRewardRule(current => ({ ...current, name: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Kind
              <select value={newRewardRule.kind} onChange={event => setNewRewardRule(current => ({ ...current, kind: event.target.value as typeof current.kind }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                {REWARD_KIND_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Trigger
              <select
                value={newRewardRule.triggerEvent}
                onChange={event => setNewRewardRule(current => ({
                  ...current,
                  triggerEvent: event.target.value as typeof current.triggerEvent,
                  allowedTransactionTypes: event.target.value === 'user_signup' ? [] : current.allowedTransactionTypes,
                  excludedTransactionTypes: event.target.value === 'user_signup' ? [] : current.excludedTransactionTypes,
                }))}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              >
                {REWARD_TRIGGER_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-[10px] text-[var(--muted)]">
              Audience
              <select
                value={newRewardRule.audience}
                onChange={event => setNewRewardRule(current => ({
                  ...current,
                  audience: event.target.value as typeof current.audience,
                  requiresReferral: event.target.value === 'inviter' ? true : current.requiresReferral,
                }))}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              >
                {REWARD_AUDIENCE_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Amount (NGN)
              <input type="number" min={1} value={newRewardRule.amountNgn} onChange={event => setNewRewardRule(current => ({ ...current, amountNgn: Number(event.target.value) }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Daily Payout Cap (NGN)
              <input type="number" min={1} value={newRewardRule.dailyPayoutCapNgn} onChange={event => setNewRewardRule(current => ({ ...current, dailyPayoutCapNgn: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" placeholder="Optional" />
            </label>
            <label className="flex items-center gap-2 self-end text-[10px] text-[var(--muted)]">
              <input type="checkbox" checked={newRewardRule.requiresReferral} disabled={newRewardRule.audience === 'inviter'} onChange={event => setNewRewardRule(current => ({ ...current, requiresReferral: event.target.checked }))} />
              Requires referral context
            </label>
            <label className="flex items-center gap-2 self-end text-[10px] text-[var(--muted)]">
              <input type="checkbox" checked={newRewardRule.manualApprovalRequired} onChange={event => setNewRewardRule(current => ({ ...current, manualApprovalRequired: event.target.checked }))} />
              Manual approval required
            </label>
            <label className="flex items-center gap-2 self-end text-[10px] text-[var(--muted)]">
              <input type="checkbox" checked={newRewardRule.isActive} onChange={event => setNewRewardRule(current => ({ ...current, isActive: event.target.checked }))} />
              Active
            </label>
          </div>
          <label className="mt-3 block text-[10px] text-[var(--muted)]">
            Description
            <textarea value={newRewardRule.description} onChange={event => setNewRewardRule(current => ({ ...current, description: event.target.value }))} className="mt-1 min-h-[4rem] w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
          </label>
          {newRewardRule.triggerEvent === 'first_successful_transaction' && (
            <div className="mt-3 grid gap-4 xl:grid-cols-2">
              <div>
                <div className="text-[10px] font-bold text-[var(--muted)]">Allowed Transaction Types</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {REWARD_TRANSACTION_TYPE_OPTIONS.map(option => (
                    <label key={`draft-allow-${option}`} className="flex items-center gap-2 border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[10px] text-[var(--muted)]">
                      <input type="checkbox" checked={newRewardRule.allowedTransactionTypes.includes(option)} onChange={() => setNewRewardRule(current => ({ ...current, allowedTransactionTypes: toggleRewardTransactionType(current.allowedTransactionTypes, option) }))} />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-[var(--muted)]">Excluded Transaction Types</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {REWARD_TRANSACTION_TYPE_OPTIONS.map(option => (
                    <label key={`draft-exclude-${option}`} className="flex items-center gap-2 border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[10px] text-[var(--muted)]">
                      <input type="checkbox" checked={newRewardRule.excludedTransactionTypes.includes(option)} onChange={() => setNewRewardRule(current => ({ ...current, excludedTransactionTypes: toggleRewardTransactionType(current.excludedTransactionTypes, option) }))} />
                      {option}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={addRewardRuleDraft}>Add Rule To Draft</Button>
              <Button variant="secondary" onClick={() => setShowNewRewardRuleForm(false)}>Close</Button>
            </div>
          </div>
        </div>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rewardRules.map(rule => (
            <button
              key={rule.id}
              type="button"
              onClick={() => setSelectedRewardRuleId(rule.id)}
              className={`border p-4 text-left transition-all ${
                selectedRewardRuleId === rule.id
                  ? 'border-[var(--gold)] bg-[rgba(202,165,96,.08)]'
                  : 'border-[var(--border)] bg-[var(--clay)] hover:border-[var(--border2)]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold text-[var(--text)]">{rule.name}</div>
                  <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{rule.id} · {rule.kind} · {rule.triggerEvent}</div>
                  <div className="mt-2 text-[10px] text-[var(--text2)]">₦{rule.amountNgn.toLocaleString('en-NG')} · {rule.audience}</div>
                </div>
                <span className={`border px-2 py-1 text-[8px] font-bold uppercase tracking-[.8px] ${rule.isActive === false ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]' : 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]'}`}>
                  {rule.isActive === false ? 'Inactive' : 'Active'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[8px] text-[var(--muted)]">
                {rule.requiresReferral === true && <span className="border border-[var(--border)] px-2 py-1">Referral</span>}
                {rule.manualApprovalRequired === true && <span className="border border-[var(--border)] px-2 py-1">Manual Review</span>}
                {rule.dailyPayoutCapNgn ? <span className="border border-[var(--border)] px-2 py-1">Cap ₦{rule.dailyPayoutCapNgn.toLocaleString('en-NG')}</span> : null}
              </div>
            </button>
          ))}
        </div>
        <Modal
          open={Boolean(selectedRewardRule)}
          onClose={() => setSelectedRewardRuleId(null)}
          title={selectedRewardRule ? selectedRewardRule.name : 'Reward Rule Editor'}
          subtitle={selectedRewardRule ? `${selectedRewardRule.id} · ${selectedRewardRule.kind} · ${selectedRewardRule.triggerEvent}` : undefined}
          size="lg"
          className="max-w-4xl"
        >
        {selectedRewardRule && (() => {
          const rule = selectedRewardRule
          return (
            <div className="border border-[var(--gold)] bg-[var(--clay)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">{rule.name}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{rule.id} · {rule.kind} · {rule.triggerEvent}</div>
                </div>
                <label className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                  <input type="checkbox" checked={rule.isActive !== false} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, isActive: event.target.checked } : item))} />
                  Active
                </label>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="text-[10px] text-[var(--muted)]">
                  Rule Name
                  <input type="text" value={rule.name} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, name: event.target.value } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Kind
                  <select value={rule.kind} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, kind: event.target.value as typeof item.kind } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                    {REWARD_KIND_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Trigger
                  <select value={rule.triggerEvent} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, triggerEvent: event.target.value as typeof item.triggerEvent, allowedTransactionTypes: event.target.value === 'user_signup' ? undefined : item.allowedTransactionTypes, excludedTransactionTypes: event.target.value === 'user_signup' ? undefined : item.excludedTransactionTypes } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                    {REWARD_TRIGGER_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Audience
                  <select value={rule.audience} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, audience: event.target.value as typeof item.audience, requiresReferral: event.target.value === 'inviter' ? true : item.requiresReferral } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                    {REWARD_AUDIENCE_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Amount (NGN)
                  <input type="number" min={1} value={rule.amountNgn} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, amountNgn: Number(event.target.value) } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Daily Payout Cap (NGN)
                  <input type="number" min={1} value={rule.dailyPayoutCapNgn ?? ''} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, dailyPayoutCapNgn: event.target.value ? Number(event.target.value) : undefined } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" placeholder="Optional" />
                </label>
                <label className="flex items-center gap-2 self-end text-[10px] text-[var(--muted)]">
                  <input type="checkbox" checked={rule.requiresReferral === true} disabled={rule.audience === 'inviter'} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, requiresReferral: event.target.checked } : item))} />
                  Requires referral context
                </label>
                <label className="flex items-center gap-2 self-end text-[10px] text-[var(--muted)]">
                  <input type="checkbox" checked={rule.manualApprovalRequired === true} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, manualApprovalRequired: event.target.checked } : item))} />
                  Manual approval required
                </label>
              </div>
              <label className="mt-3 block text-[10px] text-[var(--muted)]">
                Description
                <textarea value={rule.description ?? ''} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, description: event.target.value } : item))} className="mt-1 min-h-[4rem] w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
              </label>
              {rule.triggerEvent === 'first_successful_transaction' && (
                <div className="mt-3 grid gap-4 xl:grid-cols-2">
                  <div>
                    <div className="text-[10px] font-bold text-[var(--muted)]">Allowed Transaction Types</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {REWARD_TRANSACTION_TYPE_OPTIONS.map(option => (
                        <label key={`${rule.id}-allow-${option}`} className="flex items-center gap-2 border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[10px] text-[var(--muted)]">
                          <input type="checkbox" checked={(rule.allowedTransactionTypes ?? []).includes(option)} onChange={() => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, allowedTransactionTypes: toggleRewardTransactionType(item.allowedTransactionTypes ?? [], option) } : item))} />
                          {option}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-[var(--muted)]">Excluded Transaction Types</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {REWARD_TRANSACTION_TYPE_OPTIONS.map(option => (
                        <label key={`${rule.id}-exclude-${option}`} className="flex items-center gap-2 border border-[var(--border)] bg-[var(--coal)] px-2 py-1 text-[10px] text-[var(--muted)]">
                          <input type="checkbox" checked={(rule.excludedTransactionTypes ?? []).includes(option)} onChange={() => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, excludedTransactionTypes: toggleRewardTransactionType(item.excludedTransactionTypes ?? [], option) } : item))} />
                          {option}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
        </Modal>
        {rewardRules.length === 0 && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">
            No reward rules configured yet.
          </div>
        )}
      </Card>}

      {showBills && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">Bill Providers</div>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'active', 'archived'] as const).map(filter => (
              <button key={filter} type="button" onClick={() => setBillCatalogFilter(filter)} className={`border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[1px] ${billCatalogFilter === filter ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)] text-[var(--gold2)]' : 'border-[var(--border)] bg-[var(--clay)] text-[var(--muted)]'}`}>
                {filter}
              </button>
            ))}
            <Button
              variant={showNewBillProviderForm ? 'secondary' : 'primary'}
              onClick={() => setShowNewBillProviderForm(current => !current)}
            >
              {showNewBillProviderForm ? 'Close New Service' : 'New Service'}
            </Button>
            <Button onClick={() => void saveBillProviderCatalog()} disabled={savingBillProviders}>
              {savingBillProviders ? 'Saving…' : 'Save Bill Providers'}
            </Button>
          </div>
        </div>
        {!showNewBillProviderForm && (
          <div className="mb-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">
            Open the service form only when you need to add a new bill provider.
          </div>
        )}
        {showNewBillProviderForm && <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
          <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Add Bill Service</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-[10px] text-[var(--muted)]">
              Provider ID
              <input type="text" value={newBillProvider.id} onChange={event => setNewBillProvider(current => ({ ...current, id: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Display Name
              <input type="text" value={newBillProvider.name} onChange={event => setNewBillProvider(current => ({ ...current, name: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Service Type
              <select value={newBillProvider.type} onChange={event => {
                const nextType = event.target.value as typeof newBillProvider.type
                setNewBillProvider(current => ({
                  ...current,
                  type: nextType,
                  icon: current.icon || BILL_ICON_SUGGESTIONS[nextType] || '',
                  requiresNetwork: nextType === 'airtime' || nextType === 'data',
                }))
              }} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                {BILL_PROVIDER_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Icon
              <input type="text" maxLength={2} value={newBillProvider.icon} onChange={event => setNewBillProvider(current => ({ ...current, icon: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-[10px] text-[var(--muted)]">
              Account Label
              <input type="text" value={newBillProvider.accountLabel} onChange={event => setNewBillProvider(current => ({ ...current, accountLabel: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Placeholder
              <input type="text" value={newBillProvider.accountPlaceholder} onChange={event => setNewBillProvider(current => ({ ...current, accountPlaceholder: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Minimum Amount (NGN)
              <input type="number" min={1} value={newBillProvider.minAmount} onChange={event => setNewBillProvider(current => ({ ...current, minAmount: Number(event.target.value) }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Maximum Amount (NGN)
              <input type="number" min={1} value={newBillProvider.maxAmount} onChange={event => setNewBillProvider(current => ({ ...current, maxAmount: Number(event.target.value) }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
            </label>
          </div>
          <label className="mt-3 block text-[10px] text-[var(--muted)]">
            Helper Text
            <textarea value={newBillProvider.helperText} onChange={event => setNewBillProvider(current => ({ ...current, helperText: event.target.value }))} className="mt-1 min-h-[5.5rem] w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
          </label>
          <div className="mt-4 flex flex-wrap gap-4 text-[10px] text-[var(--muted)]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={newBillProvider.requiresNetwork} onChange={event => setNewBillProvider(current => ({ ...current, requiresNetwork: event.target.checked }))} />Requires Network</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={newBillProvider.requiresAccount} onChange={event => setNewBillProvider(current => ({ ...current, requiresAccount: event.target.checked }))} />Requires Account</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={newBillProvider.isActive} onChange={event => setNewBillProvider(current => ({ ...current, isActive: event.target.checked }))} />Active</label>
          </div>
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={addBillProviderDraft}>Add Service To Draft</Button>
              <Button variant="secondary" onClick={() => setShowNewBillProviderForm(false)}>Close</Button>
            </div>
          </div>
        </div>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleBillProviders.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedBillProviderId(item.id)}
              className={`border p-4 text-left transition-all ${
                selectedBillProviderId === item.id
                  ? 'border-[var(--gold)] bg-[rgba(202,165,96,.08)]'
                  : 'border-[var(--border)] bg-[var(--clay)] hover:border-[var(--border2)]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-bold text-[var(--text)]">{item.name}</div>
                  <div className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.id} · {item.type}</div>
                  <div className="mt-2 text-[10px] text-[var(--text2)]">₦{(item.minAmount ?? 0).toLocaleString('en-NG')} - ₦{(item.maxAmount ?? 0).toLocaleString('en-NG')}</div>
                </div>
                <span className={`border px-2 py-1 text-[8px] font-bold uppercase tracking-[.8px] ${item.isActive === false ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]' : 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]'}`}>
                  {item.isActive === false ? 'Archived' : 'Active'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[8px] text-[var(--muted)]">
                {item.requiresNetwork === true && <span className="border border-[var(--border)] px-2 py-1">Network</span>}
                {item.requiresAccount !== false && <span className="border border-[var(--border)] px-2 py-1">Account</span>}
              </div>
            </button>
          ))}
        </div>
        <Modal
          open={Boolean(selectedBillProvider)}
          onClose={() => setSelectedBillProviderId(null)}
          title={selectedBillProvider ? selectedBillProvider.name : 'Bill Provider Editor'}
          subtitle={selectedBillProvider ? `${selectedBillProvider.id} · ${selectedBillProvider.type}` : undefined}
          size="lg"
          className="max-w-4xl"
        >
        {selectedBillProvider && (() => {
          const item = selectedBillProvider
          return (
            <div className="border border-[var(--gold)] bg-[var(--clay)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-bold text-[var(--text)]">{item.name}</div>
                  <div className="mt-1 text-[10px] text-[var(--muted)]">{item.id} · {item.type}</div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                    <input type="checkbox" checked={item.isActive !== false} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, isActive: event.target.checked } : provider))} />
                    Active
                  </label>
                  <Button size="sm" variant={item.isActive === false ? 'secondary' : 'danger'} onClick={() => setBillProviderArchived(item.id, item.isActive !== false)}>
                    {item.isActive === false ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-[10px] text-[var(--muted)]">
                  Display Name
                  <input type="text" value={item.name} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, name: event.target.value } : provider))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Icon
                  <input type="text" maxLength={2} value={item.icon} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, icon: event.target.value } : provider))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Account Label
                  <input type="text" value={item.accountLabel ?? ''} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, accountLabel: event.target.value } : provider))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Placeholder
                  <input type="text" value={item.accountPlaceholder ?? ''} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, accountPlaceholder: event.target.value } : provider))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Minimum Amount (NGN)
                  <input type="number" min={1} value={item.minAmount ?? 0} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, minAmount: Number(event.target.value) } : provider))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Maximum Amount (NGN)
                  <input type="number" min={1} value={item.maxAmount ?? 0} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, maxAmount: Number(event.target.value) } : provider))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
                </label>
              </div>
              <label className="mt-3 block text-[10px] text-[var(--muted)]">
                Helper Text
                <textarea value={item.helperText ?? ''} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, helperText: event.target.value } : provider))} className="mt-1 min-h-[5rem] w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none" />
              </label>
              <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-[var(--muted)]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={item.requiresNetwork === true} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, requiresNetwork: event.target.checked } : provider))} />Requires Network</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={item.requiresAccount !== false} onChange={event => setBillProviderCatalog(current => current.map(provider => provider.id === item.id ? { ...provider, requiresAccount: event.target.checked } : provider))} />Requires Account</label>
              </div>
            </div>
          )
        })()}
        </Modal>
        {visibleBillProviders.length === 0 && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">
            No bill services match the current filter.
          </div>
        )}
      </Card>}

      {showRaw && <div className="grid gap-6 xl:grid-cols-2">
        {ADMIN_ENDPOINTS.filter(config => config.key !== 'assets' && config.key !== 'billProviders' && config.key !== 'rewardRules').map(config => (
          <Card key={config.key} className="p-5">
            <div className="mb-3 text-[11px] font-bold text-[var(--text)]">{config.title}</div>
            <textarea
              value={drafts[config.key]}
              onChange={event => setDrafts(current => ({ ...current, [config.key]: event.target.value }))}
              className="min-h-[22rem] w-full border border-[var(--border)] bg-[var(--clay)] p-3 font-mono text-[10px] text-[var(--text)] outline-none focus:border-[var(--gold)]"
              spellCheck={false}
            />
            <div className="mt-4">
              <Button onClick={() => void saveConfig(config.key)} disabled={saving === config.key}>
                {saving === config.key ? 'Saving…' : `Save ${config.title}`}
              </Button>
            </div>
          </Card>
        ))}
      </div>}
    </>
  )
}
