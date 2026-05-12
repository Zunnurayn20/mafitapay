import { NextResponse } from 'next/server'
import { appendNotification, createNotification, requireUser, unauthorized } from '@/lib/server/auth'
import { createCryptoOrder, createCryptoQuote, createStandaloneTransaction, getCryptoAssetById } from '@/lib/server/data'
import { createTransakWidgetSession, getTransakConfigState, isTransakPairSupported } from '@/lib/server/transak'
import { validateWalletAddressForAsset } from '@/lib/crypto-addresses'
import { getMinimumBuyNgnForAsset } from '@/lib/crypto-rules'
import { formatCrypto, generateRef } from '@/lib/utils'
import type { CryptoPairId } from '@/types'

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const config = getTransakConfigState()
  if (!config.configured) {
    return NextResponse.json({ error: 'Transak buy flow is not configured.', success: false }, { status: 503 })
  }

  const body = await req.json()
  const pairId = typeof body.pairId === 'string' ? body.pairId.trim() : ''
  const amount = Number(body.amount)
  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : ''

  if (!pairId) {
    return NextResponse.json({ error: 'pairId is required.', success: false }, { status: 400 })
  }
  const asset = await getCryptoAssetById(pairId as CryptoPairId)
  if (!asset || asset.isActive === false) {
    return NextResponse.json({ error: 'Unsupported crypto pair.', success: false }, { status: 400 })
  }
  if (!isTransakPairSupported(pairId as CryptoPairId) || asset.transakEnabled === false) {
    return NextResponse.json({ error: 'Transak checkout is not enabled for this crypto pair.', success: false }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount.', success: false }, { status: 400 })
  }
  const minimumBuyNgn = getMinimumBuyNgnForAsset(asset)
  if (amount < minimumBuyNgn) {
    return NextResponse.json({ error: `Minimum buy amount for ${pairId} is ₦${minimumBuyNgn.toLocaleString('en-NG')}.`, success: false }, { status: 400 })
  }
  if (!walletAddress) {
    return NextResponse.json({ error: 'Destination wallet address is required.', success: false }, { status: 400 })
  }
  const addressResult = validateWalletAddressForAsset(asset, walletAddress)
  if (!addressResult.valid) {
    return NextResponse.json({ error: addressResult.error || 'Destination wallet address is invalid.', success: false }, { status: 400 })
  }

  try {
    const partnerOrderId = `TXK-${generateRef()}`
    const requestUrl = new URL(req.url)
    const returnUrl = new URL('/crypto/return', requestUrl.origin)
    returnUrl.searchParams.set('partnerOrderId', partnerOrderId)
    const quoteData = await createCryptoQuote({
      userId: user.id,
      pairId: pairId as CryptoPairId,
      side: 'buy',
      amountNgn: amount,
    })
    const session = await createTransakWidgetSession({
      pairId: pairId as CryptoPairId,
      amountNgn: amount,
      walletAddress,
      partnerOrderId,
      partnerCustomerId: user.id,
      email: user.email,
      redirectUrl: returnUrl.toString(),
    })
    const transaction = await createStandaloneTransaction(user.id, {
      id: `txk_${generateRef()}`,
      type: 'crypto_buy',
      status: 'pending',
      amount: 0,
      fee: 0,
      description: `${quoteData.asset.symbol} Buy via Transak (${quoteData.asset.network}) — ${formatCrypto(quoteData.quote.cryptoAmount, quoteData.asset.symbol)}`,
      reference: partnerOrderId,
      createdAt: new Date().toISOString(),
      icon: '₿',
      metadata: {
        provider: 'transak',
        pairId: quoteData.asset.id,
        symbol: quoteData.asset.symbol,
        network: quoteData.asset.network,
        quoteId: quoteData.quote.id,
        quoteExpiresAt: quoteData.quote.expiresAt,
        walletAddress,
        providerReference: partnerOrderId,
        providerStatus: 'SESSION_CREATED',
      },
    })
    const cryptoOrder = await createCryptoOrder({
      userId: user.id,
      transactionId: transaction.id,
      quoteId: quoteData.quote.id,
      pairId: quoteData.asset.id,
      side: 'buy',
      amountNgn: amount,
      cryptoAmount: quoteData.quote.cryptoAmount,
      unitRate: quoteData.quote.unitRate,
      destinationType: 'wallet',
      destinationLabel: `${quoteData.asset.symbol} wallet on ${quoteData.asset.network}`,
      walletAddress,
      provider: 'transak',
      providerReference: partnerOrderId,
      providerStatus: 'SESSION_CREATED',
      providerPayload: { mode: 'widget_redirect', widgetUrl: session.widgetUrl },
      expiresAt: quoteData.quote.expiresAt,
      status: 'pending',
    })
    await appendNotification(user.id, createNotification({
      userId: user.id,
      title: 'Transak checkout started',
      message: `Provider checkout has been opened for ${formatCrypto(quoteData.quote.cryptoAmount, quoteData.asset.symbol)} on ${quoteData.asset.network}.`,
      type: 'info',
    }))

    return NextResponse.json({
      data: {
        mode: 'redirect',
        partnerOrderId,
        cryptoOrder,
        provider: session.provider,
        quote: quoteData.quote,
        transaction,
        widgetUrl: session.widgetUrl,
      },
      success: true,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to start Transak checkout.',
      success: false,
    }, { status: 502 })
  }
}
