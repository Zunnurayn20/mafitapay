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
import { CryptoAsset, CryptoPairId } from '@/types'

export function SellModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast, modalData, cryptoDepositAddresses } = useAppStore()
  const assets = useCryptoAssets()
  const sellableAssets = useMemo(
    () => assets.filter(isDepositableCryptoAsset),
    [assets],
  )
  const assetGroups = useMemo(() => groupCryptoAssetsBySymbol(sellableAssets), [sellableAssets])
  const initializedPairRef = useRef(false)
  const [pairId, setPairId] = useState<CryptoPairId>('USDT_BSC')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [pickerSymbol, setPickerSymbol] = useState<string | null>(null)
  const [qrRenderKey, setQrRenderKey] = useState(0)
  const qrCodeCacheRef = useRef<Record<string, string>>({})
  // Quick win: support Binance internal (CEX) deposit method for crypto-to-NGN
  const [depositMethod, setDepositMethod] = useState<'wallet' | 'binance'>('wallet')
  const [cexInstructions, setCexInstructions] = useState<{ uid: string; memo: string; instructions: string } | null>(null)
  const [creatingCexIntent, setCreatingCexIntent] = useState(false)

  const modalAsset = modalData.cryptoAsset as CryptoAsset | undefined
  const asset = sellableAssets.find(a => a.id === pairId)
    ?? (modalAsset?.id === pairId ? modalAsset : undefined)
    ?? sellableAssets[0]
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
  }, [modalAsset?.id, modalData.cryptoPairId, open, sellableAssets])

  useEffect(() => {
    if (!open || sellableAssets.length === 0) return
    if (sellableAssets.some(item => item.id === pairId)) return
    setPairId(sellableAssets[0].id)
  }, [open, pairId, sellableAssets])

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

  // createBinanceCexIntent temporarily parked (CEX feature skipped while focusing on on-chain)
  // async function createBinanceCexIntent() { ... }

  function copyCex(field: 'uid' | 'memo') {
    const val = field === 'uid' ? cexInstructions?.uid : cexInstructions?.memo
    if (val) {
      navigator.clipboard?.writeText(val).then(() => showToast(`${field === 'uid' ? 'UID' : 'Memo'} copied`))
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Crypto Deposit">
      {!asset && (
        <div className="p-8 text-center">
          <div className="spinner mx-auto mb-4" />
          <div className="text-[12px] text-[var(--text)]">Loading asset data...</div>
        </div>
      )}

      {asset && (
        <div className="flex flex-col gap-4 p-6">
          <div className="relative flex items-center justify-between gap-3 border border-[rgba(202,165,96,.28)] bg-[var(--clay)] p-3">
            <div>
              <div className="text-[7px] uppercase tracking-[1px] text-[var(--text2)]">Auto-credit sell rate</div>
              <div className="font-mono text-[15px] font-bold text-[var(--gold)]">{formatNGN(asset.sellRate)} / {asset.symbol}</div>
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

          {/* CEX Binance internal temporarily parked while focusing on on-chain deposit testing.
              Only on-chain wallet deposits are active for now. */}
          {/* <div className="flex gap-2 text-[9px]">
            <button
              onClick={() => { setDepositMethod('wallet'); setCexInstructions(null) }}
              className={`flex-1 py-1 border ${depositMethod === 'wallet' ? 'border-[var(--gold2)] bg-[var(--clay2)]' : 'border-[var(--border)]'}`}
            >
              From Wallet (on-chain)
            </button>
            <button
              onClick={() => setDepositMethod('binance')}
              className={`flex-1 py-1 border ${depositMethod === 'binance' ? 'border-[var(--gold2)] bg-[var(--clay2)]' : 'border-[var(--border)]'}`}
            >
              From Binance (internal)
            </button>
          </div> */}
          <div className="text-[8px] text-[var(--muted)]">Using on-chain wallet deposit (CEX internal parked for focused testing).</div>

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

          {/* Binance CEX internal UI parked (see comment above). Only on-chain path active. */}
          {/* {depositMethod === 'binance' && ( ... full block ... )} */}

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
        </div>
      )}
    </Modal>
  )
}
