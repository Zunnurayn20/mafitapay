'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { AssetLogo } from '@/components/ui/AssetLogo'
import { useCryptoAssets } from '@/lib/client/catalogs'
import { useAppStore } from '@/store'
import { EXCHANGES, DEPOSIT_UIDS } from '@/lib/constants'
import { formatCrypto, formatNGN, sleep } from '@/lib/utils'
import { CryptoAsset, CryptoPairId, CryptoQuote } from '@/types'

type Step = 'form' | 'deposit' | 'processing' | 'success'
type ReceiveMethod = 'exchange' | 'wallet'

function getPricingBadgeTone(pricingSource?: CryptoAsset['pricingSource']) {
  return pricingSource === 'live'
    ? 'border-[rgba(46,170,92,.25)] bg-[rgba(46,170,92,.1)] text-[var(--green2)]'
    : pricingSource === 'backup'
      ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.08)] text-[var(--gold2)]'
      : 'border-[rgba(220,38,38,.25)] bg-[rgba(220,38,38,.08)] text-[var(--red2)]'
}

function getPricingSourceLabel(pricingSource?: CryptoAsset['pricingSource']) {
  return pricingSource === 'live' ? 'Live Price' : pricingSource === 'backup' ? 'Cached Price' : 'Price Unavailable'
}

