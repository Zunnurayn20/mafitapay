import { AdminPageCard } from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { getDisabledDataPlans } from '@/lib/server/data'
import { DisabledPlansClient } from './DisabledPlansClient'

export default async function DisabledDataPlansPage() {
  await requireAdminPageUser()
  const plans = await getDisabledDataPlans()
  return (
    <AdminPageCard
      title="Disabled data plans"
      description="Disable a plan only after it fails a real provider test. It is hidden from customers and blocked on the purchase API; re-enable it here when the provider fixes it."
    >
      <DisabledPlansClient initialPlans={plans} />
    </AdminPageCard>
  )
}
