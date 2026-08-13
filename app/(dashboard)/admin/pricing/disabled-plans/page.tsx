import { AdminPageCard } from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { getDisabledDataPlans } from '@/lib/server/data'
import { getPricedAmigoPlans } from '@/lib/server/amigo-bills'
import { getPricedAsbdataPlans } from '@/lib/server/asbdata-bills'
import { getPricedBardetechPlans } from '@/lib/server/bardetech-bills'
import { DisabledPlansClient } from './DisabledPlansClient'

export default async function DisabledDataPlansPage() {
  await requireAdminPageUser()
  const [plans, amigoPlans, asbdataPlans, bardetechPlans] = await Promise.all([
    getDisabledDataPlans(),
    getPricedAmigoPlans().catch(() => []),
    getPricedAsbdataPlans().catch(() => []),
    getPricedBardetechPlans().catch(() => []),
  ])
  const catalog = [
    ...amigoPlans.map(plan => ({ vendor: 'amigo' as const, networkId: plan.networkId, network: plan.network, planId: String(plan.planId), category: plan.planType, label: `${plan.label} (${plan.validity})` })),
    ...asbdataPlans.map(plan => ({ vendor: 'asbdata' as const, networkId: plan.networkId, network: plan.network, planId: String(plan.planId), category: plan.planType, label: `${plan.size} (${plan.validity})` })),
    ...bardetechPlans.map(plan => ({ vendor: 'bardetech' as const, networkId: plan.networkId, network: plan.network, planId: String(plan.planId), category: plan.planType, label: `${plan.size} (${plan.validity})` })),
  ]
  return (
    <AdminPageCard
      title="Disabled data plans"
      description="Disable a plan only after it fails a real provider test. It is hidden from customers and blocked on the purchase API; re-enable it here when the provider fixes it."
    >
      <DisabledPlansClient initialPlans={plans} catalog={catalog} />
    </AdminPageCard>
  )
}
