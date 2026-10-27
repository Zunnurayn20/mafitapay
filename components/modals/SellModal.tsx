'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ChevronLeft } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { formatNGN } from '@/lib/utils'
import { getNetworkFallbackLabel, getNetworkIconUrl } from '@/lib/crypto-networks'
import {
  getCryptoDepositAddressFamilyForAsset,
  groupCryptoAssetsBySymbol,
  isDepositableCryptoAsset,
  type CryptoDepositAssetGroup,
} from '@/lib/crypto-deposit-assets'
import { CexDepositAccount, CryptoAsset, CryptoPairId } from '@/types'

type CexDepositSetup = {
  exchange: 'bybit'
  enabled: boolean
  receivingUid: string | null
  account: CexDepositAccount | null
}

export function SellModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast, modalData, setModalData, cryptoDepositAddresses } = useAppStore()
  const assets = useCryptoAssets()
  const sellableAssets = useMemo(
    () => assets.filter(item => item.sellEnabled !== false && isDepositableCryptoAsset(item)),
    [assets],
  )
  const assetGroups = useMemo(() => groupCryptoAssetsBySymbol(sellableAssets), [sellableAssets])
  const initializedPairRef = useRef(false)
  const [pairId, setPairId] = useState<CryptoPairId>('USDT_BSC')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [pickerSymbol, setPickerSymbol] = useState<string | null>(null)
  const [qrRenderKey, setQrRenderKey] = useState(0)
  const qrCodeCacheRef = useRef<Record<string, string>>({})
  const [depositMethod, setDepositMethod] = useState<'wallet' | 'exchange'>('wallet')
  const [cexSetup, setCexSetup] = useState<CexDepositSetup | null>(null)
  const [cexSenderUid, setCexSenderUid] = useState('')
  const [savingCexAccount, setSavingCexAccount] = useState(false)
  const [cexSetupError, setCexSetupError] = useState('')

  const modalAsset = modalData.cryptoAsset as CryptoAsset | undefined
  const asset = sellableAssets.find(a => a.id === pairId)
    ?? (modalAsset?.id === pairId && modalAsset.sellEnabled !== false ? modalAsset : undefined)
    ?? sellableAssets[0]
  const exchangeRateAsset = assets.find(item => item.id === 'USDT_BSC' && item.isActive !== false && item.sellEnabled !== false)
    ?? assets.find(item => item.symbol.toUpperCase() === 'USDT' && item.isActive !== false && item.sellEnabled !== false)
  const displayedSellAsset = depositMethod === 'exchange' && exchangeRateAsset ? exchangeRateAsset : asset
  const addressFamily = getCryptoDepositAddressFamilyForAsset(asset)
  const depositAddress = cryptoDepositAddresses.find(item => item.addressFamily === addressFamily && item.isActive)
  const pickerGroup = pickerSymbol
    ? assetGroups.find(group => group.symbol === pickerSymbol) ?? null
    : null

  useEffect(() => {
    if (!open) {
      initializedPairRef.current = false
      return
    }

    if (initializedPairRef.current) return

    const presetPairId = typeof modalData.cryptoPairId === 'string' ? modalData.cryptoPairId : ''
    if (presetPairId) {
      setPairId(presetPairId as CryptoPairId)
      if (modalData.cryptoDepositMethod === 'exchange') {
        setDepositMethod('exchange')
        // Consume the one-time handoff so a later, ordinary open starts on-chain.
        setModalData({ cryptoAsset: modalAsset, cryptoPairId: presetPairId })
      }
      initializedPairRef.current = true
      return
    }

    if (modalAsset?.id) {
      setPairId(modalAsset.id)
      initializedPairRef.current = true
      return
    }

    if (sellableAssets[0]?.id) {
      setPairId(sellableAssets[0].id)
      initializedPairRef.current = true
    }
  }, [modalAsset?.id, modalData.cryptoDepositMethod, modalData.cryptoPairId, open, sellableAssets, setModalData])

  useEffect(() => {
    if (!open || sellableAssets.length === 0) return
    if (sellableAssets.some(item => item.id === pairId)) return
    setPairId(sellableAssets[0].id)
  }, [open, pairId, sellableAssets])

  useEffect(() => {
    if (!open) {
      setDepositMethod('wallet')
      setCexSetup(null)
      setCexSetupError('')
      return
    }
    let cancelled = false
    void fetch('/api/crypto/cex-deposit-account', { cache: 'no-store' })
      .then(response => response.json())
      .then(payload => {
        if (!cancelled && payload?.success && payload.data) setCexSetup(payload.data as CexDepositSetup)
      })
      .catch(() => {
        if (!cancelled) setCexSetup(null)
      })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open || depositMethod !== 'exchange' || cexSetup?.account?.status !== 'pending_verification') return
    const timer = window.setInterval(() => {
      void fetch('/api/crypto/cex-deposit-account', { cache: 'no-store' })
        .then(response => response.json())
        .then(payload => {
          if (payload?.success && payload.data) setCexSetup(payload.data as CexDepositSetup)
        })
        .catch(() => {})
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [cexSetup?.account?.status, depositMethod, open])

  useEffect(() => {
    if (asset?.symbol.toUpperCase() !== 'USDT') setDepositMethod('wallet')
  }, [asset?.symbol])

  useEffect(() => {
    let cancelled = false
    if (!depositAddress?.address) {
      return
    }

    const addr = depositAddress.address
    if (qrCodeCacheRef.current[addr]) {
      // generated/cached once for this exact address: show instantly (render will see it), no re-gen
      return
    }

    // first time seeing this address -> generate (happens only once per address thanks to cache)
    void QRCode.toDataURL(addr, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8,
      color: {
        dark: '#111111',
        light: '#fff7e6',
      },
    }).then(url => {
      if (!cancelled) {
        qrCodeCacheRef.current[addr] = url
        setQrRenderKey(k => k + 1) // force re-render so the img picks up the newly cached QR
      }
    }).catch(() => {
      // on error, a re-render isn't strictly needed; spinner will stay until next address change
    })

    return () => {
      cancelled = true
    }
  }, [depositAddress?.address])

  function handleClose() {
    onClose()
    initializedPairRef.current = false
    setTimeout(() => {
      setShowAssetPicker(false)
      setPickerSymbol(null)
      // do not reset QR state here; we use per-address cache (see qrCodeCacheRef) so QR is generated only once per address and displayed instantly on re-open/switch-back
    }, 400)
  }

  function toggleAssetPicker() {
    setPickerSymbol(null)
    setShowAssetPicker(current => !current)
  }

  function selectPair(nextPairId: CryptoPairId) {
    setPairId(nextPairId)
    const nextAsset = sellableAssets.find(item => item.id === nextPairId)
    if (nextAsset?.symbol.toUpperCase() !== 'USDT') setDepositMethod('wallet')
    setShowAssetPicker(false)
    setPickerSymbol(null)
  }

  // A symbol that only exists on one chain has nothing to disambiguate, so skip the second step.
  function handleGroupClick(group: CryptoDepositAssetGroup) {
    if (group.options.length === 1) {
      selectPair(group.options[0].id)
      return
    }
    setPickerSymbol(group.symbol)
  }

  async function copyAddress() {
    if (!depositAddress?.address) return
    await navigator.clipboard?.writeText(depositAddress.address)
    showToast('Deposit address copied.')
  }

  async function copyCexUid() {
    if (!cexSetup?.receivingUid) return
    await navigator.clipboard?.writeText(cexSetup.receivingUid)
    showToast('Bybit UID copied.')
  }

  async function linkBybitUid() {
    setSavingCexAccount(true)
    setCexSetupError('')
    try {
      const response = await fetch('/api/crypto/cex-deposit-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange: 'bybit', senderUid: cexSetup?.account?.externalUid ?? cexSenderUid.trim() }),
      })
      const payload = await response.json()
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Could not link your Bybit UID.')
      setCexSetup(current => current ? { ...current, account: payload.data.account } : current)
      setCexSenderUid('')
      showToast('Bybit UID linked. Send the exact verification amount to complete setup.')
    } catch (error) {
      setCexSetupError(error instanceof Error ? error.message : 'Could not link your Bybit UID.')
    } finally {
      setSavingCexAccount(false)
    }
  }

  async function unlinkBybitUid() {
    if (!window.confirm('Stop auto-crediting transfers from this Bybit UID? Future exchange transfers will stay unmatched until you link a UID again.')) return
    const response = await fetch('/api/crypto/cex-deposit-account', { method: 'DELETE' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload?.success) {
      setCexSetupError(payload?.error || 'Could not unlink this Bybit UID.')
      return
    }
    setCexSetup(current => current ? { ...current, account: null } : current)
    setCexSetupError('')
  }

  return (
    <Modal open={open} onClose={handleClose} title="Crypto Deposit">
      {!asset && (
        <div className="p-8 text-center">
          {assets.length === 0 && <div className="spinner mx-auto mb-4" />}
          <div className="text-[12px] text-[var(--text)]">{assets.length > 0 ? 'Crypto sells are temporarily unavailable.' : 'Loading asset data...'}</div>
        </div>
      )}

      {asset && (
        <div className="flex flex-col gap-4 p-6">
          <div className="relative flex items-center justify-between gap-3 border border-[rgba(202,165,96,.28)] bg-[var(--clay)] p-3">
            <div>
              <div className="text-[7px] uppercase tracking-[1px] text-[var(--text2)]">Auto-credit sell rate</div>
              <div className="font-mono text-[15px] font-bold text-[var(--gold)]">{formatNGN(displayedSellAsset?.sellRate ?? asset.sellRate)} / {asset.symbol}</div>
              <div className="mt-1 text-[9px] text-[var(--muted)]">
                Rate includes platform margin. No network fee is deducted from your credit.
              </div>
            </div>
            <button
              type="button"
              onClick={toggleAssetPicker}
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
            {showAssetPicker && (
              <div className="absolute right-3 top-[calc(100%+0.5rem)] z-20 max-h-64 w-[17.5rem] overflow-y-auto border border-[var(--border)] bg-[var(--coal)] p-3 shadow-[0_14px_30px_rgba(0,0,0,.35)]">
                {pickerGroup ? (
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPickerSymbol(null)}
                        aria-label="Back to asset list"
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--clay2)] text-[var(--text2)]"
                      >
                        <ChevronLeft size={12} />
                      </button>
                      <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">
                        {pickerGroup.symbol} network
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {pickerGroup.options.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => selectPair(option.id)}
                          className={`flex items-center gap-2.5 border px-2.5 py-2 text-left ${pairId === option.id ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)]' : 'border-[var(--border)] bg-[var(--clay2)]'}`}
                        >
                          <AssetLogo
                            src={getNetworkIconUrl(option.network)}
                            alt={`${option.network} network logo`}
                            fallback={getNetworkFallbackLabel(option.network)}
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden"
                            imgClassName="h-5 w-5 object-contain"
                            textClassName="text-[10px] font-bold text-[var(--text2)]"
                          />
                          <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[var(--text)]">
                            {option.network}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {assetGroups.map(group => {
                      const active = group.options.some(option => option.id === pairId)
                      return (
                        <button
                          key={group.symbol}
                          type="button"
                          onClick={() => handleGroupClick(group)}
                          className={`flex flex-col items-center gap-1 border px-1.5 py-2 ${active ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)]' : 'border-[var(--border)] bg-[var(--clay2)]'}`}
                        >
                          <AssetLogo
                            src={group.icon}
                            alt={`${group.symbol} logo`}
                            fallback={group.symbol.slice(0, 1)}
                            className="flex h-7 w-7 items-center justify-center overflow-hidden"
                            imgClassName="h-6 w-6 object-contain"
                            textClassName="text-base"
                          />
                          <span className="w-full truncate text-center text-[10px] font-bold text-[var(--text)]">
                            {group.symbol}
                          </span>
                          <span className="w-full truncate text-center text-[8px] text-[var(--text2)]">
                            {group.options.length === 1
                              ? group.options[0].network
                              : `${group.options.length} networks`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {asset.symbol.toUpperCase() === 'USDT' && cexSetup?.enabled && (
            <div className="flex gap-2 text-[10px]">
              <button
                type="button"
                onClick={() => setDepositMethod('wallet')}
                className={`flex-1 rounded-lg border px-3 py-2 ${depositMethod === 'wallet' ? 'border-[var(--gold2)] bg-[var(--clay2)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--muted)]'}`}
              >
                On-chain wallet
              </button>
              <button
                type="button"
                onClick={() => setDepositMethod('exchange')}
                className={`flex-1 rounded-lg border px-3 py-2 ${depositMethod === 'exchange' ? 'border-[var(--gold2)] bg-[var(--clay2)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--muted)]'}`}
              >
                Bybit transfer
              </button>
            </div>
          )}

          {depositMethod === 'wallet' && (
            <>
              <div className="border border-[rgba(202,165,96,.24)] bg-[var(--clay)] p-4">
                <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Send any amount</div>
                <div className="mt-1 text-[11px] leading-relaxed text-[var(--text2)]">
                  Send only {asset.symbol} on {asset.network}. Once the network confirms it, MafitaPay detects the deposit and credits your NGN balance at the displayed sell rate.
                </div>
              </div>

              <button
                type="button"
                onClick={() => void copyAddress()}
                disabled={!depositAddress?.address}
                className="flex flex-col items-center gap-3 border border-[var(--border)] bg-[var(--clay2)] p-4 text-center disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div className="flex h-44 w-44 items-center justify-center border border-[rgba(202,165,96,.25)] bg-[#fff7e6] p-2">
                  {depositAddress?.address && qrCodeCacheRef.current[depositAddress.address] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrCodeCacheRef.current[depositAddress.address]} alt={`${asset.symbol} deposit QR code`} className="h-full w-full object-contain" />
                  ) : (
                    <div className="spinner" />
                  )}
                </div>
                <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Tap QR/address to copy</div>
                <div className="max-w-full break-all font-mono text-[12px] font-bold leading-relaxed text-[var(--gold2)]">
                  {depositAddress?.address ?? 'Preparing address...'}
                </div>
              </button>
            </>
          )}

          {depositMethod === 'exchange' && cexSetup?.enabled && (
            <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--clay)] p-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Bybit · USDT internal transfer</div>
                <div className="mt-1 text-[10px] leading-relaxed text-[var(--text2)]">
                  Send USDT from your Bybit account to MafitaPay’s Bybit UID. No blockchain network or gas fee is involved.
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--clay2)] p-3">
                <div className="text-[8px] uppercase tracking-[1px] text-[var(--muted)]">MafitaPay Bybit UID</div>
                <button type="button" onClick={() => void copyCexUid()} className="mt-1 break-all text-left font-mono text-[13px] font-bold text-[var(--gold2)]">
                  {cexSetup.receivingUid}
                </button>
              </div>
              {!cexSetup.account && (
                <>
                  <label className="text-[9px] font-semibold text-[var(--text2)]" htmlFor="bybit-sender-uid">Your Bybit UID</label>
                  <input
                    id="bybit-sender-uid"
                    inputMode="numeric"
                    autoComplete="off"
                    value={cexSenderUid}
                    onChange={event => setCexSenderUid(event.target.value.replace(/\D/g, '').slice(0, 24))}
                    placeholder="Enter your Bybit UID"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--coal)] px-3 py-2.5 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--gold2)]"
                  />
                  <div className="text-[9px] leading-relaxed text-[var(--muted)]">
                    We’ll verify ownership with a one-time exact transfer. After verification, deposits from this UID will credit automatically.
                  </div>
                  {cexSetupError && <div className="text-[10px] text-[var(--red2)]">{cexSetupError}</div>}
                  <Button variant="green" onClick={() => void linkBybitUid()} disabled={savingCexAccount || cexSenderUid.length < 4} className="w-full py-3">
                    {savingCexAccount ? 'Linking Bybit UID…' : 'Link Bybit UID'}
                  </Button>
                </>
              )}
              {cexSetup.account?.status === 'pending_verification' && (
                <div className="rounded-lg border border-[rgba(202,165,96,.28)] bg-[rgba(202,165,96,.08)] p-3">
                  <div className="text-[10px] font-bold text-[var(--gold2)]">Verify your Bybit UID</div>
                  <div className="mt-1 text-[10px] leading-relaxed text-[var(--text2)]">
                    From UID <span className="font-mono font-bold">{cexSetup.account.externalUid}</span>, transfer exactly{' '}
                    <span className="font-mono font-bold">{cexSetup.account.challengeAmount.toFixed(2)} USDT</span> to MafitaPay’s UID above.
                    This verification transfer is credited at the current sell rate. Expires {new Date(cexSetup.account.challengeExpiresAt).toLocaleString()}.
                  </div>
                  {new Date(cexSetup.account.challengeExpiresAt).getTime() > Date.now() ? (
                    <div className="mt-2 text-[9px] text-[var(--muted)]">Waiting for the exchange record… this panel refreshes automatically.</div>
                  ) : (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="text-[9px] text-[var(--muted)]">This verification amount expired. Generate a new amount if you have not sent the old one.</div>
                      <Button variant="secondary" onClick={() => void linkBybitUid()} disabled={savingCexAccount} className="w-full py-2">
                        {savingCexAccount ? 'Refreshing amount…' : 'Generate new amount'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {cexSetup.account?.status === 'verified' && (
                <div className="rounded-lg border border-[rgba(58,155,110,.3)] bg-[rgba(58,155,110,.08)] p-3">
                  <div className="text-[10px] font-bold text-[var(--green2)]">Bybit UID verified</div>
                  <div className="mt-1 text-[10px] leading-relaxed text-[var(--text2)]">
                    Send USDT from UID <span className="font-mono font-bold">{cexSetup.account.externalUid}</span> to MafitaPay’s UID above. Successful deposits are credited to NGN at the sell rate when detected. Other sender UIDs are not auto-credited.
                  </div>
                  <button type="button" onClick={() => void unlinkBybitUid()} className="mt-2 text-[9px] font-semibold text-[var(--muted)] underline underline-offset-2">Change linked UID</button>
                </div>
              )}
              <Button variant="secondary" onClick={handleClose} className="w-full py-3">Done</Button>
            </div>
          )}

          {depositMethod === 'wallet' && (
            <>
              <div className="border border-[rgba(196,52,26,.2)] border-l-4 border-l-[var(--red2)] bg-[rgba(196,52,26,.06)] p-3">
                <div className="mb-1 text-[10px] font-bold text-[var(--red2)]">Send on the correct network</div>
                <div className="text-[10px] leading-relaxed text-[var(--muted)]">
                  Select {asset.network} in the sender app. Sending another token or using the wrong network can permanently lose funds.
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void copyAddress()} disabled={!depositAddress?.address} className="flex-1 py-3">
                  Copy Address
                </Button>
                <Button variant="green" onClick={handleClose} className="flex-1 py-3">
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
