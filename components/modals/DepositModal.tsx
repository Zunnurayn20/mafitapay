'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import type { CryptoAsset, CryptoDepositAddressFamily, Wallet } from '@/types'

type FundingAccount = Wallet['virtualAccounts'][number]

function getAddressFamilyForAsset(asset?: CryptoAsset): CryptoDepositAddressFamily | null {
  if (!asset) return null
  const network = asset.network.trim().toLowerCase()
  if (asset.routedAddressFamily === 'solana' || network === 'solana') return 'solana'
  if (network === 'ton') return 'ton'
  if (network === 'near') return 'near'
  if (network === 'sui') return 'sui'
  if (network === 'base' || network === 'bsc' || network === 'ethereum' || network === 'polygon' || network === 'matic' || asset.routedAddressFamily === 'evm') return 'evm'
  return null
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
  const cryptoDepositAddresses = useAppStore(state => state.cryptoDepositAddresses)
  const palmpayAccount = wallet?.virtualAccounts.find(item => item.provider === 'palmpay' && item.isPermanent)
  const flutterwaveAccount = wallet?.virtualAccounts.find(item => item.provider === 'flutterwave' && item.isPermanent)
  const primaryAccount = palmpayAccount ?? flutterwaveAccount ?? null
  const [loadingProvider, setLoadingProvider] = useState<'palmpay' | 'flutterwave' | null>(null)
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

  async function generatePermanentAccount(provider: 'palmpay' | 'flutterwave') {
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
    showToast('Funding account copied.')
  }

  function depositWithCrypto(asset: CryptoAsset) {
    closeModal()
    onClose()
    setModalData({ cryptoAsset: asset, cryptoPairId: asset.id })
    openModal('sell')
  }

  function renderGeneratePanel(options: {
    title: string
    description: string
    provider: 'palmpay' | 'flutterwave'
    variant?: 'primary' | 'secondary'
    eligible: boolean
    blockedMessage: string
  }) {
    return (
      <div className="border border-[var(--border)] bg-[var(--clay)] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">{options.title}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-[var(--text2)]">{options.description}</div>
          </div>
          {options.provider === 'palmpay' ? (
            <span className="border border-[rgba(46,170,92,.24)] bg-[rgba(46,170,92,.1)] px-2 py-1 text-[8px] font-bold uppercase tracking-[1px] text-[var(--green2)]">
              Default
            </span>
          ) : null}
        </div>

        {options.eligible ? (
          <>
            <div className="mt-3 text-[10px] text-[var(--muted)]">
              Approved {kycSubmission?.documentType?.toUpperCase()} on file
            </div>
            <Button
              variant={options.variant === 'secondary' ? 'secondary' : 'primary'}
              className="mt-3 w-full py-2.5"
              onClick={() => void generatePermanentAccount(options.provider)}
              disabled={loadingProvider !== null}
            >
              {loadingProvider === options.provider
                ? `Assigning ${options.provider === 'palmpay' ? 'PalmPay' : 'Flutterwave'}…`
                : `Generate ${options.provider === 'palmpay' ? 'PalmPay' : 'Flutterwave'} Account`}
            </Button>
          </>
        ) : (
          <>
            <div className="mt-3 text-[10px] text-[rgba(233,214,186,0.62)]">{options.blockedMessage}</div>
            <Button
              variant={options.variant === 'secondary' ? 'secondary' : 'primary'}
              className="mt-3 w-full py-2.5"
              onClick={goToKyc}
            >
              Open KYC Page
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Deposit Funds">
      <div className="p-5 flex flex-col gap-3.5">
        <div className="border border-[rgba(202,165,96,0.18)] bg-[rgba(202,165,96,0.06)] px-3 py-2.5 text-[10px] leading-relaxed text-[var(--text2)]">
          Funding accounts require approved BVN or NIN KYC. Wallet credit follows confirmed provider settlement.
        </div>
        {!primaryAccount && !flutterwaveAccount ? (
          <div className="space-y-3">
            {renderGeneratePanel({
              title: 'PalmPay Funding Account',
              description: 'Primary wallet top-up route.',
              provider: 'palmpay',
              eligible: hasApprovedFundingIdentity,
              blockedMessage: 'Submit approved BVN or NIN to unlock PalmPay.',
            })}
            {renderGeneratePanel({
              title: 'Flutterwave Funding Account',
              description: 'Optional second funding route.',
              provider: 'flutterwave',
              variant: 'secondary',
              eligible: fundingAccountEligibility.eligible,
              blockedMessage: fundingAccountEligibility.message,
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {[palmpayAccount, flutterwaveAccount].filter((item): item is FundingAccount => Boolean(item)).map((account, index) => (
            <div key={`${account.provider}-${account.accountNumber}-${index}`} className="relative overflow-hidden border border-[rgba(202,165,96,0.28)] bg-[linear-gradient(180deg,rgba(66,46,28,0.96)_0%,rgba(45,31,19,0.98)_100%)] p-3.5 sm:p-4">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-[0.16]"
                style={{
                  backgroundImage: `
                    radial-gradient(circle at 18px 18px, rgba(224,196,138,0.22) 0 2px, transparent 2px),
                    linear-gradient(135deg, transparent 0 40%, rgba(202,165,96,0.18) 40% 44%, transparent 44% 56%, rgba(202,165,96,0.18) 56% 60%, transparent 60% 100%),
                    linear-gradient(45deg, transparent 0 40%, rgba(140,107,49,0.14) 40% 44%, transparent 44% 56%, rgba(140,107,49,0.14) 56% 60%, transparent 60% 100%)
                  `,
                  backgroundSize: '28px 28px, 72px 72px, 72px 72px',
                  backgroundPosition: '0 0, 0 0, 36px 36px',
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-[-1rem] w-24 bg-center bg-no-repeat opacity-[0.12]"
                style={{ backgroundImage: "url('/mafitapay-logo.png')", backgroundSize: 'contain' }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
                style={{ background: 'repeating-linear-gradient(90deg,var(--gold) 0,var(--gold) 10px,var(--terra) 10px,var(--terra) 18px,var(--green) 18px,var(--green) 26px,var(--char) 26px,var(--char) 30px)' }}
              />
              <div className="relative z-[1]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[8px] font-bold uppercase tracking-[1.2px] text-[var(--gold2)]">{account.provider === 'palmpay' ? 'PalmPay' : 'Flutterwave'}</div>
                    <div className="mt-1 text-[10px] text-[rgba(233,214,186,0.62)]">{account.bank}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyAccountNumber(account.accountNumber)}
                  className="mt-3 flex w-full items-center justify-between gap-3 border-y border-dashed border-[rgba(224,196,138,0.22)] py-3 text-left transition-colors hover:bg-[rgba(224,196,138,0.04)]"
                >
                  <div className="font-mono text-[22px] font-black tracking-[2.5px] text-[rgba(244,231,208,0.9)] sm:text-[26px]">
                    {account.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim()}
                  </div>
                  <span className="inline-flex h-8 w-8 items-center justify-center border border-[rgba(224,196,138,0.22)] bg-[rgba(224,196,138,0.08)] text-[var(--gold2)]">
                    <Copy size={14} />
                  </span>
                </button>
                <div className="mt-3 text-[11px] font-semibold text-[rgba(244,231,208,0.88)]">
                  {account.accountName}
                </div>
              </div>
            </div>
            ))}

            {!palmpayAccount ? (
              renderGeneratePanel({
                title: 'Add PalmPay Account',
                description: 'Create your primary funding route.',
                provider: 'palmpay',
                eligible: hasApprovedFundingIdentity,
                blockedMessage: 'Submit approved BVN or NIN to unlock PalmPay.',
              })
            ) : null}

            {!flutterwaveAccount ? (
              renderGeneratePanel({
                title: 'Add Flutterwave Account',
                description: 'Optional second funding route.',
                provider: 'flutterwave',
                variant: 'secondary',
                eligible: fundingAccountEligibility.eligible,
                blockedMessage: fundingAccountEligibility.message,
              })
            ) : null}
          </div>
        )}

        {/* Crypto deposit options */}
        <div className="border border-[rgba(202,165,96,.24)] bg-[var(--clay)] p-4">
          <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Crypto Deposits</div>
          <div className="mt-1 text-[11px] leading-relaxed text-[var(--text2)]">
            Send supported cryptocurrencies. MafitaPay detects the deposit and credits your NGN balance at the live sell rate.
          </div>
          {sellableAssets.length === 0 ? (
            <div className="mt-3 text-[10px] text-[var(--muted)]">No crypto deposit options available yet.</div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {sellableAssets.map(asset => {
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => depositWithCrypto(asset)}
                    className="flex items-center gap-2 border border-[var(--border)] bg-[var(--clay2)] p-2 text-left hover:border-[var(--gold)] hover:bg-[var(--clay)]"
                  >
                    <AssetLogo
                      src={asset.icon}
                      alt={`${asset.symbol} logo`}
                      fallback={asset.symbol.slice(0, 1)}
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden"
                      imgClassName="h-6 w-6 object-contain"
                      textClassName="text-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1">
                        <span className="text-[11px] font-bold">{asset.symbol}</span>
                        <span className="text-[8px] text-[var(--text2)]">{asset.network}</span>
                      </div>
                    </div>
                    <div className="text-[8px] text-[var(--muted)]">Deposit →</div>
                  </button>
                )
              })}
            </div>
          )}
          <div className="mt-2 text-[9px] text-[var(--muted)]">Tap any to view deposit address and QR code.</div>
        </div>

        {(primaryAccount || flutterwaveAccount) && (
          <div className="flex gap-3 pt-1">
            <Button className="flex-1 py-2.5" onClick={() => { closeModal(); onClose() }}>
              Done
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
