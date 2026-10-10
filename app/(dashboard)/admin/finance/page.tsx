import { AdminPageCard } from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { OwnerFinanceWorkspace } from './OwnerFinanceWorkspace'

export default async function AdminFinancePage() {
  await requireAdminPageUser()

  return (
    <div className="space-y-4">
      <AdminPageCard
        title="Revenue & expenses"
        description="Record business income and costs, then compare them with automatically tracked customer fees."
      >
        <OwnerFinanceWorkspace />
      </AdminPageCard>
      <p className="px-1 text-xs leading-relaxed text-[var(--muted)]">
        Recorded net is entered income minus entered expenses. Customer fees and crypto network-fee recovery are shown separately; actual provider and treasury costs must be recorded when known. This is an operations view, not an accounting statement or verified profit report.
      </p>
    </div>
  )
}
