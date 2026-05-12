export function Ticker() {
  return (
    <div className="flex flex-shrink-0 items-center gap-4 overflow-hidden border-b border-[var(--border)] bg-[var(--clay)] px-4 py-2 sm:px-6 lg:px-8">
      <span className="text-[8px] font-bold text-[var(--gold)] tracking-[1.2px] flex-shrink-0">ÈRÒ ÌJÌNLẸ</span>
      <span
        className="text-[10px] text-[var(--muted)] italic whitespace-nowrap animate-ticker"
        style={{ animationDuration: '35s' }}
      >
        &ldquo;Owo l&apos;owo — a hand washes the other.&rdquo; · &ldquo;Eti alá ni idẹ ọrọ.&rdquo; · Live: USDT ₦1,620 buy · ₦1,590 sell · ETH ₦5.2M · BTC ₦158M · Zero-fee week active · 3 merchants online · Your funds are secured.
      </span>
    </div>
  )
}