export function SellModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshSession, showToast, modalData } = useAppStore()
  const assets = useCryptoAssets()
  const sellableAssets = assets.filter(asset => Object.values(DEPOSIT_UIDS).some(exchangeMap => Boolean(exchangeMap[asset.id])))
  const [step, setStep]           = useState<Step>('form')
  const [pairId, setPairId]       = useState<CryptoPairId>('USDT_BSC')
  const [amount, setAmount]       = useState('')
  const [method, setMethod]       = useState<ReceiveMethod>('exchange')
  const [exchange, setExchange]   = useState('Binance')
  const [walletAddr, setWalletAddr] = useState('')
  const [ref, setRef]             = useState('')
  const [time, setTime]           = useState(30 * 60)
  const [quote, setQuote]         = useState<CryptoQuote | null>(null)

  const modalAsset = modalData.cryptoAsset as CryptoAsset | undefined
  const asset  = sellableAssets.find(a => a.id === pairId)
    ?? (modalAsset?.id === pairId ? modalAsset : undefined)
    ?? sellableAssets[0]
  const amt    = parseFloat(amount) || 0
  const crypto = quote?.cryptoAmount ?? (asset ? amt / asset.sellRate : 0)
  const fee    = 0
  const receive = amt - fee

  const uid = (DEPOSIT_UIDS[exchange] || DEPOSIT_UIDS.Binance)[asset?.id] || '—'

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

    if (sellableAssets[0]?.id) {
      setPairId(sellableAssets[0].id)
    }
  }, [modalAsset, modalData, open, sellableAssets])

  useEffect(() => {
    if (step !== 'deposit' || !quote) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(quote.expiresAt).getTime() - Date.now()) / 1000))
      setTime(remaining)
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
    setTimeout(() => { setStep('form'); setAmount(''); setQuote(null) }, 400)
  }

  async function goDeposit() {
    if (!amt || !asset) { showToast('Enter a valid amount', 'error'); return }
    const response = await fetch('/api/crypto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        intent: 'quote',
        action: 'sell',
        pairId: asset.id,
        amount: amt,
      }),
    })
    const payload = await response.json()
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || 'Quote request failed.')
    }
    setQuote(payload.data.quote)
    setTime(payload.data.asset.quoteTtlSeconds)
    setStep('deposit')
  }

  async function confirmSent() {
    setStep('processing')
    await sleep(1300)

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
          action: 'sell',
          pairId: asset.id,
          amount: amt,
          quoteId: quote.id,
          receiveMethod: method,
          exchange,
          walletAddress: walletAddr,
        }),
      })
      const payload = await response.json()

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || 'Sell order failed.')
      }

      await sleep(700)
      setRef(payload.data.transaction.reference)
      await refreshSession()
      setStep('success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Sell order failed.', 'error')
      setStep('deposit')
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Sell Crypto">
      {!asset && (
        <div className="p-8 text-center">
          <div className="spinner mx-auto mb-4" />
          <div className="text-[12px] text-[var(--text)]">Loading asset data…</div>
        </div>
      )}

      {asset && step === 'form' && (
        <div className="p-6 flex flex-col gap-4">
          <div>
            <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-[1px] mb-2">Asset to Sell</div>
            <div className="flex border border-[var(--border)] bg-[var(--clay2)] focus-within:border-[var(--gold)] transition-colors">
              <div className="flex items-center gap-3 px-3 py-2.5 min-w-0 flex-1">
                <AssetLogo
                  src={asset.icon}
                  alt={`${asset.symbol} logo`}
                  fallback={asset.symbol.slice(0, 1)}
                  className="flex h-9 w-9 items-center justify-center overflow-hidden bg-[rgba(79,70,229,.1)] flex-shrink-0"
                  imgClassName="h-7 w-7 object-contain"
                  textClassName="text-lg"
                />
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-[var(--text)] truncate">{asset.name}</div>
                  <div className="text-[8px] text-[var(--muted)]">{asset.symbol} · {asset.network}</div>
                </div>
              </div>
              <select
                value={pairId}
                onChange={event => setPairId(event.target.value as CryptoPairId)}
                className="border-l border-[var(--border)] bg-[var(--clay)] px-3 py-2 text-[11px] text-[var(--text)] outline-none min-w-[8.5rem] flex-shrink-0"
              >
                {assets.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.symbol} · {a.network}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between bg-[var(--clay)] border border-[var(--border)] p-3">
            <div><div className="text-[7px] text-[var(--muted)] uppercase tracking-[1px]">Sell Rate</div>
              <div className="text-[15px] font-bold font-mono text-[var(--gold2)]">{formatNGN(asset.sellRate)} / {asset.symbol}</div>
            </div>
            <div className={`text-[8px] font-bold border px-2.5 py-1 ${getPricingBadgeTone(asset.pricingSource)}`}>
              {getPricingSourceLabel(asset.pricingSource)}
            </div>
          </div>
          <div>
            <Input label="NGN Value to Receive" prefix="₦" type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="text-lg font-bold font-display" />
            <div className="flex items-center justify-between bg-[var(--clay)] border border-[var(--border)] px-3.5 py-2.5 mt-2">
              <span className="text-[9px] text-[var(--muted)]">You send</span>
              <span className="text-[14px] font-bold font-display text-[var(--text)]">{formatCrypto(crypto, asset.symbol)}</span>
            </div>
          </div>
          <div>
            <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-[1px] mb-2">Receive Method</div>
            <div className="grid grid-cols-2 gap-2">
              {(['exchange', 'wallet'] as ReceiveMethod[]).map(m => (
                <div key={m} onClick={() => setMethod(m)}
                  className={`flex items-center gap-2.5 p-3 border cursor-pointer transition-all ${method === m ? 'bg-[rgba(79,70,229,.08)] border-[var(--gold)]' : 'bg-[var(--clay2)] border-[var(--border)]'}`}>
                  <span className="text-lg">{m === 'exchange' ? '🏦' : '🦊'}</span>
                  <div><div className="text-[11px] font-bold text-[var(--text)]">{m === 'exchange' ? 'Exchange' : 'Web3 Wallet'}</div>
                    <div className="text-[8px] text-[var(--muted)]">{m === 'exchange' ? 'Binance, Bybit…' : 'MetaMask, Trust…'}</div>
                  </div>
                </div>
              ))}
            </div>
            {method === 'exchange' && (
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                {EXCHANGES.map(ex => (
                  <div key={ex} onClick={() => setExchange(ex)}
                    className={`p-2 text-center text-[10px] font-bold cursor-pointer border transition-all ${exchange === ex ? 'bg-[rgba(79,70,229,.1)] border-[var(--gold)] text-[var(--text)]' : 'bg-[var(--clay2)] border-[var(--border)] text-[var(--text2)]'}`}>
                    {ex}
                  </div>
                ))}
              </div>
            )}
            {method === 'wallet' && (
              <div className="mt-2">
                <Input placeholder="0x… or TRC address" value={walletAddr} onChange={e => setWalletAddr(e.target.value)} className="text-[11px] font-mono" suffix="PASTE" />
              </div>
            )}
          </div>
          <div className="bg-[var(--clay)] border border-[var(--border)] p-3 text-[11px]">
            <div className="flex justify-between py-1"><span className="text-[var(--muted)]">Embedded spread</span><span className="font-mono text-[var(--text)]">{(asset.sellSpreadBps / 100).toFixed(2)}%</span></div>
            <div className="flex justify-between py-1 font-bold"><span className="text-[var(--text2)]">You receive (NGN)</span><span className="font-mono text-[var(--green2)]">{formatNGN(receive)}</span></div>
          </div>
          <Button variant="green" onClick={() => void goDeposit().catch(error => showToast(error instanceof Error ? error.message : 'Quote request failed.', 'error'))} className="w-full py-3.5">Lock Quote →</Button>
        </div>
      )}

      {asset && step === 'deposit' && (
        <div className="p-6 flex flex-col gap-4">
          <div className="bg-[var(--clay)] border border-[var(--border)] border-l-4 border-l-[var(--gold)] p-4">
            <div className="text-[9px] font-bold text-[var(--gold2)] uppercase tracking-wider mb-1">How to complete</div>
            <div className="text-[11px] text-[var(--text2)] leading-[1.7]">
              {method === 'exchange' ? `Log in to ${exchange} → Withdraw → paste our deposit address → send exactly ${formatCrypto(crypto, asset.symbol)} on ${asset.network}.` : `Open your wallet → send exactly ${formatCrypto(crypto, asset.symbol)} on ${asset.network} to our address below.`}
            </div>
          </div>
          <div className="flex items-center justify-between bg-[var(--clay)] border border-[var(--border)] p-3">
            <div><div className="text-[9px] text-[var(--muted)] mb-1">You are sending</div><div className="font-display font-black text-[20px] text-[var(--text)]">{formatCrypto(crypto, asset.symbol)}</div></div>
            <div className="text-right"><div className="text-[9px] text-[var(--muted)] mb-1">You receive</div><div className="text-[14px] font-bold font-mono text-[var(--green2)]">{formatNGN(receive)} NGN</div></div>
          </div>
          <div>
            <div className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-[1px] mb-1.5">{exchange} Deposit Address ({asset.symbol} · {asset.network})</div>
            <div className="bg-[var(--clay2)] border border-[var(--border)] p-3.5 flex items-start gap-3">
              <div className="flex-1 text-[12px] font-bold font-mono text-[var(--gold2)] break-all">{uid}</div>
              <Button variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(uid)} className="flex-shrink-0">COPY</Button>
            </div>
          </div>
          <div className="bg-[rgba(196,52,26,.06)] border border-[rgba(196,52,26,.2)] border-l-4 border-l-[var(--red2)] p-3">
            <div className="text-[10px] font-bold text-[var(--red2)] mb-1">⚠ Send on the correct network</div>
            <div className="text-[10px] text-[var(--muted)] leading-relaxed">Make sure you select {asset.network} on {exchange}. Wrong network = lost funds.</div>
          </div>
          <div className="flex items-center justify-between bg-[var(--clay)] border border-[var(--border)] px-4 py-3">
            <div className="text-[10px] text-[var(--muted)]">Order expires in</div>
            <div className="text-[14px] font-bold font-mono text-[var(--terra2)]">{String(Math.floor(time/60)).padStart(2,'0')}:{String(time%60).padStart(2,'0')}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('form')} className="flex-none px-5">← Back</Button>
            <Button variant="green" onClick={confirmSent} className="flex-1 py-3.5">I&apos;ve Sent It ✓</Button>
          </div>
        </div>
      )}

      {asset && step === 'processing' && (
        <div className="p-10 text-center"><div className="spinner mx-auto mb-4" /><div className="font-display font-bold text-[17px] text-[var(--text)]">Verifying…</div><div className="text-[11px] text-[var(--muted)] mt-1">Confirming receipt of {asset.symbol} on {asset.network} before releasing your NGN balance.</div></div>
      )}

      {asset && step === 'success' && (
        <div className="p-9 text-center flex flex-col items-center gap-4">
          <div className="w-[72px] h-[72px] rounded-full bg-[rgba(46,170,92,.12)] border-2 border-[rgba(46,170,92,.3)] flex items-center justify-center text-[28px] animate-pop">✅</div>
          <div className="font-display font-black text-[24px] text-[var(--text)]">Order Placed!</div>
          <div className="text-[13px] text-[var(--text2)]">{formatNGN(receive)} will be credited to your NGN balance after the sale is fulfilled.</div>
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
