'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, Copy, Shield } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { getNetworkFallbackLabel, getNetworkIconUrl } from '@/lib/crypto-networks'
import type { CryptoAsset, CryptoDepositAddressFamily, Wallet } from '@/types'

type FundingAccount = Wallet['virtualAccounts'][number]
type FundingProvider = 'palmpay' | 'flutterwave'

function getAddressFamilyForAsset(asset?: CryptoAsset): CryptoDepositAddressFamily | null {
  if (!asset) return null
  const network = asset.network.trim().toLowerCase()
  if (asset.routedAddressFamily === 'solana' || network === 'solana') return 'solana'
  if (network === 'ton') return 'ton'
  if (network === 'near') return 'near'
  if (network === 'sui') return 'sui'
  if (
    network === 'base'
    || network === 'bsc'
    || network === 'ethereum'
    || network === 'polygon'
    || network === 'matic'
    || asset.routedAddressFamily === 'evm'
  ) {
    return 'evm'
  }
  return null
}

function providerLabel(provider: FundingProvider | FundingAccount['provider']) {
  if (provider === 'palmpay') return 'PalmPay'
  if (provider === 'flutterwave') return 'Flutterwave'
  return provider
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
  const [networkPickerSymbol, setNetworkPickerSymbol] = useState<string | null>(null)
  const hasApprovedFundingIdentity = Boolean(
    kycSubmission
    && kycSubmission.status === 'approved'
    && (kycSubmission.documentType === 'bvn' || kycSubmission.documentType === 'nin')
  )

  const assets = useCryptoAssets()
  const sellableAssets = useMemo(
    () => assets.filter(asset => Boolean(getAddressFamilyForAsset(asset))),
    [assets]
  )
  const depositAssetGroups = useMemo(() => {
    const groups = new Map<string, CryptoAsset[]>()
    for (const asset of sellableAssets) {
      const key = asset.symbol.toUpperCase()
      const current = groups.get(key) ?? []
      current.push(asset)
      groups.set(key, current)
    }
    return Array.from(groups.entries()).map(([symbol, options]) => ({
      symbol,
      name: options[0]?.name ?? symbol,
      icon: options[0]?.icon ?? '',
      options: options.sort((a, b) => a.network.localeCompare(b.network)),
    }))
  }, [sellableAssets])
  const networkPickerGroup = depositAssetGroups.find(group => group.symbol === networkPickerSymbol) ?? null

  useEffect(() => {
    if (!open) {
      setNetworkPickerSymbol(null)
      return
    }
    if (palmpayAccount) {
      setSelectedProvider('palmpay')
      return
    }
    if (flutterwaveAccount) {
      setSelectedProvider('flutterwave')
    }
  }, [open, palmpayAccount, flutterwaveAccount])

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
            <span className="truncate font-medium">{account.bank}</span>
            <span className="ml-auto shrink-0 rounded-full border border-[rgba(140,107,49,.25)] bg-[rgba(255,255,255,.7)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] text-[#8c6b31]">
              {providerLabel(account.provider)}
            </span>
          </div>

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
        {!hasApprovedFundingIdentity ? (
          <div className="flex gap-3 rounded-xl border border-amber-200/80 bg-amber-50 p-4">
            <Shield size={18} className="mt-0.5 shrink-0 text-amber-700" />
            <div className="text-xs leading-relaxed text-amber-900">
              Funding accounts need approved BVN or NIN KYC. Complete verification to unlock bank top-up.
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
          renderAccountCard(selectedAccount)
        ) : selectedProvider === 'palmpay' ? (
          renderGeneratePanel({
            title: 'PalmPay funding account',
            description: 'Primary wallet top-up route.',
            provider: 'palmpay',
            eligible: hasApprovedFundingIdentity,
            blockedMessage: 'Submit approved BVN or NIN to unlock PalmPay.',
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

        {hasAnyAccount && (
          <Button className="w-full rounded-xl py-3" onClick={() => { closeModal(); onClose() }}>
            Done
          </Button>
        )}
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
