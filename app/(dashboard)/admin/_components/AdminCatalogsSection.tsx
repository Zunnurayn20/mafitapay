'use client'

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { computeBuyRate, computeSellRate, getDefaultCryptoMarketSourceId } from '@/lib/crypto-market'
import { buildCryptoPairId } from '@/lib/routed-assets'
import type { AdminSubmodule } from '../admin-config'
import type { AdminWorkspaceState } from '../useAdminWorkspace'

export function AdminCatalogsSection({ workspace, submodule }: { workspace: AdminWorkspaceState; submodule?: AdminSubmodule }) {
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
    newCryptoAsset,
    setNewCryptoAsset,
    applyNewAssetRoutedProfile,
    getRoutedProfileConfig,
    draftMarketRatePreview,
    addCryptoAssetDraft,
    uploadCryptoLogo,
    uploadingCryptoLogoId,
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

  return (
    <>
      {!submodule && <Card className="p-6">
        <div className="text-[11px] font-bold text-[var(--text)]">Catalog Admin</div>
        <div className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
          Use the structured crypto pair form for token listings. Raw JSON is still available for the other catalogs.
        </div>
      </Card>}

      {showAssets && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold text-[var(--text)]">Crypto Pricing Control</div>
            <div className="mt-1 text-[10px] text-[var(--muted)]">Manage per-pair market rates, spreads, quote TTL, and activation without editing raw JSON.</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
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
            <Button onClick={() => void saveCryptoPricing()} disabled={savingCryptoPricing}>
              {savingCryptoPricing ? 'Saving…' : 'Save Crypto Pricing'}
            </Button>
          </div>
        </div>
        <div className="mb-5 border border-[var(--border)] bg-[var(--coal)] p-4">
          <div className="text-[11px] font-bold text-[var(--text)]">Add Crypto Pair</div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">Fill the business fields below. Live market price comes from the configured feed. Admin only controls spread.</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-[10px] text-[var(--muted)]">
              Symbol
              <input
                type="text"
                value={newCryptoAsset.symbol}
                onChange={event => setNewCryptoAsset(current => ({
                  ...current,
                  symbol: event.target.value.toUpperCase(),
                  marketSourceId: current.marketSourceId || getDefaultCryptoMarketSourceId(event.target.value),
                  icon: current.icon || CRYPTO_LOGO_SUGGESTIONS[event.target.value.toUpperCase()] || '',
                }))}
                placeholder="USDT"
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Asset Name
              <input
                type="text"
                value={newCryptoAsset.name}
                onChange={event => setNewCryptoAsset(current => ({ ...current, name: event.target.value }))}
                placeholder="Tether USD"
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Network
              <select
                value={newCryptoAsset.network}
                onChange={event => setNewCryptoAsset(current => ({ ...current, network: event.target.value }))}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              >
                {CRYPTO_NETWORK_OPTIONS.map((option: string) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Logo Path / URL
              <input
                type="text"
                value={newCryptoAsset.icon}
                onChange={event => setNewCryptoAsset(current => ({ ...current, icon: event.target.value }))}
                placeholder="/crypto-assets/usdt.png or https://…"
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Live Price Feed ID
              <input
                type="text"
                value={newCryptoAsset.marketSourceId}
                onChange={event => setNewCryptoAsset(current => ({ ...current, marketSourceId: event.target.value }))}
                placeholder="tether, usd-coin, ethereum…"
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Buy Spread (bps)
              <input
                type="number"
                min={0}
                value={newCryptoAsset.buySpreadBps}
                onChange={event => setNewCryptoAsset(current => ({ ...current, buySpreadBps: Number(event.target.value) }))}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Sell Spread (bps)
              <input
                type="number"
                min={0}
                value={newCryptoAsset.sellSpreadBps}
                onChange={event => setNewCryptoAsset(current => ({ ...current, sellSpreadBps: Number(event.target.value) }))}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Quote Validity (sec)
              <input
                type="number"
                min={30}
                value={newCryptoAsset.quoteTtlSeconds}
                onChange={event => setNewCryptoAsset(current => ({ ...current, quoteTtlSeconds: Number(event.target.value) }))}
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              />
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Execution Rail
              <select
                value={newCryptoAsset.executionRail}
                onChange={event => setNewCryptoAsset(current => {
                  const nextRail = event.target.value
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
                className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
              >
                {CRYPTO_EXECUTION_RAIL_OPTIONS.map(option => (
                  <option key={option.value || 'none'} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          {newCryptoAsset.executionRail === 'routed_treasury' && (
            <>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="text-[10px] text-[var(--muted)]">
                  Routed Profile
                  <select
                    value={newCryptoAsset.routedProfile}
                    onChange={event => applyNewAssetRoutedProfile(event.target.value)}
                    className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                  >
                    <option value="">Select profile</option>
                    {ROUTED_PROFILE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                    <option value="custom">Custom</option>
                  </select>
                </label>
              </div>
              {newCryptoAsset.routedProfile && newCryptoAsset.routedProfile !== 'custom' && (
                <div className="mt-3 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[10px] text-[var(--muted)]">
                  {getRoutedProfileConfig(newCryptoAsset.routedProfile)?.toChain} · {getRoutedProfileConfig(newCryptoAsset.routedProfile)?.toToken} · {getRoutedProfileConfig(newCryptoAsset.routedProfile)?.decimals} decimals
                </div>
              )}
              {newCryptoAsset.routedProfile === 'custom' && (
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="text-[10px] text-[var(--muted)]">
                    Routed Chain ID
                    <input
                      type="text"
                      value={newCryptoAsset.routedToChain}
                      onChange={event => setNewCryptoAsset(current => ({ ...current, routedToChain: event.target.value, routedProfile: 'custom' }))}
                      placeholder="42161"
                      className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                    />
                  </label>
                  <label className="text-[10px] text-[var(--muted)]">
                    Routed Token
                    <input
                      type="text"
                      value={newCryptoAsset.routedToToken}
                      onChange={event => setNewCryptoAsset(current => ({ ...current, routedToToken: event.target.value, routedProfile: 'custom' }))}
                      placeholder="0x0000000000000000000000000000000000000000"
                      className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                    />
                  </label>
                  <label className="text-[10px] text-[var(--muted)]">
                    Routed Decimals
                    <input
                      type="number"
                      min={0}
                      value={newCryptoAsset.routedDecimals}
                      onChange={event => setNewCryptoAsset(current => ({ ...current, routedDecimals: event.target.value, routedProfile: 'custom' }))}
                      placeholder="18"
                      className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                    />
                  </label>
                  <label className="text-[10px] text-[var(--muted)]">
                    Address Family
                    <select
                      value={newCryptoAsset.routedAddressFamily}
                      onChange={event => setNewCryptoAsset(current => ({ ...current, routedAddressFamily: event.target.value, routedProfile: 'custom' }))}
                      className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                    >
                      <option value="">Select family</option>
                      {ROUTED_ADDRESS_FAMILY_OPTIONS.map((option: string) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[10px] text-[var(--muted)]">
                    Minimum Buy (NGN)
                    <input
                      type="number"
                      min={1}
                      value={newCryptoAsset.minimumBuyNgn}
                      onChange={event => setNewCryptoAsset(current => ({ ...current, minimumBuyNgn: event.target.value, routedProfile: 'custom' }))}
                      placeholder="500"
                      className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                    />
                  </label>
                  <label className="text-[10px] text-[var(--muted)]">
                    Max Quote Drift (%)
                    <input
                      type="number"
                      min={0.01}
                      step="0.01"
                      value={newCryptoAsset.maxQuoteDriftPercent}
                      onChange={event => setNewCryptoAsset(current => ({ ...current, maxQuoteDriftPercent: event.target.value, routedProfile: 'custom' }))}
                      placeholder="1"
                      className="mt-1 w-full border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                    />
                  </label>
                </div>
              )}
            </>
          )}
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="text-[10px] text-[var(--muted)]">
              Generated Pair ID
              <div className="mt-1 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 font-mono text-[11px] text-[var(--text)]">
                {buildCryptoPairId(newCryptoAsset.symbol || 'TOKEN', newCryptoAsset.network)}
              </div>
            </div>
            <div className="text-[10px] text-[var(--muted)]">
              Live Market Price
              <div className="mt-1 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)]">
                {draftMarketRatePreview > 0
                  ? `₦${draftMarketRatePreview.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
                  : 'Will resolve after save'}
              </div>
            </div>
            <div className="text-[10px] text-[var(--muted)]">
              Derived Buy Rate
              <div className="mt-1 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)]">
                {draftMarketRatePreview > 0
                  ? `₦${computeBuyRate(draftMarketRatePreview, newCryptoAsset.buySpreadBps).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
                  : 'Will resolve after save'}
              </div>
            </div>
            <div className="text-[10px] text-[var(--muted)]">
              Derived Sell Rate
              <div className="mt-1 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)]">
                {draftMarketRatePreview > 0
                  ? `₦${computeSellRate(draftMarketRatePreview, newCryptoAsset.sellSpreadBps).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
                  : 'Will resolve after save'}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <AssetLogo
              src={newCryptoAsset.icon}
              alt={`${newCryptoAsset.symbol || 'Asset'} logo preview`}
              fallback={(newCryptoAsset.symbol || 'A').slice(0, 1)}
              className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--clay)]"
              imgClassName="h-8 w-8 object-contain"
              textClassName="text-lg font-bold text-[var(--gold2)]"
            />
            <label className="inline-flex cursor-pointer items-center gap-2 border border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[10px] font-bold text-[var(--text)]">
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
              {uploadingCryptoLogoId === 'draft' ? 'Uploading…' : 'Upload Logo'}
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-[10px] text-[var(--muted)]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newCryptoAsset.isActive}
                onChange={event => setNewCryptoAsset(current => ({ ...current, isActive: event.target.checked }))}
              />
              Active
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newCryptoAsset.transakEnabled}
                onChange={event => setNewCryptoAsset(current => ({ ...current, transakEnabled: event.target.checked }))}
              />
              Transak Enabled
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newCryptoAsset.baseExecutionEnabled}
                onChange={event => setNewCryptoAsset(current => ({ ...current, baseExecutionEnabled: event.target.checked }))}
              />
              Treasury Execution Enabled
            </label>
          </div>
          <div className="mt-4">
            <Button variant="secondary" onClick={addCryptoAssetDraft}>Add Pair To Draft</Button>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {visibleCryptoPricing.map(item => (
            <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AssetLogo
                    src={item.icon}
                    alt={`${item.symbol} logo preview`}
                    fallback={item.symbol.slice(0, 1)}
                    className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--coal)]"
                    imgClassName="h-8 w-8 object-contain"
                    textClassName="text-lg font-bold text-[var(--gold2)]"
                  />
                  <div>
                    <div className="text-[12px] font-bold text-[var(--text)]">{item.id}</div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">{item.name} · {item.symbol} · {item.network}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={item.isActive !== false}
                      onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, isActive: event.target.checked } : asset))}
                    />
                    Active
                  </label>
                  <Button
                    size="sm"
                    variant={item.isActive === false ? 'secondary' : 'danger'}
                    onClick={() => setCryptoPairArchived(item.id, item.isActive !== false)}
                  >
                    {item.isActive === false ? 'Restore Pair' : 'Archive Pair'}
                  </Button>
                </div>
              </div>
              {item.isActive === false && (
                <div className="mt-3 border border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] px-3 py-2 text-[10px] text-[var(--text)]">
                  This pair is archived. It will stay in history and admin records, but users cannot actively trade it once you save.
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex-1 text-[10px] text-[var(--muted)]">
                  Logo Path / URL
                  <input
                    type="text"
                    value={item.icon}
                    onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, icon: event.target.value } : asset))}
                    className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                  />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[10px] font-bold text-[var(--text)]">
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
                  {uploadingCryptoLogoId === item.id ? 'Uploading…' : 'Upload Logo'}
                </label>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-[10px] text-[var(--muted)]">
                  Live Price Feed ID
                  <input
                    type="text"
                    value={item.marketSourceId}
                    onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, marketSourceId: event.target.value } : asset))}
                    className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                  />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Quote Validity (sec)
                  <input
                    type="number"
                    min={30}
                    value={item.quoteTtlSeconds}
                    onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, quoteTtlSeconds: Number(event.target.value) } : asset))}
                    className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                  />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Execution Rail
                  <select
                    value={item.executionRail ?? ''}
                    onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? (() => {
                      const nextRail = event.target.value || undefined
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
                    className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                  >
                    {CRYPTO_EXECUTION_RAIL_OPTIONS.map(option => (
                      <option key={option.value || 'none'} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Buy Spread (bps)
                  <input
                    type="number"
                    min={0}
                    value={item.buySpreadBps}
                    onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, buySpreadBps: Number(event.target.value), buyRate: computeBuyRate(asset.marketRate, Number(event.target.value)) } : asset))}
                    className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                  />
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Sell Spread (bps)
                  <input
                    type="number"
                    min={0}
                    value={item.sellSpreadBps}
                    onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, sellSpreadBps: Number(event.target.value), sellRate: computeSellRate(asset.marketRate, Number(event.target.value)) } : asset))}
                    className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                  />
                </label>
              </div>
              {item.executionRail === 'routed_treasury' && (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="text-[10px] text-[var(--muted)]">
                      Routed Profile
                      <select
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
                        className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                      >
                        {ROUTED_PROFILE_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                  </div>
                  {!(customRoutedProfileIds[item.id] || findRoutedProfileForAsset(item) === 'custom') && (
                    <div className="mt-3 border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[10px] text-[var(--muted)]">
                      {item.routedToChain} · {item.routedToToken} · {item.routedDecimals} decimals
                    </div>
                  )}
                  {(customRoutedProfileIds[item.id] || findRoutedProfileForAsset(item) === 'custom') && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <label className="text-[10px] text-[var(--muted)]">
                        Routed Chain ID
                        <input
                          type="text"
                          value={item.routedToChain ?? ''}
                          onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, routedToChain: event.target.value } : asset))}
                          className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                        />
                      </label>
                      <label className="text-[10px] text-[var(--muted)]">
                        Routed Token
                        <input
                          type="text"
                          value={item.routedToToken ?? ''}
                          onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, routedToToken: event.target.value } : asset))}
                          className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                        />
                      </label>
                      <label className="text-[10px] text-[var(--muted)]">
                        Routed Decimals
                        <input
                          type="number"
                          min={0}
                          value={item.routedDecimals ?? ''}
                          onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, routedDecimals: parseOptionalNumber(event.target.value) } : asset))}
                          className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                        />
                      </label>
                      <label className="text-[10px] text-[var(--muted)]">
                        Address Family
                        <select
                          value={item.routedAddressFamily ?? ''}
                          onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, routedAddressFamily: event.target.value || undefined } : asset))}
                          className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                        >
                          <option value="">Select family</option>
                          {ROUTED_ADDRESS_FAMILY_OPTIONS.map((option: string) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[10px] text-[var(--muted)]">
                        Minimum Buy (NGN)
                        <input
                          type="number"
                          min={1}
                          value={item.minimumBuyNgn ?? ''}
                          onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, minimumBuyNgn: parseOptionalNumber(event.target.value) } : asset))}
                          className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                        />
                      </label>
                      <label className="text-[10px] text-[var(--muted)]">
                        Max Quote Drift (%)
                        <input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={item.maxQuoteDriftPercent ?? ''}
                          onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, maxQuoteDriftPercent: parseOptionalNumber(event.target.value) } : asset))}
                          className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none"
                        />
                      </label>
                    </div>
                  )}
                </>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="text-[10px] text-[var(--muted)]">
                  {renderPricingSourceLabel(item.pricingSource)}
                  <div className="mt-1 border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)]">
                    ₦{item.marketRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="text-[10px] text-[var(--muted)]">
                  Derived Buy Rate
                  <div className="mt-1 border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)]">
                    ₦{item.buyRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="text-[10px] text-[var(--muted)]">
                  Derived Sell Rate
                  <div className="mt-1 border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)]">
                    ₦{item.sellRate.toLocaleString('en-NG', { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-[var(--muted)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.transakEnabled !== false}
                    onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, transakEnabled: event.target.checked } : asset))}
                    disabled={item.isActive === false}
                  />
                  Transak Enabled
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.baseExecutionEnabled === true}
                    onChange={event => setCryptoPricing(current => current.map(asset => asset.id === item.id ? { ...asset, baseExecutionEnabled: event.target.checked } : asset))}
                    disabled={item.isActive === false}
                  />
                  Treasury Execution Enabled
                </label>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-[var(--muted)]">
                <span>{item.executionRail === 'routed_treasury' ? 'Routed execution config is admin-controlled for this asset.' : 'Pricing and execution flags are operator-controlled.'}</span>
                <span className={`border px-2 py-1 font-bold uppercase tracking-[.8px] ${item.pricingSource === 'live' ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] text-[var(--green2)]' : item.pricingSource === 'backup' ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]' : 'border-[rgba(220,38,38,.25)] bg-[rgba(220,38,38,.08)] text-[var(--red2)]'}`}>
                  {renderPricingSourceLabel(item.pricingSource)}
                </span>
              </div>
            </div>
          ))}
        </div>
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
        <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
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
              <select value={newRewardRule.kind} onChange={event => setNewRewardRule(current => ({ ...current, kind: event.target.value }))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                {REWARD_KIND_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-[var(--muted)]">
              Trigger
              <select
                value={newRewardRule.triggerEvent}
                onChange={event => setNewRewardRule(current => ({
                  ...current,
                  triggerEvent: event.target.value,
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
                  audience: event.target.value,
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
                  {REWARD_TRANSACTION_TYPE_OPTIONS.map((option: string) => (
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
                  {REWARD_TRANSACTION_TYPE_OPTIONS.map((option: string) => (
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
            <Button variant="secondary" onClick={addRewardRuleDraft}>Add Rule To Draft</Button>
          </div>
        </div>
        <div className="mt-4 grid gap-4">
          {rewardRules.map(rule => (
            <div key={rule.id} className="border border-[var(--border)] bg-[var(--clay)] p-4">
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
                  <select value={rule.kind} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, kind: event.target.value } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                    {REWARD_KIND_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Trigger
                  <select value={rule.triggerEvent} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, triggerEvent: event.target.value, allowedTransactionTypes: event.target.value === 'user_signup' ? undefined : item.allowedTransactionTypes, excludedTransactionTypes: event.target.value === 'user_signup' ? undefined : item.excludedTransactionTypes } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                    {REWARD_TRIGGER_OPTIONS.map((option: string) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="text-[10px] text-[var(--muted)]">
                  Audience
                  <select value={rule.audience} onChange={event => setRewardRules(current => current.map(item => item.id === rule.id ? { ...item, audience: event.target.value, requiresReferral: event.target.value === 'inviter' ? true : item.requiresReferral } : item))} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
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
                      {REWARD_TRANSACTION_TYPE_OPTIONS.map((option: string) => (
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
                      {REWARD_TRANSACTION_TYPE_OPTIONS.map((option: string) => (
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
          ))}
        </div>
        {rewardRules.length === 0 && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">
            No reward rules configured yet.
          </div>
        )}
        <div className="mt-4">
          <Button onClick={() => void saveRewardRuleCatalog()} disabled={savingRewardRules}>
            {savingRewardRules ? 'Saving…' : 'Save Reward Rules'}
          </Button>
        </div>
      </Card>}

      {showBills && <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold text-[var(--text)]">Bill Providers</div>
          <div className="flex gap-2">
            {(['all', 'active', 'archived'] as const).map(filter => (
              <button key={filter} type="button" onClick={() => setBillCatalogFilter(filter)} className={`border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[1px] ${billCatalogFilter === filter ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)] text-[var(--gold2)]' : 'border-[var(--border)] bg-[var(--clay)] text-[var(--muted)]'}`}>
                {filter}
              </button>
            ))}
          </div>
        </div>
        <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
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
              <select value={newBillProvider.type} onChange={event => { const nextType = event.target.value; setNewBillProvider(current => ({ ...current, type: nextType, icon: current.icon || BILL_ICON_SUGGESTIONS[nextType] || '', requiresNetwork: nextType === 'airtime' || nextType === 'data' })) }} className="mt-1 w-full border border-[var(--border)] bg-[var(--coal)] px-3 py-2 text-[11px] text-[var(--text)] outline-none">
                {BILL_PROVIDER_TYPES.map((type: string) => <option key={type} value={type}>{type}</option>)}
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
            <Button variant="secondary" onClick={addBillProviderDraft}>Add Service To Draft</Button>
          </div>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {visibleBillProviders.map(item => (
            <div key={item.id} className="border border-[var(--border)] bg-[var(--clay)] p-4">
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
          ))}
        </div>
        {visibleBillProviders.length === 0 && (
          <div className="mt-4 border border-[var(--border)] bg-[var(--clay)] px-4 py-3 text-[10px] text-[var(--muted)]">
            No bill services match the current filter.
          </div>
        )}
        <div className="mt-4">
          <Button onClick={() => void saveBillProviderCatalog()} disabled={savingBillProviders}>
            {savingBillProviders ? 'Saving…' : 'Save Bill Providers'}
          </Button>
        </div>
      </Card>}

      {showRaw && <div className="grid gap-6 xl:grid-cols-2">
        {ADMIN_ENDPOINTS.filter(config => config.key !== 'assets' && config.key !== 'billProviders' && config.key !== 'rewardRules').map(config => (
          <Card key={config.key} className="p-5">
            <div className="mb-3 text-[11px] font-bold text-[var(--text)]">{config.title}</div>
            <textarea
              value={drafts[config.key]}
              onChange={event => setDrafts((current: Record<string, string>) => ({ ...current, [config.key]: event.target.value }))}
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
