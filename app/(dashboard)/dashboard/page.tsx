import { WalletHero } from '@/components/dashboard/WalletHero'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { GoldBanner } from '@/components/dashboard/GoldBanner'
import { StatCards } from '@/components/dashboard/StatCards'
import { ActivityChart } from '@/components/dashboard/ActivityChart'
import { RecentTransactions } from '@/components/dashboard/RecentTransactions'
import { CryptoRates } from '@/components/dashboard/CryptoRates'
import { StocksWidget } from '@/components/dashboard/StocksWidget'
import { ServicesGrid } from '@/components/dashboard/ServicesGrid'

export default function DashboardPage() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <WalletHero />
      <QuickActions />
      <GoldBanner />
      <div className="md:hidden">
        <RecentTransactions />
      </div>
      <div className="hidden md:block">
        <StatCards />
      </div>
      <div className="hidden gap-6 md:grid xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.95fr)]">
        <div className="space-y-6">
          <ActivityChart />
          <RecentTransactions />
        </div>
        <div className="space-y-6">
          <CryptoRates />
          <StocksWidget />
          <ServicesGrid />
        </div>
      </div>
    </div>
  )
}
