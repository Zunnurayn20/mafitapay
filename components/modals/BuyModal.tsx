'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { PinPad } from '@/components/ui/PinPad'
import { createBiometricApproval } from '@/lib/client/biometric'
import { getWalletAddressHint, getWalletAddressPlaceholder, validateWalletAddressForPair } from '@/lib/crypto-addresses'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { getMinimumBuyNgn } from '@/lib/crypto-rules'
import { useAppStore } from '@/store'
import { fmtDate, formatCrypto, formatNGN, formatUSD } from '@/lib/utils'
import { CryptoAsset, CryptoPairId, CryptoQuote } from '@/types'

type Step = 'form' | 'pin' | 'processing' | 'success'
type AmountMode = 'ngn' | 'usd' | 'asset'
const QUICK_NGN_AMOUNTS = [1000, 2000, 5000, 10000]
const LAST_USED_BUY_ADDRESS_KEY = 'mafitapay:last-buy-addresses'

function getApproxUsdNgnRate(asset?: CryptoAsset) {
  if (!asset) return 0
  if (asset.marketPriceUsd && asset.marketPriceUsd > 0 && asset.marketRate > 0) {
    return asset.marketRate / asset.marketPriceUsd
  }
  return 0
}

function getPricingSourceLabel(source?: CryptoAsset['pricingSource']) {
  if (source === 'live') return 'Live market'
  if (source === 'backup') return 'Backup market'
  if (source === 'safe') return 'Safe market'
  return 'Market source'
}

function truncateAddress(value: string) {
  if (value.length <= 18) return value
  return `${value.slice(0, 8)}...${value.slice(-8)}`
}

function readLastUsedBuyAddresses(): Partial<Record<CryptoPairId, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(LAST_USED_BUY_ADDRESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Partial<Record<CryptoPairId, string>> : {}
  } catch {
    return {}
  }
}

function writeLastUsedBuyAddress(pairId: CryptoPairId, address: string) {
  if (typeof window === 'undefined') return
  try {
    const existing = readLastUsedBuyAddresses()
    window.localStorage.setItem(
      LAST_USED_BUY_ADDRESS_KEY,
      JSON.stringify({
        ...existing,
        [pairId]: address,
      }),
    )
  } catch {
    // Ignore local persistence failures.
  }
}

