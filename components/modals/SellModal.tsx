'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { formatNGN } from '@/lib/utils'
import { CryptoAsset, CryptoDepositAddressFamily, CryptoPairId } from '@/types'

function getAddressFamilyForAsset(asset?: CryptoAsset): CryptoDepositAddressFamily | null {
  if (!asset) return null
  const network = asset.network.trim().toLowerCase()
  if (asset.routedAddressFamily === 'solana' || network === 'solana') return 'solana'
  if (network === 'ton') return 'ton'
  if (network === 'near') return 'near'
  if (network === 'sui') return 'sui'
  if (network === 'base' || network === 'bsc' || network === 'ethereum' || asset.routedAddressFamily === 'evm') return 'evm'
  return null
}

export function SellModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { showToast, modalData, cryptoDepositAddresses } = useAppStore()
  const assets = useCryptoAssets()
  const sellableAssets = useMemo(
    () => assets.filter(asset => Boolean(getAddressFamilyForAsset(asset))),
    [assets],
  )
  const initializedPairRef = useRef(false)
  const [pairId, setPairId] = useState<CryptoPairId>('USDT_BSC')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [qrCodeUrl, setQrCodeUrl] = useState('')

  const modalAsset = modalData.cryptoAsset as CryptoAsset | undefined
  const asset = sellableAssets.find(a => a.id === pairId)
    ?? (modalAsset?.id === pairId ? modalAsset : undefined)
    ?? sellableAssets[0]
  const addressFamily = getAddressFamilyForAsset(asset)
  const depositAddress = cryptoDepositAddresses.find(item => item.addressFamily === addressFamily && item.isActive)

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
    setQrCodeUrl('')
    if (!depositAddress?.address) return

    void QRCode.toDataURL(depositAddress.address, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8,
      color: {
        dark: '#111111',
        light: '#fff7e6',
      },
    }).then(url => {
      if (!cancelled) setQrCodeUrl(url)
    }).catch(() => {
      if (!cancelled) setQrCodeUrl('')
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
      setQrCodeUrl('')
    }, 400)
  }

  async function copyAddress() {
    if (!depositAddress?.address) return
    await navigator.clipboard?.writeText(depositAddress.address)
    showToast('Deposit address copied.')
  }

  return (
    <Modal open={open} onClose={handleClose} title="Sell Crypto">
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
            </div>
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
            {showAssetPicker && (
              <div className="absolute right-3 top-[calc(100%+0.5rem)] z-20 grid grid-cols-4 gap-2 border border-[var(--border)] bg-[var(--coal)] p-3 shadow-[0_14px_30px_rgba(0,0,0,.35)]">
                {sellableAssets.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setPairId(a.id)
                      setShowAssetPicker(false)
                    }}
                    className={`flex h-12 w-12 items-center justify-center border ${pairId === a.id ? 'border-[var(--gold)] bg-[rgba(202,165,96,.12)]' : 'border-[var(--border)] bg-[var(--clay2)]'}`}
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

          <div className="border border-[rgba(202,165,96,.24)] bg-[var(--clay)] p-4">
            <div className="text-[9px] font-bold uppercase tracking-[1px] text-[var(--gold2)]">Send any amount</div>
            <div className="mt-1 text-[11px] leading-relaxed text-[var(--text2)]">
              Send only {asset.symbol} on {asset.network}. Once the network confirms it, MafitaPay detects the deposit, credits your NGN balance, and sweeps the crypto to treasury.
            </div>
          </div>

          <button
            type="button"
            onClick={() => void copyAddress()}
            disabled={!depositAddress?.address}
            className="flex flex-col items-center gap-3 border border-[var(--border)] bg-[var(--clay2)] p-4 text-center disabled:cursor-not-allowed disabled:opacity-70"
          >
            <div className="flex h-44 w-44 items-center justify-center border border-[rgba(202,165,96,.25)] bg-[#fff7e6] p-2">
              {qrCodeUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrCodeUrl} alt={`${asset.symbol} deposit QR code`} className="h-full w-full object-contain" />
              ) : (
                <div className="spinner" />
              )}
            </div>
            <div className="text-[8px] font-bold uppercase tracking-[1px] text-[var(--muted)]">Tap QR/address to copy</div>
            <div className="max-w-full break-all font-mono text-[12px] font-bold leading-relaxed text-[var(--gold2)]">
              {depositAddress?.address ?? 'Preparing address...'}
            </div>
          </button>

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
