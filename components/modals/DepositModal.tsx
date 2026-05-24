'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store'
import type { Wallet } from '@/types'

type FundingAccount = Wallet['virtualAccounts'][number]

export function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const wallet = useAppStore(state => state.wallet)
  const kycSubmission = useAppStore(state => state.kycSubmission)
  const fundingAccountEligibility = useAppStore(state => state.fundingAccountEligibility)
  const closeModal = useAppStore(state => state.closeModal)
  const refreshSession = useAppStore(state => state.refreshSession)
  const showToast = useAppStore(state => state.showToast)
  const palmpayAccount = wallet?.virtualAccounts.find(item => item.provider === 'palmpay' && item.isPermanent)
  const flutterwaveAccount = wallet?.virtualAccounts.find(item => item.provider === 'flutterwave' && item.isPermanent)
  const primaryAccount = palmpayAccount ?? flutterwaveAccount ?? null
  const [loadingProvider, setLoadingProvider] = useState<'palmpay' | 'flutterwave' | null>(null)
  const hasApprovedFundingIdentity = Boolean(
    kycSubmission
    && kycSubmission.status === 'approved'
    && (kycSubmission.documentType === 'bvn' || kycSubmission.documentType === 'nin')
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

  return (
    <Modal open={open} onClose={onClose} title="Deposit Funds">
      <div className="p-6 flex flex-col gap-4">
        <div className="bg-[rgba(79,70,229,.06)] border border-[rgba(79,70,229,.18)] border-l-4 border-l-[var(--gold)] p-4">
          <div className="text-[9px] font-bold text-[var(--gold2)] uppercase tracking-wider mb-1">Funding Notice</div>
          <div className="text-[11px] text-[var(--text2)] leading-relaxed">PalmPay and Flutterwave funding accounts now both depend on approved BVN or NIN KYC. Wallet credit follows confirmed provider settlement.</div>
        </div>
        {!primaryAccount && !flutterwaveAccount ? (
          <div className="space-y-4">
            <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="mb-3 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Default Funding Account</div>
              {hasApprovedFundingIdentity ? (
                <>
                  <div className="rounded border border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] p-3 text-[11px] text-[var(--text2)]">
                    Approved {kycSubmission?.documentType?.toUpperCase()} on file: <span className="font-mono text-[var(--text)]">{kycSubmission?.documentNumber}</span>
                  </div>
                  <Button className="mt-4 w-full py-3" onClick={() => void generatePermanentAccount('palmpay')} disabled={loadingProvider !== null}>
                    {loadingProvider === 'palmpay' ? 'Assigning PalmPay…' : 'Generate PalmPay Account'}
                  </Button>
                </>
              ) : (
                <>
                  <div className="rounded border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] p-3 text-[11px] text-[var(--text2)]">
                    An approved BVN or NIN KYC record is required before creating a PalmPay funding account.
                  </div>
                  <div className="mt-2 text-[10px] text-[var(--muted)]">Submit BVN or NIN first.</div>
                  <Button className="mt-4 w-full py-3" onClick={goToKyc}>
                    Open KYC Page
                  </Button>
                </>
              )}
            </div>

            <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="mb-3 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Second Account Option</div>
              {fundingAccountEligibility.eligible ? (
                <>
                  <div className="rounded border border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] p-3 text-[11px] text-[var(--text2)]">
                    Approved {kycSubmission?.documentType?.toUpperCase()} on file: <span className="font-mono text-[var(--text)]">{kycSubmission?.documentNumber}</span>
                  </div>
                  <Button variant="secondary" className="mt-4 w-full py-3" onClick={() => void generatePermanentAccount('flutterwave')} disabled={loadingProvider !== null}>
                    {loadingProvider === 'flutterwave' ? 'Assigning Flutterwave…' : 'Generate Flutterwave Account'}
                  </Button>
                </>
              ) : (
                <>
                  <div className="rounded border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] p-3 text-[11px] text-[var(--text2)]">
                    {fundingAccountEligibility.message}
                  </div>
                  <div className="mt-2 text-[10px] text-[var(--muted)]">Submit BVN or NIN first.</div>
                  <Button variant="secondary" className="mt-4 w-full py-3" onClick={goToKyc}>
                    Open KYC Page
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {[palmpayAccount, flutterwaveAccount].filter((item): item is FundingAccount => Boolean(item)).map((account, index) => (
            <div key={`${account.provider}-${account.accountNumber}-${index}`} className="relative overflow-hidden border border-[rgba(202,165,96,0.28)] bg-[linear-gradient(180deg,rgba(66,46,28,0.96)_0%,rgba(45,31,19,0.98)_100%)] p-4 sm:p-5">
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
                    <div className="text-[8px] font-bold uppercase tracking-[1.2px] text-[var(--gold2)]">{account.provider === 'palmpay' ? 'Default PalmPay Account' : 'Flutterwave Account'}</div>
                    <div className="mt-1 text-[10px] text-[rgba(233,214,186,0.62)]">Bank transfer slip</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(account.accountNumber)}>
                    Copy
                  </Button>
                </div>
                <div className="mt-4 border-y border-dashed border-[rgba(224,196,138,0.22)] py-4">
                  <div className="text-[8px] font-bold uppercase tracking-[1px] text-[rgba(233,214,186,0.56)]">Account Number</div>
                  <div className="mt-2 font-mono text-[24px] font-black tracking-[3px] text-[rgba(244,231,208,0.9)] sm:text-[28px]">
                    {account.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim()}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[8px] font-bold uppercase tracking-[1px] text-[rgba(233,214,186,0.56)]">Bank</div>
                    <div className="mt-1 text-[11px] font-semibold text-[rgba(244,231,208,0.88)]">{account.bank}</div>
                  </div>
                  <div>
                    <div className="text-[8px] font-bold uppercase tracking-[1px] text-[rgba(233,214,186,0.56)]">Account Name</div>
                    <div className="mt-1 text-[11px] font-semibold text-[rgba(244,231,208,0.88)]">{account.accountName}</div>
                  </div>
                </div>
              </div>
            </div>
            ))}

            <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Instructions</div>
              <div className="grid gap-2 text-[11px] text-[var(--text2)]">
                <div>Use PalmPay as your default wallet top-up account.</div>
                <div>Wallet is credited after provider confirmation.</div>
                <div>Wallet is credited net of confirmed provider charges where applicable.</div>
                {palmpayAccount?.reference && <div>PalmPay reference: <span className="font-mono text-[var(--text)]">{palmpayAccount.reference}</span></div>}
                {flutterwaveAccount?.reference && <div>Flutterwave reference: <span className="font-mono text-[var(--text)]">{flutterwaveAccount.reference}</span></div>}
                {flutterwaveAccount?.expiresAt && <div>Flutterwave expiry: <span className="text-[var(--text)]">{new Date(flutterwaveAccount.expiresAt).toLocaleString()}</span></div>}
              </div>
            </div>

            {!palmpayAccount ? (
              <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="mb-3 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Set PalmPay As Default</div>
                {hasApprovedFundingIdentity ? (
                  <>
                    <div className="rounded border border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] p-3 text-[11px] text-[var(--text2)]">
                      Your wallet can still add a PalmPay funding account as an available top-up route.
                    </div>
                    <Button className="mt-4 w-full py-3" onClick={() => void generatePermanentAccount('palmpay')} disabled={loadingProvider !== null}>
                      {loadingProvider === 'palmpay' ? 'Assigning PalmPay…' : 'Generate PalmPay Account'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="rounded border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] p-3 text-[11px] text-[var(--text2)]">
                      An approved BVN or NIN KYC record is required before creating a PalmPay funding account.
                    </div>
                    <Button className="mt-4 w-full py-3" onClick={goToKyc}>
                      Open KYC Page
                    </Button>
                  </>
                )}
              </div>
            ) : null}

            {!flutterwaveAccount ? (
              <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
                <div className="mb-3 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Need A Second Account?</div>
                {fundingAccountEligibility.eligible ? (
                  <>
                    <div className="rounded border border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] p-3 text-[11px] text-[var(--text2)]">
                      Approved {kycSubmission?.documentType?.toUpperCase()} on file: <span className="font-mono text-[var(--text)]">{kycSubmission?.documentNumber}</span>
                    </div>
                    <Button variant="secondary" className="mt-4 w-full py-3" onClick={() => void generatePermanentAccount('flutterwave')} disabled={loadingProvider !== null}>
                      {loadingProvider === 'flutterwave' ? 'Assigning Flutterwave…' : 'Generate Flutterwave Account'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="rounded border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] p-3 text-[11px] text-[var(--text2)]">
                      {fundingAccountEligibility.message}
                    </div>
                    <Button variant="secondary" className="mt-4 w-full py-3" onClick={goToKyc}>
                      Open KYC Page
                    </Button>
                  </>
                )}
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button className="flex-1" onClick={() => { closeModal(); onClose() }}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
