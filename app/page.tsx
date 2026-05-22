import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { getCurrentUser } from '@/lib/server/auth'

const highlights = [
  { label: 'Wallet', value: 'NGN transfers, deposits, and withdrawals' },
  { label: 'Crypto', value: 'Buy supported assets directly to your own address' },
  { label: 'Bills', value: 'Airtime, data, and utility payments without extra clutter' },
]

const metrics = [
  { value: '1 app', label: 'wallet, bills, and crypto in one operational flow' },
  { value: '24/7', label: 'funding account and self-serve transaction access' },
  { value: 'Clean', label: 'receipts and transaction history that are actually readable' },
]

const trustPoints = [
  'Transaction PIN and biometric approval',
  'Permanent funding account for direct bank transfers',
  'Unified transaction receipts across dashboard and history',
]

const tickerItems = [
  'Permanent wallet funding',
  'Direct crypto purchase to wallet',
  'Airtime and data payments',
  'Receipt-first transaction history',
  'PIN and biometric protection',
]

const cryptoPreviewRows = [
  { symbol: 'BTC', price: '₦158.4M', change: '+2.4%' },
  { symbol: 'ETH', price: '₦5.21M', change: '+1.2%' },
  { symbol: 'USDT', price: '₦1,620', change: '+0.1%' },
  { symbol: 'SOL', price: '₦241,300', change: '+3.8%' },
]

const dashboardServices = [
  { icon: '📱', label: 'Airtime' },
  { icon: '🌐', label: 'Data' },
  { icon: '📺', label: 'Cable' },
  { icon: '⚡', label: 'Electric' },
]

