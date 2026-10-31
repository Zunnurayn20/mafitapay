import Link from 'next/link'
import { AdminPageCard } from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { loadPricingRulesForAdmin } from '@/lib/server/data-pricing'
import { getPricedAmigoPlans } from '@/lib/server/amigo-bills'
import { getPricedAsbdataPlans, listAsbdataPlanTypes } from '@/lib/server/asbdata-bills'
import { getPricedBardetechPlans, listBardetechPlanTypes } from '@/lib/server/bardetech-bills'
import { PricingClient } from './PricingClient'

export default async function AdminPricingPage() {
  await requireAdminPageUser()

  const [rules, amigoPlans, asbdataPlans, asbdataPlanTypes, bardetechPlans, bardetechPlanTypes] = await Promise.all([
    loadPricingRulesForAdmin(),
    getPricedAmigoPlans().catch(() => []),
    getPricedAsbdataPlans().catch(() => []),
    listAsbdataPlanTypes(),
    getPricedBardetechPlans().catch(() => []),
    listBardetechPlanTypes(),
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
    ...bardetechPlans.slice(0, 4).map(plan => ({
      vendor: 'bardetech' as const,
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
    ...bardetechPlanTypes,
    ...amigoPlans.map(plan => plan.planType),
  ])).sort()

  return (
    <div className="space-y-4">
      <AdminPageCard
        title="Data pricing"
        actions={(
          <Link
            href="/admin/pricing/disabled-plans"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Manage disabled plans
          </Link>
        )}
        description="Choose how much MafitaPay earns on each data plan. Set one default profit for all providers, then add exceptions only when needed."
      >
        <PricingClient
          initialRules={rules}
          preview={preview}
          networks={['MTN', 'Airtel', 'Glo', '9mobile']}
          planTypes={planTypes}
        />
      </AdminPageCard>

      <AdminPageCard
        title="Price basics"
        description="A quick guide to provider cost, MafitaPay profit, and customer price."
      >
        <div className="space-y-3 p-4 text-sm leading-relaxed text-slate-500">
          <p>
            The provider cost is what MafitaPay pays to deliver the plan. The customer price is the provider cost plus MafitaPay profit.
          </p>
          <p>
            The default profit applies to all plans. Rules for a network, plan category, or individual plan override the default when they match.
          </p>
          <p>
            The example above uses a ₦1,000 provider cost. The plan preview below Advanced pricing rules shows current provider costs and customer prices.
          </p>
          <p>
            Bank transfer fees are managed under{' '}
            <a href="/admin/margins" className="font-semibold text-[#8c6b31] hover:underline">
              Profit margins
            </a>
            . Crypto prices are managed under{' '}
            <a href="/admin/catalogs/assets" className="font-semibold text-[#8c6b31] hover:underline">
              Crypto assets
            </a>
            .
          </p>
          <p>
            To hide a plan without deleting it, open{' '}
            <a href="/admin/pricing/disabled-plans" className="font-semibold text-[#8c6b31] hover:underline">
              Disabled data plans
            </a>
            .
          </p>
        </div>
      </AdminPageCard>
    </div>
  )
}
