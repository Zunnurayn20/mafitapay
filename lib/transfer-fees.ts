/**
 * Bank transfer fee pricing.
 *
 * Flutterwave bills Nigerian payouts on a tier of the transfer amount, then adds VAT
 * on top of that fee (not on the transfer). We pass the billed cost through and add a
 * flat platform margin, so the margin per transfer is predictable regardless of size.
 *
 * Shared by client and server on purpose: the quote shown in the modal and the fee
 * actually debited come from this one function, so they cannot drift apart.
 */

/** Flutterwave's Nigeria payout fee tiers, before VAT. Ordered by ascending limit. */
const PAYOUT_FEE_TIERS: ReadonlyArray<{ upTo: number; fee: number }> = [
  { upTo: 5_000, fee: 10 },
  { upTo: 50_000, fee: 25 },
  { upTo: Infinity, fee: 50 },
]

/** VAT is charged on the transfer fee itself, not on the amount being transferred. */
const VAT_RATE = 0.075

const DEFAULT_PLATFORM_MARGIN = 25

export interface TransferFeeQuote {
  /** Amount that reaches the recipient. */
  amount: number
  /** What Flutterwave bills us, VAT included. */
  providerCost: number
  /** Our margin on top of the provider cost. */
  platformMargin: number
  /** What the user is charged: providerCost + platformMargin. */
  fee: number
  /** Amount + fee — what leaves the wallet. */
  total: number
}

function readMargin(): number {
  // Server-side override so pricing can be tuned without a deploy. Absent in the browser
  // bundle, which falls back to the default — the server value is what gets charged.
  const raw = typeof process !== 'undefined' ? process.env.MAFITAPAY_TRANSFER_FEE_MARGIN_NGN : undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PLATFORM_MARGIN
}

/** Round to kobo. Money held as a float needs this at every boundary or cents drift in. */
export function roundNgn(value: number): number {
  return Math.round(value * 100) / 100
}

/** What Flutterwave bills for a payout of this size, VAT included. */
export function flutterwavePayoutCost(amount: number): number {
  const tier = PAYOUT_FEE_TIERS.find((entry) => amount <= entry.upTo) ?? PAYOUT_FEE_TIERS[PAYOUT_FEE_TIERS.length - 1]
  return roundNgn(tier.fee * (1 + VAT_RATE))
}

/**
 * Full fee breakdown for a bank transfer or withdrawal.
 *
 * Pass `marginNgn` to price against the admin-configured margin. Both the server (when charging)
 * and the client (when quoting) supply the same value, sourced from the session payload, so the
 * figure on the PIN screen matches the debit. Omitting it falls back to the env default, which is
 * only correct before an admin has set one.
 *
 * Non-finite or non-positive amounts yield a zero quote rather than NaN, so a partially
 * typed amount in the UI renders blank instead of "₦NaN".
 */
export function quoteTransferFee(amount: number, marginNgn?: number): TransferFeeQuote {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { amount: 0, providerCost: 0, platformMargin: 0, fee: 0, total: 0 }
  }

  const resolvedMargin = Number.isFinite(marginNgn) && (marginNgn as number) >= 0
    ? (marginNgn as number)
    : readMargin()

  const providerCost = flutterwavePayoutCost(amount)
  const platformMargin = roundNgn(resolvedMargin)
  const fee = roundNgn(providerCost + platformMargin)

  return {
    amount: roundNgn(amount),
    providerCost,
    platformMargin,
    fee,
    total: roundNgn(amount + fee),
  }
}
