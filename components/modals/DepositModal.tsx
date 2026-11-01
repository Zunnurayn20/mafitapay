'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight, ArrowRight, Building2, Check, Coins, Copy, Shield } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { CexLogo } from '@/components/ui/CexLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { getNetworkFallbackLabel, getNetworkIconUrl } from '@/lib/crypto-networks'
import { groupCryptoAssetsBySymbol, isDepositableCryptoAsset } from '@/lib/crypto-deposit-assets'
import type { CexExchange, CryptoAsset, Wallet } from '@/types'

type FundingAccount = Wallet['virtualAccounts'][number]
type FundingProvider = 'palmpay' | 'flutterwave'
type DepositTab = 'bank' | 'crypto' | 'exchanges'
type ExchangeDepositOption = { exchange: CexExchange; linked: boolean }

const CEX_EXCHANGES: CexExchange[] = ['bybit', 'bitget', 'okx', 'mexc', 'gateio']

const DEPOSIT_TABS: Array<{ id: DepositTab; label: string; Icon: typeof Building2 }> = [
  { id: 'bank', label: 'Bank transfer', Icon: Building2 },
  { id: 'crypto', label: 'Crypto', Icon: Coins },
  { id: 'exchanges', label: 'Exchanges', Icon: ArrowLeftRight },
]

function providerLabel(provider: FundingProvider | FundingAccount['provider']) {
  if (provider === 'palmpay') return 'PalmPay'
  if (provider === 'flutterwave') return 'Flutterwave'
  return provider
}

function cexExchangeLabel(exchange: CexExchange) {
  return exchange === 'bybit' ? 'Bybit' : exchange === 'bitget' ? 'Bitget' : exchange === 'okx' ? 'OKX' : exchange === 'mexc' ? 'MEXC' : 'Gate.io'
}

