import type { CexExchange } from '@/types'

export function CexLogo({ exchange, size = 'md' }: { exchange: CexExchange; size?: 'sm' | 'md' }) {
  const dimensions = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'
  const initials = size === 'sm' ? 'text-[8px]' : 'text-[9px]'

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full border-2 border-[var(--gold)] shadow-sm ${dimensions} ${exchange === 'bitget' ? 'bg-[#101821]' : exchange === 'mexc' ? 'bg-[#071b2d]' : exchange === 'gateio' ? 'bg-[#152435]' : 'bg-[#17181b]'}`}
    >
      {exchange === 'bybit' ? (
        <span className={`font-black tracking-[-0.08em] text-white ${initials}`}>
          <span className="text-[#f7a600]">B</span>Y
        </span>
      ) : exchange === 'bitget' ? (
        <span className={`font-black tracking-[-0.08em] text-[#00d6a3] ${initials}`}>BG</span>
      ) : exchange === 'mexc' ? (
        <span className={`font-black tracking-[-0.08em] text-[#2e9bff] ${initials}`}>MX</span>
      ) : exchange === 'gateio' ? (
        <span className={`font-black tracking-[-0.08em] text-white ${initials}`}>G</span>
      ) : (
        <img src="/exchange-icons/okx.svg" alt="" className={size === 'sm' ? 'h-3 w-3 brightness-0 invert' : 'h-3.5 w-3.5 brightness-0 invert'} />
      )}
    </span>
  )
}
