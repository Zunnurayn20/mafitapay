import { AdminPageCard } from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { listResolvedMargins } from '@/lib/server/profit-margins'
import { MarginsForm } from './MarginsForm'

export default async function AdminMarginsPage() {
  await requireAdminPageUser()
  const margins = await listResolvedMargins()

  return (
    <div className="space-y-4">
      <AdminPageCard
        title="Profit margins"
        description="What MafitaPay adds on top of provider cost, per product. Saving takes effect immediately — no redeploy."
      >
        <div className="p-4">
          <MarginsForm margins={margins} />
        </div>
      </AdminPageCard>

      <AdminPageCard
        title="How these apply"
        description="Where each margin lands, and what is not covered here."
      >
        <div className="space-y-3 p-4 text-sm leading-relaxed text-slate-500">
          <p>
            Bill margins are added to the provider&apos;s wholesale price when the data catalog is
            built, so a change re-prices every bundle the moment it is saved.
          </p>
          <p>
            The transfer margin sits on top of the Flutterwave payout cost, which already includes
            VAT. Customers see the combined figure as one transfer fee.
          </p>
          <p>
            <strong className="text-amber-700">A margin that is not set earns nothing.</strong> There
            is no default — an unset product sells at exactly what the provider charges us, so any
            row marked &ldquo;Not set&rdquo; is worth filling in.
          </p>
          <p>
            Changes apply to new transactions only. Anything already pending keeps the fee the
            customer was quoted and agreed to.
          </p>
          <p>
            Crypto spreads are not here — those are per-asset and live on the{' '}
            <a href="/admin/catalogs/assets" className="font-semibold text-[#8c6b31] hover:underline">
              Crypto assets
            </a>{' '}
            page.
          </p>
        </div>
      </AdminPageCard>
    </div>
  )
}