export default async function Root() {
  const user = await getCurrentUser()
  if (user) redirect('/dashboard')

  const cookieStore = await cookies()
  if (cookieStore.get('mfp_seen_landing')?.value) {
    redirect('/login')
  }

  return (
    <main className="relative z-[1] min-h-screen overflow-hidden bg-[var(--page-bg)] text-[var(--text)]">
      <section className="relative border-b border-[var(--border)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(202,165,96,.16),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(46,170,92,.1),transparent_28%),linear-gradient(135deg,rgba(140,107,49,.08),transparent_45%,rgba(202,165,96,.03))]" />
        <div className="absolute inset-0 opacity-45" style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(202,165,96,.06) 0, rgba(202,165,96,.06) 2px, transparent 2px, transparent 26px), repeating-linear-gradient(-45deg, rgba(140,107,49,.06) 0, rgba(140,107,49,.06) 2px, transparent 2px, transparent 26px)' }} />
        <div className="absolute left-[-10rem] top-20 h-72 w-72 rounded-full bg-[rgba(202,165,96,.08)] blur-3xl" />
        <div className="absolute bottom-10 right-[-9rem] h-64 w-64 rounded-full bg-[rgba(46,170,92,.06)] blur-3xl" />
        <div className="absolute left-[8%] top-[22%] hidden h-40 w-40 rotate-12 border border-[rgba(202,165,96,.18)] bg-[linear-gradient(135deg,rgba(202,165,96,.1),rgba(140,107,49,.02))] lg:block animate-soft-pulse" />
        <div className="absolute bottom-[14%] right-[8%] hidden h-32 w-32 -rotate-12 border border-[rgba(46,170,92,.14)] bg-[linear-gradient(135deg,rgba(46,170,92,.08),rgba(12,9,7,.02))] lg:block animate-soft-pulse" />
        <div className="absolute inset-x-0 top-0 h-1 ank-strip" />

        <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-16 pt-6 sm:px-8 lg:px-12">
          <header className="flex items-center justify-between gap-4 border border-[var(--border)] bg-[rgba(12,9,7,.84)] px-4 py-3 shadow-[0_18px_42px_rgba(0,0,0,.18)] backdrop-blur sm:px-5">
            <div>
              <div className="font-display text-xl font-black tracking-[0.18em] text-[var(--gold2)] sm:text-2xl">
                MAFITAPAY
              </div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)] sm:text-[11px]">
                Digital finance for Nigerians
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="px-3 py-2 text-[10px] sm:px-4">
                  Login
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="px-3 py-2 text-[10px] sm:px-4">
                  Create Account
                </Button>
              </Link>
            </div>
          </header>

          <div className="mt-5 overflow-hidden border border-[rgba(202,165,96,.22)] bg-[rgba(18,13,10,.74)] px-4 py-2.5 shadow-[0_14px_36px_rgba(0,0,0,.14)]">
            <div className="animate-ticker whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--gold2)]">
              {tickerItems.map(item => `${item}  •  `).join('')}
            </div>
          </div>

          <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:gap-12 lg:py-14">
            <div className="space-y-6">
              <div className="inline-flex items-center border border-[rgba(202,165,96,.35)] bg-[rgba(202,165,96,.12)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold2)] shadow-[0_10px_24px_rgba(0,0,0,.12)]">
                Wallet, crypto, bills, and receipts in one flow
              </div>

              <div className="space-y-4">
                <h1 className="max-w-4xl font-display text-4xl font-black leading-[0.92] text-[var(--text)] sm:text-5xl lg:text-[5.2rem]">
                  Financial control that feels direct, premium, and built for daily use.
                </h1>
                <p className="max-w-2xl text-[15px] leading-7 text-[var(--text2)] sm:text-[16px]">
                  MafitaPay gives users a Nigerian wallet, permanent funding account, crypto purchase flow, and clean receipts in one place.
                  The product is built around direct, practical execution rather than layered dashboards, dead settings, and decorative friction.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/register">
                  <Button size="lg" className="w-full sm:w-auto">
                    Open Your Wallet
                  </Button>
                </Link>
                <Link href="/login">
                  <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                    Sign In
                  </Button>
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {metrics.map(item => (
                  <div
                    key={item.value}
                    className="border border-[rgba(202,165,96,.18)] bg-[rgba(24,19,15,.78)] px-4 py-4 shadow-[0_14px_34px_rgba(0,0,0,.12)]"
                  >
                    <div className="font-display text-2xl font-black text-[var(--gold2)]">
                      {item.value}
                    </div>
                    <div className="mt-1 text-[12px] leading-5 text-[var(--text2)]">
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {highlights.map(item => (
                  <div
                    key={item.label}
                    className="relative overflow-hidden border border-[var(--border)] bg-[rgba(34,27,21,.78)] px-4 py-4 shadow-[0_14px_40px_rgba(0,0,0,.14)]"
                  >
                    <div className="absolute right-0 top-0 h-12 w-12 bg-[radial-gradient(circle,rgba(202,165,96,.18),transparent_70%)]" />
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold2)]">
                      {item.label}
                    </div>
                    <div className="mt-2 text-[13px] leading-6 text-[var(--text2)]">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative min-h-[560px]">
              <div className="absolute inset-x-4 top-10 h-[360px] border border-[rgba(202,165,96,.16)] bg-[rgba(12,9,7,.24)]" />
              <div className="absolute right-4 top-0 hidden h-28 w-28 rotate-12 border border-[rgba(202,165,96,.18)] bg-[rgba(202,165,96,.06)] lg:block" />

              <div className="relative ml-auto hidden w-[min(100%,720px)] overflow-hidden border border-[var(--border2)] bg-[linear-gradient(180deg,rgba(34,27,21,.98),rgba(24,19,15,.98))] shadow-[0_28px_80px_rgba(0,0,0,.34)] lg:block">
                <div className="ank-strip" />
                <div className="relative overflow-hidden p-5">
                  <div
                    className="absolute inset-0 opacity-35"
                    style={{
                      backgroundImage:
                        'radial-gradient(circle at 18% 20%, rgba(202,165,96,.16), transparent 26%), radial-gradient(circle at 80% 76%, rgba(46,170,92,.08), transparent 24%), repeating-linear-gradient(135deg, rgba(202,165,96,.05) 0, rgba(202,165,96,.05) 1px, transparent 1px, transparent 18px)',
                    }}
                  />
                  <div className="relative">
                    <div className="flex items-center justify-between border border-[var(--border)] bg-[rgba(12,9,7,.48)] px-4 py-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--gold2)]">Crypto</div>
                        <div className="mt-1 text-[12px] text-[var(--text2)]">Live market strip, direct wallet purchase, and transaction receipt flow</div>
                      </div>
                      <div className="border border-[rgba(202,165,96,.22)] bg-[rgba(202,165,96,.1)] px-3 py-2 text-right">
                        <div className="text-[8px] uppercase tracking-[0.16em] text-[var(--muted)]">Wallet</div>
                        <div className="mt-1 font-mono text-[13px] font-bold text-[var(--text)]">₦184,560.42</div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {cryptoPreviewRows.map(row => (
                        <div key={row.symbol} className="border border-[rgba(202,165,96,.16)] bg-[rgba(34,27,21,.72)] px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-[var(--gold2)]">{row.symbol}</span>
                            <span className="text-[9px] font-semibold text-[var(--green2)]">{row.change}</span>
                          </div>
                          <div className="mt-2 text-[12px] font-bold text-[var(--text)]">{row.price}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid grid-cols-[1.2fr_.8fr] gap-4">
                      <div className="border border-[var(--border)] bg-[rgba(34,27,21,.78)] p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Assets</div>
                            <div className="mt-1 text-[15px] font-display font-black text-[var(--text)]">Supported pairs</div>
                          </div>
                          <div className="text-[10px] font-bold text-[var(--gold2)]">4 active</div>
                        </div>
                        <div className="mt-4 space-y-3">
                          {cryptoPreviewRows.map(row => (
                            <div key={`${row.symbol}-list`} className="flex items-center justify-between border border-[rgba(202,165,96,.14)] bg-[rgba(12,9,7,.34)] px-3 py-2.5">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(202,165,96,.12)] text-[11px] font-bold text-[var(--gold2)]">
                                  {row.symbol.slice(0, 1)}
                                </div>
                                <div>
                                  <div className="text-[11px] font-bold text-[var(--text)]">{row.symbol}</div>
                                  <div className="text-[9px] text-[var(--muted)]">Direct wallet delivery</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[11px] font-bold text-[var(--text)]">{row.price}</div>
                                <div className="text-[9px] font-semibold text-[var(--green2)]">{row.change}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="border border-[rgba(202,165,96,.2)] bg-[rgba(12,9,7,.4)] p-4">
                          <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Buy modal</div>
                          <div className="mt-3 space-y-2">
                            <div className="border border-[rgba(202,165,96,.16)] bg-[rgba(34,27,21,.72)] px-3 py-2 text-[10px] text-[var(--text2)]">USDT_BSC</div>
                            <div className="border border-[rgba(202,165,96,.16)] bg-[rgba(34,27,21,.72)] px-3 py-2 text-[10px] text-[var(--text2)]">₦20,000</div>
                            <div className="border border-[rgba(202,165,96,.16)] bg-[rgba(34,27,21,.72)] px-3 py-2 font-mono text-[9px] text-[var(--gold2)]">0x5e7C...beff8</div>
                            <div className="bg-[var(--gold)] px-3 py-2 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink)]">Buy</div>
                          </div>
                        </div>
                        <div className="grid gap-3">
                          {trustPoints.map(point => (
                            <div key={point} className="flex items-start gap-3 border border-[rgba(202,165,96,.16)] bg-[rgba(34,27,21,.66)] px-3 py-3">
                              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--green)] text-[10px] font-bold text-[var(--char)]">✓</span>
                              <span className="text-[10px] leading-5 text-[var(--text2)]">{point}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative mt-8 w-[290px] overflow-hidden rounded-[2rem] border border-[rgba(202,165,96,.22)] bg-[linear-gradient(180deg,rgba(34,27,21,.98),rgba(24,19,15,.99))] p-3 shadow-[0_24px_60px_rgba(0,0,0,.34)] lg:absolute lg:-bottom-2 lg:left-0 lg:mt-0">
                <div className="mx-auto mb-3 h-1.5 w-20 rounded-full bg-[rgba(202,165,96,.22)]" />
                <div className="overflow-hidden rounded-[1.4rem] border border-[var(--border)] bg-[var(--page-bg)]">
                  <div className="ank-strip" />
                  <div className="relative p-4">
                    <div
                      className="absolute inset-0 opacity-35"
                      style={{
                        backgroundImage:
                          'radial-gradient(circle at 12% 18%, rgba(202,165,96,.16), transparent 24%), radial-gradient(circle at 88% 76%, rgba(46,170,92,.1), transparent 20%)',
                      }}
                    />
                    <div className="relative">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Dashboard</div>
                          <div className="mt-1 text-[14px] font-display font-black text-[var(--text)]">₦78,597.00</div>
                        </div>
                        <div className="border border-[rgba(202,165,96,.2)] bg-[rgba(202,165,96,.12)] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--gold2)]">Active</div>
                      </div>

                      <div className="mt-4 border border-[rgba(202,165,96,.2)] bg-[rgba(12,9,7,.42)] p-3">
                        <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Funding Account</div>
                        <div className="mt-2 font-mono text-[18px] font-bold tracking-[0.08em] text-[var(--gold2)]">2048 5612 09</div>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {['Deposit', 'Send', 'Withdraw'].map(action => (
                          <div key={action} className="border border-[rgba(202,165,96,.16)] bg-[rgba(34,27,21,.74)] px-2 py-2 text-center text-[9px] font-bold text-[var(--text)]">
                            {action}
                          </div>
                        ))}
                      </div>

                      <div className="mt-4">
                        <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">Quick Services</div>
                        <div className="mt-2 grid grid-cols-4 gap-2">
                          {dashboardServices.map(service => (
                            <div key={service.label} className="border border-[rgba(202,165,96,.14)] bg-[rgba(34,27,21,.7)] px-2 py-3 text-center">
                              <div className="text-base">{service.icon}</div>
                              <div className="mt-1 text-[8px] font-bold text-[var(--text2)]">{service.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
