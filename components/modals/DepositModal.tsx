'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store'

type FundingAccount = {
  bank: string
  accountNumber: string
  accountName: string
  isPermanent?: boolean
  reference?: string
  expiresAt?: string
  note?: string
}

export function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wallet = useAppStore(state => state.wallet)
  const kycSubmission = useAppStore(state => state.kycSubmission)
  const fundingAccountEligibility = useAppStore(state => state.fundingAccountEligibility)
  const closeModal = useAppStore(state => state.closeModal)
  const refreshSession = useAppStore(state => state.refreshSession)
  const showToast = useAppStore(state => state.showToast)
  const permanentAccount = wallet?.virtualAccounts.find(item => (item.provider === 'flutterwave' || item.provider === 'cngn') && item.isPermanent)
  const [loading, setLoading] = useState(false)
  const [fundingAccount, setFundingAccount] = useState<FundingAccount | null>(null)

  useEffect(() => {
    if (!open) return
    if (permanentAccount) {
      setFundingAccount(permanentAccount)
      return
    }
  }, [open, permanentAccount])

  async function generatePermanentAccount() {
    if (!fundingAccountEligibility.eligible) {
      showToast(fundingAccountEligibility.message, 'error')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/wallet/deposit/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const payload = await response.json()

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Deposit failed.')
      }

      await refreshSession()
      setFundingAccount(payload.data.virtualAccount ?? null)
      showToast(payload.data.existing ? 'Permanent funding account already assigned.' : 'Permanent funding account created.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Funding account setup failed.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Deposit Funds">
      <div className="p-6 flex flex-col gap-4">
        <div className="bg-[var(--clay)] border border-[var(--border)] border-l-4 border-l-[var(--green)] p-4">
          <div className="text-[9px] font-bold text-[var(--green2)] uppercase tracking-wider mb-1">Permanent Funding Account</div>
          <div className="text-[11px] text-[var(--text2)] leading-relaxed">Assign a permanent funding account once with your BVN or NIN. After that, you can fund repeatedly with fiat and each confirmed deposit credits your NGN wallet.</div>
        </div>
        <div className="bg-[rgba(79,70,229,.06)] border border-[rgba(79,70,229,.18)] border-l-4 border-l-[var(--gold)] p-4">
          <div className="text-[9px] font-bold text-[var(--gold2)] uppercase tracking-wider mb-1">Fee Notice</div>
          <div className="text-[11px] text-[var(--text2)] leading-relaxed">2% fee (max ₦100) is deducted before the confirmed fiat deposit is credited to your NGN wallet.</div>
        </div>
        {!fundingAccount ? (
          <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
            <div className="mb-3 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">KYC Gate</div>
            {fundingAccountEligibility.eligible ? (
              <>
                <div className="rounded border border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.08)] p-3 text-[11px] text-[var(--text2)]">
                  Approved {kycSubmission?.documentType?.toUpperCase()} on file: <span className="font-mono text-[var(--text)]">{kycSubmission?.documentNumber}</span>
                </div>
                <div className="mt-2 text-[10px] text-[var(--muted)]">The funding account will be created from your approved identity record. The full BVN/NIN is not exposed here again.</div>
                <Button className="mt-4 w-full py-3" onClick={generatePermanentAccount} disabled={loading}>
                  {loading ? 'Assigning…' : 'Generate Permanent Account'}
                </Button>
              </>
            ) : (
              <>
                <div className="rounded border border-[rgba(196,52,26,.25)] bg-[rgba(196,52,26,.08)] p-3 text-[11px] text-[var(--text2)]">
                  {fundingAccountEligibility.message}
                </div>
                <div className="mt-2 text-[10px] text-[var(--muted)]">Go to Profile and submit BVN or NIN documents for review first. Once approved, come back here to assign the permanent account.</div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-[var(--clay2)] border border-[var(--border)] p-4">
              <div className="text-[8px] font-bold text-[var(--gold2)] uppercase tracking-[1px] mb-2">Permanent Funding Account</div>
              <div className="text-[22px] font-bold font-mono text-[var(--text)] tracking-[3px] mb-1">
                {fundingAccount.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ').trim()}
              </div>
              <div className="text-[10px] text-[var(--muted)] mb-1">{fundingAccount.bank} · {fundingAccount.accountName}</div>
              {fundingAccount.note && <div className="text-[10px] text-[var(--muted)] mb-3">{fundingAccount.note}</div>}
              <Button variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(fundingAccount.accountNumber)}>
                Copy Account Number
              </Button>
            </div>

            <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Funding Instructions</div>
              <div className="grid gap-2 text-[11px] text-[var(--text2)]">
                <div>Use this same account for every wallet top-up.</div>
                {fundingAccount.reference && <div>Provider reference: <span className="font-mono text-[var(--text)]">{fundingAccount.reference}</span></div>}
                <div>Deposits are credited after the funding provider confirms the incoming transfer.</div>
                <div>Your NGN balance increases by the transferred amount minus the deposit fee.</div>
                {fundingAccount.expiresAt && <div>Expires: <span className="text-[var(--text)]">{new Date(fundingAccount.expiresAt).toLocaleString()}</span></div>}
              </div>
            </div>

            <div className="bg-[rgba(46,170,92,.08)] border border-[rgba(46,170,92,.25)] border-l-4 border-l-[var(--green)] p-4">
              <div className="text-[9px] font-bold text-[var(--green2)] uppercase tracking-wider mb-1">Settlement</div>
              <div className="text-[11px] text-[var(--text2)] leading-relaxed">Do not click any manual confirmation. Once the funding provider confirms the deposit, the transaction will move from pending to success automatically and credit NGN.</div>
            </div>

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