export function BuyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshSession, showToast, modalData, securitySettings } = useAppStore()
  const assets = useCryptoAssets()
  const [step, setStep]       = useState<Step>('form')
  const [pairId, setPairId]   = useState<CryptoPairId>('USDT_BSC')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [amount, setAmount]   = useState('')
  const [amountMode, setAmountMode] = useState<AmountMode>('ngn')
  const [address, setAddress] = useState('')
  const [ref, setRef]         = useState('')
  const [quote, setQuote] = useState<CryptoQuote | null>(null)
  const [pinVersion, setPinVersion] = useState(0)
  const [quoteTimeLeft, setQuoteTimeLeft] = useState(0)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [lockingQuote, setLockingQuote] = useState(false)
  const [submittingOrder, setSubmittingOrder] = useState(false)
  const [lastUsedAddress, setLastUsedAddress] = useState('')

  const modalAsset = modalData.cryptoAsset as CryptoAsset | undefined
  const asset = assets.find(a => a.id === pairId)
    ?? (modalAsset?.id === pairId ? modalAsset : undefined)
    ?? assets[0]
  const rawAmount = parseFloat(amount) || 0
  const usdNgnRate = getApproxUsdNgnRate(asset)
  const amt = !asset ? 0 : amountMode === 'asset'
    ? rawAmount * asset.buyRate
    : amountMode === 'usd'
      ? rawAmount * usdNgnRate
      : rawAmount
  const crypto = quote?.cryptoAmount ?? (asset ? (amountMode === 'asset' ? rawAmount : amt / asset.buyRate) : 0)
  const fee   = 0
  const minimumBuyNgn = asset ? getMinimumBuyNgn(asset.id) : 1000
  const belowMinimum = amt > 0 && amt < minimumBuyNgn
  const addressValidation = asset ? validateWalletAddressForPair(asset.id, address) : { valid: false, error: 'Destination wallet address is required.' }
  const addressError = address.trim().length > 0 && !addressValidation.valid ? addressValidation.error : null

  useEffect(() => {
    if (!open) return
    const presetPairId = typeof modalData.cryptoPairId === 'string' ? modalData.cryptoPairId : ''
    if (presetPairId) {
      setPairId(presetPairId as CryptoPairId)
      return
    }

    if (modalAsset?.id) {
      setPairId(modalAsset.id)
      return
    }

    if (assets[0]?.id) {
      setPairId(assets[0].id)
    }
  }, [assets, modalAsset, modalData, open])

  useEffect(() => {
    if (!open || !pairId) return
    const savedAddress = readLastUsedBuyAddresses()[pairId] ?? ''
    setLastUsedAddress(savedAddress)
  }, [open, pairId])

  useEffect(() => {
    if (!quote || step !== 'pin') return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(quote.expiresAt).getTime() - Date.now()) / 1000))
      setQuoteTimeLeft(remaining)
      if (remaining === 0) {
        setQuote(null)
        setStep('form')
        showToast('Quote expired. Lock a new quote to continue.', 'error')
      }
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [quote, showToast, step])

  function handleClose() {
    onClose()
    setTimeout(() => { setStep('form'); setAmount(''); setAmountMode('ngn'); setAddress(''); setQuote(null); setPinVersion(0); setAvailabilityError(null); setShowAssetPicker(false) }, 400)
  }

  useEffect(() => {
    if (step !== 'form') return
    setAvailabilityError(null)
  }, [amount, address, pairId, step])

  async function runBuyPreflight() {
    if (!asset) {
      throw new Error('Asset is unavailable right now.')
    }

    const response = await fetch('/api/crypto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        intent: 'preflight',
        action: 'buy',
        pairId: asset.id,
        amount: amt,
        walletAddress: address,
      }),
    })
    const payload = await response.json()
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || 'This buy is temporarily unavailable.')
    }
  }

  async function requestQuote() {
    if (!amt || !address || !asset) {
      showToast('Fill in all fields', 'error')
      return
    }
    if (!addressValidation.valid) {
      throw new Error(addressValidation.error || 'Destination wallet address is invalid.')
    }
    if (lockingQuote) return

    setLockingQuote(true)
    try {
      const [preflightResult, quoteResult] = await Promise.allSettled([
        runBuyPreflight(),
        fetch('/api/crypto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            intent: 'quote',
            action: 'buy',
            pairId: asset.id,
            amount: amt,
            walletAddress: address,
          }),
        }).then(async response => {
          const payload = await response.json()
          if (!response.ok || payload.success === false) {
            throw new Error(payload.error || 'Quote request failed.')
          }
          return payload
        }),
      ])

      if (preflightResult.status === 'rejected') {
        throw preflightResult.reason
      }
      if (quoteResult.status === 'rejected') {
        throw quoteResult.reason
      }

      setAvailabilityError(null)
      setQuote(quoteResult.value.data.quote)
      setPinVersion(current => current + 1)
      setStep('pin')
    } finally {
      setLockingQuote(false)
    }
  }

  async function submitBuyOrder(input: { transactionPin?: string; biometricApprovalToken?: string }) {
    if (submittingOrder) return
    setSubmittingOrder(true)
    setStep('processing')

    try {
      if (!asset || !quote) {
        throw new Error('Quote is missing. Refresh and try again.')
      }
      const response = await fetch('/api/crypto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          intent: 'execute',
          action: 'buy',
          pairId: asset.id,
          amount: amt,
          quoteId: quote.id,
          walletAddress: address,
          ...input,
        }),
      })
      const payload = await response.json()

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Buy order failed.')
      }

      const trimmedAddress = address.trim()
      writeLastUsedBuyAddress(asset.id, trimmedAddress)
      setLastUsedAddress(trimmedAddress)
      setRef(payload.data.transaction.reference)
      await refreshSession()
      setStep('success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Buy order failed.', 'error')
      setPinVersion(current => current + 1)
      setStep('pin')
    } finally {
      setSubmittingOrder(false)
    }
  }

  async function handlePin(pin: string) {
    await submitBuyOrder({ transactionPin: pin })
  }

  async function handleBiometricApproval() {
    try {
      const approval = await createBiometricApproval()
      await submitBuyOrder({ biometricApprovalToken: approval.token })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Biometric approval failed.', 'error')
      setPinVersion(current => current + 1)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={step === 'success' ? 'Order Placed!' : 'Buy Crypto'}>
      {!asset && (
        <div className="p-8 text-center">
          <div className="spinner mx-auto mb-4" />
          <div className="text-[12px] text-[var(--text)]">Loading asset data…</div>
        </div>
      )}

      {asset && step === 'form' && (
        <div className="p-6 flex flex-col gap-4">
          <div className="relative flex items-center justify-between gap-3 bg-[var(--clay)] border border-[rgba(202,165,96,.28)] p-3">
            <div>
              <div className="text-[7px] text-[var(--text2)] uppercase tracking-[1px]">Buy Rate</div>
              <div className="text-[15px] font-bold font-mono text-[var(--gold)]">
                {asset.marketPriceUsd && asset.marketPriceUsd > 0
                  ? `${formatUSD(asset.marketPriceUsd)} / ${asset.symbol} = ${formatNGN(asset.buyRate)}`
                  : formatNGN(asset.buyRate)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAssetPicker(current => !current)}
                className="flex h-10 w-10 items-center justify-center border border-[var(--border)] bg-[var(--clay2)]"
              >
                <AssetLogo
                  src={asset.icon}
                  alt={`${asset.symbol} logo`}
                  fallback={asset.symbol.slice(0, 1)}
                  className="flex h-8 w-8 items-center justify-center overflow-hidden"
                  imgClassName="h-7 w-7 object-contain"
                  textClassName="text-lg"
                />
              </button>
            </div>
            {showAssetPicker && (
              <div className="absolute right-3 top-[calc(100%+0.5rem)] z-20 grid grid-cols-4 gap-2 border border-[var(--border)] bg-[var(--coal)] p-3 shadow-[0_14px_30px_rgba(0,0,0,.35)]">
                {assets.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setPairId(a.id)
                      setShowAssetPicker(false)
                    }}
                    className={`flex h-12 w-12 items-center justify-center border ${pairId === a.id ? 'border-[var(--gold)] bg-[rgba(79,70,229,.1)]' : 'border-[var(--border)] bg-[var(--clay2)]'}`}
                  >
                    <AssetLogo
                      src={a.icon}
                      alt={`${a.symbol} logo`}
                      fallback={a.symbol.slice(0, 1)}
                      className="flex h-8 w-8 items-center justify-center overflow-hidden"
                      imgClassName="h-7 w-7 object-contain"
                      textClassName="text-lg"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)] mb-1.5">Amount</div>
            <div className="mb-2 grid grid-cols-4 gap-1.5">
              {QUICK_NGN_AMOUNTS.map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setAmountMode('ngn')
                    setAmount(String(value))
                  }}
                  className="border border-[var(--border)] bg-[var(--clay2)] py-2 text-[10px] font-bold text-[var(--text2)] transition-all hover:border-[var(--gold2)] hover:text-[var(--text)]"
                >
                  ₦{value >= 1000 ? `${value / 1000}k` : value}
                </button>
              ))}
            </div>
            <div className="flex border border-[rgba(202,165,96,.22)] bg-[var(--clay2)] focus-within:border-[var(--gold)] transition-colors">
              <div className="flex items-center bg-[var(--clay2)] px-3 text-[var(--ngn)] font-display font-black text-lg flex-shrink-0">
                {amountMode === 'ngn' ? '₦' : amountMode === 'usd' ? '$' : asset.symbol}
              </div>
              <input
                type="number"
                placeholder={`Min ${amountMode === 'asset'
                  ? formatCrypto(minimumBuyNgn / asset.buyRate, asset.symbol)
                  : amountMode === 'usd' && usdNgnRate > 0
                    ? (minimumBuyNgn / usdNgnRate).toFixed(2)
                    : '0.00'}`}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="flex-1 bg-[var(--clay2)] text-[var(--text)] text-lg font-bold font-display px-3.5 py-3 border-none outline-none placeholder:text-[var(--muted)] min-w-0"
              />
              <select
                value={amountMode}
                onChange={event => setAmountMode(event.target.value as AmountMode)}
                className="border-l border-[var(--border)] bg-[var(--clay)] px-3 py-3 text-[10px] font-bold tracking-[.8px] text-[var(--gold)] outline-none flex-shrink-0"
              >
                <option value="ngn">NGN</option>
                <option value="usd">USD</option>
                <option value="asset">{asset.symbol}</option>
              </select>
            </div>
            <div className="flex items-center justify-between bg-[var(--clay)] border border-[rgba(202,165,96,.22)] px-3.5 py-2.5 mt-2">
              <span className="text-[9px] text-[var(--text2)]">Estimated receive</span>
              <span className="text-[14px] font-bold font-display text-[var(--gold)]">{formatCrypto(crypto, asset.symbol)}</span>
            </div>
            <div className="mt-1.5 text-[9px] text-[var(--muted)]">
              {amountMode === 'asset'
                ? `Estimated NGN debit: ${formatNGN(amt)}`
                : amountMode === 'usd'
                  ? `Approximate NGN conversion: ${formatNGN(amt)}`
                  : `Approximate USD value uses the current USD/NGN market snapshot.`}
            </div>
            {belowMinimum && (
              <div className="mt-1 text-[9px] text-[var(--red2)]">
                Minimum buy is {formatNGN(minimumBuyNgn)}.
              </div>
            )}
          </div>
          <div>
            <Input label="Destination Wallet Address"
              placeholder={asset ? getWalletAddressPlaceholder(asset.id) : 'Paste wallet address…'}
              value={address} onChange={e => setAddress(e.target.value)}
              className="text-[12px] font-mono" suffix="PASTE" />
            {lastUsedAddress && lastUsedAddress !== address.trim() && (
              <button
                type="button"
                onClick={() => setAddress(lastUsedAddress)}
                className="mt-2 inline-flex items-center gap-2 border border-[rgba(202,165,96,.24)] bg-[var(--clay)] px-2.5 py-1.5 text-left text-[9px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--gold2)]"
              >
                <span className="text-[var(--muted)]">Last used</span>
                <span className="font-mono text-[var(--gold2)]">{truncateAddress(lastUsedAddress)}</span>
              </button>
            )}
            <div className={`text-[9px] mt-1.5 ${addressError ? 'text-[var(--red2)]' : 'text-[var(--muted)]'}`}>
              {addressError ?? getWalletAddressHint(asset.id)}
            </div>
          </div>
          <div className="bg-[var(--clay)] border border-[rgba(202,165,96,.24)] p-3 text-[11px]">
            <div className="flex justify-between py-1 font-bold"><span className="text-[var(--text)]">Total NGN debit</span><span className="text-[var(--gold)] font-mono">{formatNGN(amt + fee)}</span></div>
          </div>
          {availabilityError && (
            <div className="border border-[rgba(220,38,38,.25)] bg-[rgba(220,38,38,.08)] px-3.5 py-3 text-[10px] text-[var(--text)]">
              {availabilityError}
            </div>
          )}
          <Button
            onClick={() => void requestQuote().catch(error => {
              const message = error instanceof Error ? error.message : 'Quote request failed.'
              setAvailabilityError(message)
              showToast(message, 'error')
            })}
            className="w-full py-3.5"
            disabled={lockingQuote || asset.baseExecutionEnabled !== true || belowMinimum || (address.trim().length > 0 && !addressValidation.valid)}
          >
            {asset.baseExecutionEnabled === true ? (lockingQuote ? 'Locking Quote…' : 'Buy') : 'In-App Execution Coming Later'}
          </Button>
          <div className="text-[9px] text-[var(--muted)]">
            Wallet-funded execution is live only for supported in-app treasury pairs in this phase.
          </div>
        </div>
      )}

      {asset && step === 'pin' && (
        <div className="p-5 space-y-4">
          <div className="border border-[var(--border)] bg-[var(--clay)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Execution Summary</div>
                <div className="mt-2 text-[16px] font-display font-black text-[var(--text)]">
                  {formatCrypto(crypto, asset.symbol)} <span className="text-[var(--gold2)]">·</span> {asset.network}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text2)]">
                  {formatNGN(amt + fee)} will be reserved from your wallet after PIN confirmation.
                </div>
                <div className="mt-3 inline-flex items-center border px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.8px] text-[var(--text)]">
                  <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${asset.pricingSource === 'live' ? 'bg-[var(--green2)]' : asset.pricingSource === 'backup' ? 'bg-[var(--gold2)]' : 'bg-[var(--red2)]'}`} />
                  {getPricingSourceLabel(asset.pricingSource)}
                </div>
              </div>
              <div className="border border-[rgba(99,102,241,.25)] bg-[rgba(79,70,229,.08)] px-3 py-2 text-right">
                <div className="text-[8px] uppercase tracking-[1px] text-[var(--muted)]">Quote Timer</div>
                <div className="mt-1 font-mono text-[14px] font-bold text-[var(--gold2)]">
                  {String(Math.floor(quoteTimeLeft / 60)).padStart(2, '0')}:{String(quoteTimeLeft % 60).padStart(2, '0')}
                </div>
              </div>
            </div>
            {quote && (
              <div className="mt-3 text-[10px] text-[var(--muted)]">
                Quote locked until {fmtDate(quote.expiresAt)}. Source: {getPricingSourceLabel(asset.pricingSource)}.
              </div>
            )}
          </div>
          <PinPad
            key={pinVersion}
            onComplete={handlePin}
            title={submittingOrder ? 'Submitting Order…' : 'Confirm Buy Order'}
            subtitle={`Buying ${formatCrypto(crypto, asset.symbol)} on ${asset.network} for ${formatNGN(amt + fee)} from your NGN balance`}
            secondaryActionLabel={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? 'Use biometrics' : undefined}
            secondaryActionIconOnly
            onSecondaryAction={securitySettings?.hasBiometricCredential && securitySettings?.biometricEnabled ? () => void handleBiometricApproval() : undefined}
          />
        </div>
      )}

      {asset && step === 'processing' && (
        <div className="p-10 text-center"><div className="spinner mx-auto mb-4" /><div className="font-display font-bold text-[17px] text-[var(--text)]">Processing…</div><div className="text-[11px] text-[var(--muted)] mt-1">Submitting {asset.symbol} purchase and reserving your NGN balance.</div></div>
      )}

      {asset && step === 'success' && (
        <div className="p-9 text-center flex flex-col items-center gap-4">
          <div className="w-[72px] h-[72px] rounded-full bg-[rgba(46,170,92,.12)] border-2 border-[rgba(46,170,92,.3)] flex items-center justify-center text-[28px] animate-pop">✅</div>
          <div className="font-display font-black text-[24px] text-[var(--text)]">Order Placed!</div>
          <div className="text-[13px] text-[var(--text2)]">{formatCrypto(crypto, asset.symbol)} on {asset.network} has been booked. NGN funds are locked until fulfillment or failure.</div>
          <div className="bg-[var(--clay)] border border-[var(--border)] p-3 w-full text-left">
            <div className="text-[8px] text-[var(--muted)] uppercase tracking-[1px] mb-1">Transaction Reference</div>
            <div className="text-[11px] text-[var(--gold2)] font-mono">{ref}</div>
          </div>
          <Button onClick={handleClose} className="w-full py-3">Done</Button>
        </div>
      )}
    </Modal>
  )
}
