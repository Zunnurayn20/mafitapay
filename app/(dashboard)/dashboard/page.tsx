import { WalletHero } from '@/components/dashboard/WalletHero'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { StatCards } from '@/components/dashboard/StatCards'
import { ActivityChart } from '@/components/dashboard/ActivityChart'
import { RecentTransactions } from '@/components/dashboard/RecentTransactions'
import { CryptoRates } from '@/components/dashboard/CryptoRates'
import { P2PWidget } from '@/components/dashboard/P2PWidget'
import { ServicesGrid } from '@/components/dashboard/ServicesGrid'

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <WalletHero />
      <QuickActions />
      <StatCards />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.95fr)]">
        <div className="space-y-6">
          <ActivityChart />
          <RecentTransactions />
        </div>
        <div className="space-y-6">
          <CryptoRates />
          <P2PWidget />
          <ServicesGrid />
        </div>
      </div>
    </div>
  )
}