export function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const wallet = useAppStore(state => state.wallet)
  const kycSubmission = useAppStore(state => state.kycSubmission)
  const fundingAccountEligibility = useAppStore(state => state.fundingAccountEligibility)
  const closeModal = useAppStore(state => state.closeModal)
  const refreshSession = useAppStore(state => state.refreshSession)
  const showToast = useAppStore(state => state.showToast)
  const openModal = useAppStore(state => state.openModal)
  const setModalData = useAppStore(state => state.setModalData)
  const palmpayAccount = wallet?.virtualAccounts.find(item => item.provider === 'palmpay' && item.isPermanent)
  const flutterwaveAccount = wallet?.virtualAccounts.find(item => item.provider === 'flutterwave' && item.isPermanent)
  const primaryAccount = palmpayAccount ?? flutterwaveAccount ?? null
  const [loadingProvider, setLoadingProvider] = useState<FundingProvider | null>(null)
  const [copiedNumber, setCopiedNumber] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<FundingProvider>('palmpay')
  const [activeTab, setActiveTab] = useState<DepositTab>('bank')
  const [networkPickerSymbol, setNetworkPickerSymbol] = useState<string | null>(null)
  const [exchangeDepositOptions, setExchangeDepositOptions] = useState<ExchangeDepositOption[]>([])
  const hasSubmittedFundingIdentity = Boolean(
    kycSubmission
    && kycSubmission.status !== 'rejected'
    && (kycSubmission.documentType === 'bvn' || kycSubmission.documentType === 'nin')
  )
  const hasRejectedFundingIdentity = Boolean(
    kycSubmission?.status === 'rejected'
    && (kycSubmission.documentType === 'bvn' || kycSubmission.documentType === 'nin')
  )

  const assets = useCryptoAssets()
  const sellableAssets = useMemo(
    () => assets.filter(item => item.sellEnabled !== false && isDepositableCryptoAsset(item)),
    [assets]
  )
  const depositAssetGroups = useMemo(() => groupCryptoAssetsBySymbol(sellableAssets), [sellableAssets])
  const networkPickerGroup = depositAssetGroups.find(group => group.symbol === networkPickerSymbol) ?? null
  const exchangeDepositAsset = sellableAssets.find(item => item.id === 'USDT_BSC')
    ?? sellableAssets.find(item => item.symbol.toUpperCase() === 'USDT')

  useEffect(() => {
    if (!open) {
      setNetworkPickerSymbol(null)
      return
    }
    setActiveTab('bank')
  }, [open])

  useEffect(() => {
    if (!open) return
    if (palmpayAccount) {
      setSelectedProvider('palmpay')
      return
    }
    if (flutterwaveAccount) {
      setSelectedProvider('flutterwave')
    }
  }, [open, palmpayAccount, flutterwaveAccount])

  useEffect(() => {
    if (!open) {
      setExchangeDepositOptions([])
      return
    }
    let cancelled = false
    void fetch('/api/crypto/cex-deposit-account', { cache: 'no-store' })
      .then(response => response.json())
      .then(payload => {
        if (!cancelled) {
          const exchanges = Object.values(payload?.data?.exchanges ?? {}) as Array<{ enabled?: boolean; exchange?: string; account?: { status?: string } | null }>
          const options = exchanges.flatMap(item => {
            const exchange = CEX_EXCHANGES.find(candidate => candidate === item.exchange)
            return item.enabled && exchange ? [{ exchange, linked: Boolean(item.account) }] : []
          })
          setExchangeDepositOptions(payload?.success === true ? options : [])
        }
      })
      .catch(() => {
        if (!cancelled) setExchangeDepositOptions([])
      })
    return () => { cancelled = true }
  }, [open])

  const selectedAccount = selectedProvider === 'palmpay' ? palmpayAccount : flutterwaveAccount
  const hasAnyAccount = Boolean(palmpayAccount || flutterwaveAccount)

  async function generatePermanentAccount(provider: FundingProvider) {
    if (provider === 'flutterwave' && !fundingAccountEligibility.eligible) {
      showToast(fundingAccountEligibility.message, 'error')
      return
    }

    setLoadingProvider(provider)
    try {
      const response = await fetch('/api/wallet/deposit/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider }),
      })
      const payload = await response.json()

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Deposit failed.')
      }

      await refreshSession()
      setSelectedProvider(provider)
      showToast(payload.data.existing ? 'Funding account already assigned.' : 'Funding account created.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Funding account setup failed.', 'error')
    } finally {
      setLoadingProvider(null)
    }
  }

  function goToKyc() {
    closeModal()
    onClose()
    router.push('/kyc')
  }

  async function copyAccountNumber(accountNumber: string) {
    await navigator.clipboard?.writeText(accountNumber)
    setCopiedNumber(accountNumber)
    showToast('Funding account copied.')
    setTimeout(() => {
      setCopiedNumber(current => (current === accountNumber ? null : current))
    }, 1500)
  }

  function depositWithCrypto(asset: CryptoAsset) {
    setNetworkPickerSymbol(null)
    closeModal()
    onClose()
    setModalData({ cryptoAsset: asset, cryptoPairId: asset.id })
    openModal('sell')
  }

  function depositFromExchange(exchange: CexExchange) {
    if (!exchangeDepositAsset) return
    setNetworkPickerSymbol(null)
    closeModal()
    onClose()
    setModalData({
      cryptoAsset: exchangeDepositAsset,
      cryptoPairId: exchangeDepositAsset.id,
      cryptoDepositMethod: 'exchange',
      cryptoCexExchange: exchange,
    })
    openModal('sell')
  }

  function handleAssetClick(group: { symbol: string; options: CryptoAsset[] }) {
    setNetworkPickerSymbol(group.symbol)
  }

  function renderGeneratePanel(options: {
    title: string
    description: string
    provider: FundingProvider
    eligible: boolean
    blockedMessage: string
  }) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-[rgba(202,165,96,.26)] bg-[linear-gradient(180deg,#fcf7ec_0%,#f6efdd_100%)] p-4 text-[#2c2418] shadow-[0_12px_28px_rgba(0,0,0,.14)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(90deg,rgba(202,165,96,.55)_0_16px,transparent_16px_24px)]"
        />
        <div className="relative min-w-0 pt-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8c6b31]">
            {options.title}
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-[#7c6a4b]">{options.description}</div>
        </div>

        {options.eligible ? (
          <>
            <div className="relative mt-3 text-[11px] text-[#7c6a4b]">
              Approved {kycSubmission?.documentType?.toUpperCase()} on file
            </div>
            <button
              type="button"
              className="relative mt-3 w-full rounded-xl bg-[#8c6b31] py-3 text-xs font-bold text-white transition-transform active:scale-[0.99] disabled:opacity-60"
              onClick={() => void generatePermanentAccount(options.provider)}
              disabled={loadingProvider !== null}
            >
              {loadingProvider === options.provider
                ? `Assigning ${providerLabel(options.provider)}…`
                : `Create ${providerLabel(options.provider)} account`}
            </button>
          </>
        ) : (
          <>
            <div className="relative mt-3 text-[11px] leading-relaxed text-[#8c6b31]">{options.blockedMessage}</div>
            <button
              type="button"
              className="relative mt-3 w-full rounded-xl bg-[#8c6b31] py-3 text-xs font-bold text-white transition-transform active:scale-[0.99]"
              onClick={goToKyc}
            >
              Open KYC page
            </button>
          </>
        )}
      </div>
    )
  }

  function renderAccountCard(account: FundingAccount) {
    const copied = copiedNumber === account.accountNumber

    return (
      <div className="relative overflow-hidden rounded-2xl border border-[rgba(202,165,96,.26)] bg-[linear-gradient(180deg,#fcf7ec_0%,#f6efdd_100%)] p-4 text-[#2c2418] shadow-[0_12px_28px_rgba(0,0,0,.14)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(90deg,rgba(202,165,96,.55)_0_16px,transparent_16px_24px)]"
        />
        <div className="relative pt-1">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-[#7c6a4b]">
            <Building2 size={14} className="text-[#8c6b31]" />
            <span className="truncate font-bold uppercase tracking-[0.06em]">Bank name:</span>
            <span className="ml-auto shrink-0 rounded-full border border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.7)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] text-[#8c6b31]">
              {providerLabel(account.provider)}
            </span>
          </div>
          <div className="text-sm font-semibold text-[#1f1a12]">{account.bank}</div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="font-mono text-[22px] font-bold tracking-wider text-[#1f1a12] sm:text-2xl">
              {account.accountNumber}
            </div>
            <button
              type="button"
              onClick={() => void copyAccountNumber(account.accountNumber)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.7)] px-3 py-2 text-xs font-bold text-[#8c6b31] transition-transform active:scale-[0.98]"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="mt-3 text-[11px] font-bold uppercase tracking-[1px] text-[#8c6b31]">Account name</div>
          <div className="mt-0.5 text-sm font-semibold text-[#1f1a12]">{account.accountName}</div>
        </div>
      </div>
    )
  }

  return (
    <>
    <Modal open={open} onClose={onClose} title="Deposit Funds">
      <div className="flex flex-col gap-3.5 p-5">
        <div role="tablist" aria-label="Deposit method" className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--border)] bg-[var(--coal)] p-1">
          {DEPOSIT_TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                id={`deposit-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`deposit-panel-${id}`}
                onClick={() => setActiveTab(id)}
                className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-center text-[10px] font-semibold transition-colors sm:flex-row sm:gap-1.5 sm:px-3 sm:text-[11px] ${active ? 'bg-[var(--gold)] text-[var(--char)] shadow-sm' : 'text-[var(--text2)] hover:bg-[var(--clay)]'}`}
              >
                <Icon size={14} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            )
          })}
        </div>

        {activeTab === 'bank' && <div role="tabpanel" id="deposit-panel-bank" aria-labelledby="deposit-tab-bank" className="flex flex-col gap-3.5">
        {!hasSubmittedFundingIdentity ? (
          <div className="flex gap-3 rounded-xl border border-amber-200/80 bg-amber-50 p-4">
            <Shield size={18} className="mt-0.5 shrink-0 text-amber-700" />
            <div className="text-xs leading-relaxed text-amber-900">
              {hasRejectedFundingIdentity
                ? 'Your BVN or NIN was rejected. Submit a valid BVN or NIN to create a funding account.'
                : 'Submit a BVN or NIN to request a funding account. Generation can start while KYC review continues.'}
              <button
                type="button"
                onClick={goToKyc}
                className="mt-1 block font-semibold underline"
              >
                Open KYC page
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[rgba(202,165,96,0.18)] bg-[rgba(202,165,96,0.06)] px-3.5 py-2.5 text-[11px] leading-relaxed text-[var(--text2)]">
            Transfer to your funding account. Wallet credit follows confirmed provider settlement.
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
            Fund via bank transfer
          </div>
          <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--clay)] p-0.5">
            {(['palmpay', 'flutterwave'] as FundingProvider[]).map(id => {
              const active = selectedProvider === id
              const hasAccount = id === 'palmpay' ? Boolean(palmpayAccount) : Boolean(flutterwaveAccount)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedProvider(id)}
                  className={`rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--text)] text-[var(--char)]'
                      : 'text-[var(--text2)]'
                  } ${!hasAccount && !active ? 'opacity-55' : ''}`}
                >
                  {providerLabel(id)}
                </button>
              )
            })}
          </div>
        </div>

        {selectedAccount ? (
          <>
            {renderAccountCard(selectedAccount)}
          </>
        ) : selectedProvider === 'palmpay' ? (
          renderGeneratePanel({
            title: 'PalmPay funding account',
            description: 'Primary wallet top-up route.',
            provider: 'palmpay',
            eligible: hasSubmittedFundingIdentity,
            blockedMessage: hasRejectedFundingIdentity
              ? 'Your BVN or NIN was rejected. Submit a valid BVN or NIN to unlock PalmPay.'
              : 'Submit a BVN or NIN to unlock PalmPay.',
          })
        ) : (
          renderGeneratePanel({
            title: 'Flutterwave funding account',
            description: 'Optional second funding route.',
            provider: 'flutterwave',
            eligible: fundingAccountEligibility.eligible,
            blockedMessage: fundingAccountEligibility.message,
          })
        )}
        {hasAnyAccount && (
          <Button className="w-full rounded-xl py-3" onClick={() => { closeModal(); onClose() }}>
            Done
          </Button>
        )}
        </div>}

        {activeTab === 'exchanges' && <div role="tabpanel" id="deposit-panel-exchanges" aria-labelledby="deposit-tab-exchanges" className="flex flex-col gap-3.5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--gold2)]">Deposit from an exchange</div>
            <div className="mt-1 text-[12px] leading-relaxed text-[var(--text2)]">Send USDT or USDC using an internal transfer from an exchange account linked to your MafitaPay profile.</div>
          </div>
          {!exchangeDepositAsset ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--coal)] p-4 text-[11px] leading-relaxed text-[var(--muted)]">Exchange deposits are temporarily unavailable.</div>
          ) : exchangeDepositOptions.length > 0 ? (
            <div className="flex flex-col gap-2">
              {exchangeDepositOptions.map(option => {
                return (
                  <button
                    key={option.exchange}
                    type="button"
                    onClick={() => depositFromExchange(option.exchange)}
                    className="flex w-full items-center gap-3 rounded-xl border border-black bg-[var(--coal)] px-3.5 py-3 text-left transition-all hover:bg-[var(--clay)] active:scale-[0.99]"
                  >
                    <CexLogo exchange={option.exchange} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-bold text-[var(--text)]">{cexExchangeLabel(option.exchange)}</span>
                      <span className="mt-0.5 block text-[9px] text-[var(--muted)]">USDT or USDC · internal transfer</span>
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-semibold ${option.linked ? 'border-[var(--green2)]/30 bg-[var(--green2)]/10 text-[var(--green2)]' : 'border-[var(--border)] text-[var(--text2)]'}`}>
                      {option.linked ? 'Linked' : 'Set up'}
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--coal)] p-4 text-[11px] leading-relaxed text-[var(--muted)]">Exchange deposits are temporarily unavailable.</div>
          )}
        </div>}

        {activeTab === 'crypto' && <div role="tabpanel" id="deposit-panel-crypto" aria-labelledby="deposit-tab-crypto" className="flex flex-col gap-3.5">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--coal)] p-4 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.45)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--gold2)]">
            Crypto deposits
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-[var(--text2)]">
            Send supported crypto. MafitaPay detects the deposit and credits your NGN balance at the live sell rate.
          </div>
          {depositAssetGroups.length === 0 ? (
            <div className="mt-3 text-[11px] text-[var(--muted)]">No crypto deposit options available yet.</div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {depositAssetGroups.map(group => (
                <button
                  key={group.symbol}
                  type="button"
                  onClick={() => handleAssetClick(group)}
                  className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--clay)] p-2.5 text-left transition-colors hover:border-[var(--gold)] hover:bg-[var(--clay2)] active:scale-[0.99]"
                >
                  <AssetLogo
                    src={group.icon}
                    alt={`${group.symbol} logo`}
                    fallback={group.symbol.slice(0, 1)}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg"
                    imgClassName="h-6 w-6 object-contain"
                    textClassName="text-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold text-[var(--text)]">{group.symbol}</div>
                    <div className="mt-0.5 text-[9px] text-[var(--text2)]">
                      {group.options.length === 1
                        ? group.options[0].network
                        : `${group.options.length} networks`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 text-[10px] text-[var(--muted)]">
            Tap an asset, then choose a network for the deposit address.
          </div>
        </div>
        </div>}
      </div>
    </Modal>

    <Modal
      open={Boolean(networkPickerGroup)}
      onClose={() => setNetworkPickerSymbol(null)}
      title={`Select ${networkPickerGroup?.symbol ?? ''} network`}
      subtitle="Choose where you will send the deposit"
      size="sm"
    >
      <div className="flex flex-col gap-2 p-5">
        {networkPickerGroup?.options.map(asset => (
          <button
            key={asset.id}
            type="button"
            onClick={() => depositWithCrypto(asset)}
            className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--clay)] px-3.5 py-3 text-left transition-colors hover:border-[var(--gold)] hover:bg-[var(--clay2)] active:scale-[0.99]"
          >
            <AssetLogo
              src={getNetworkIconUrl(asset.network)}
              alt={`${asset.network} network logo`}
              fallback={getNetworkFallbackLabel(asset.network)}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg"
              imgClassName="h-6 w-6 object-contain"
              textClassName="text-sm font-bold text-[var(--text2)]"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-[var(--text)]">{asset.network}</div>
              <div className="mt-0.5 truncate text-[11px] text-[var(--text2)]">
                {asset.name} · {asset.symbol}
              </div>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--gold2)]">
              Select
            </span>
          </button>
        ))}
      </div>
    </Modal>
    </>
  )
}
