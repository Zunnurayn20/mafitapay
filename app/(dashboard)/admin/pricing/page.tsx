import { AdminPageCard } from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { loadPricingRulesForAdmin } from '@/lib/server/data-pricing'
import { getPricedAmigoPlans } from '@/lib/server/amigo-bills'
import { getPricedAsbdataPlans, listAsbdataPlanTypes } from '@/lib/server/asbdata-bills'
import { PricingClient } from './PricingClient'

export default async function AdminPricingPage() {
  await requireAdminPageUser()

  const [rules, amigoPlans, asbdataPlans, asbdataPlanTypes] = await Promise.all([
    loadPricingRulesForAdmin(),
    getPricedAmigoPlans().catch(() => []),
    getPricedAsbdataPlans().catch(() => []),
    listAsbdataPlanTypes(),
  ])

  const preview = [
    ...amigoPlans.slice(0, 4).map(plan => ({
      vendor: 'amigo' as const,
      name: `${plan.network} ${plan.label}`,
      variationCode: String(plan.planId),
      costNgn: plan.costNgn,
      marginNgn: plan.marginNgn,
      retailNgn: plan.retailNgn,
    })),
    ...asbdataPlans.slice(0, 4).map(plan => ({
      vendor: 'asbdata' as const,
      name: `${plan.network} ${plan.size}`,
      variationCode: String(plan.planId),
      costNgn: plan.costNgn,
      marginNgn: plan.marginNgn,
      retailNgn: plan.retailNgn,
    })),
  ]

  const planTypes = Array.from(new Set([
    'STANDARD',
    'SME',
    'SME2',
    'GIFTING',
    'CORPORATE GIFTING',
    'AWOOF DATA',
    ...asbdataPlanTypes,
    ...amigoPlans.map(plan => plan.planType),
  ])).sort()

  return (
    <div className="space-y-4">
      <AdminPageCard
        title="Data pricing"
        description="Operator margins on wholesale data plans (Amigo + ASBDATA). Same model as online-data-sub: percent, flat, floor, cap, and round — most specific rule wins."
      >
        <PricingClient
          initialRules={rules}
          preview={preview}
          networks={['MTN', 'Airtel', 'Glo', '9mobile']}
          planTypes={planTypes}
        />
      </AdminPageCard>

      <AdminPageCard
        title="How this works"
        description="Where data pricing stops, and what still uses the old flat-margin page."
      >
        <div className="space-y-3 p-4 text-sm leading-relaxed text-slate-500">
          <p>
            Retail price = wholesale + % margin + flat ₦, then floor/cap, then round up.
            A GLOBAL rule covers every plan; NETWORK / PLAN_TYPE / PLAN override it for matching plans.
          </p>
          <p>
            Vendor can be left blank (both Amigo and ASBDATA) or pinned to one provider. PLAN-scope
            rules require a vendor because plan codes are not shared between them.
          </p>
          <p>
            <strong className="text-amber-700">No rule means sell at wholesale</strong> — you earn
            nothing until at least a GLOBAL rule is active.
          </p>
          <p>
            Bank transfer fees stay on{' '}
            <a href="/admin/margins" className="font-semibold text-[#8c6b31] hover:underline">
              Profit margins
            </a>
            . Crypto spreads stay on{' '}
            <a href="/admin/catalogs/assets" className="font-semibold text-[#8c6b31] hover:underline">
              Crypto assets
            </a>
            .
          </p>
        </div>
      </AdminPageCard>
    </div>
  )
}
