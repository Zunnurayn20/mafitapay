import { AdminPageCard } from '@/components/admin/AdminUi'
import { requireAdminPageUser } from '@/lib/server/admin-queries'
import { getDisabledDataPlanCategories, getDisabledDataPlans } from '@/lib/server/data'
import { DEFAULT_DATA_PLAN_NETWORKS, DEFAULT_DATA_PLAN_TYPES, getDataPlanCategoryKey, getDataPlanCategoryLabel } from '@/lib/data-plan-categories'
import { getPricedAmigoPlans } from '@/lib/server/amigo-bills'
import { getPricedAsbdataPlans } from '@/lib/server/asbdata-bills'
import { getPricedBardetechPlans } from '@/lib/server/bardetech-bills'
import { isFlutterwaveBillsEnabled, listFlutterwaveDataBundleNetworkProviders } from '@/lib/server/flutterwave-bills'
import { getNetworkProviders } from '@/lib/server/data'
import { DisabledPlansClient } from './DisabledPlansClient'
import { DataPlanCategoryControls } from './DataPlanCategoryControls'

export default async function DisabledDataPlansPage() {
  await requireAdminPageUser()
  const [plans, amigoPlans, asbdataPlans, bardetechPlans, disabledCategories, baseNetworkProviders] = await Promise.all([
    getDisabledDataPlans(),
    getPricedAmigoPlans({ includeDisabled: true }).catch(() => []),
    getPricedAsbdataPlans({ includeDisabled: true }).catch(() => []),
    getPricedBardetechPlans({ includeDisabled: true }).catch(() => []),
    getDisabledDataPlanCategories(),
    getNetworkProviders(),
  ])
  const flutterwaveNetworks = isFlutterwaveBillsEnabled()
    ? await listFlutterwaveDataBundleNetworkProviders(baseNetworkProviders).catch(() => baseNetworkProviders)
    : []
  const catalog = [
    ...amigoPlans.map(plan => ({ vendor: 'amigo' as const, networkId: plan.networkId, network: plan.network, planId: String(plan.planId), category: plan.planType, label: plan.label, validity: plan.validity, retailNgn: plan.retailNgn })),
    ...asbdataPlans.map(plan => ({ vendor: 'asbdata' as const, networkId: plan.networkId, network: plan.network, planId: String(plan.planId), category: plan.planType, label: plan.size, validity: plan.validity, retailNgn: plan.retailNgn })),
    ...bardetechPlans.map(plan => ({ vendor: 'bardetech' as const, networkId: plan.networkId, network: plan.network, planId: String(plan.planId), category: plan.planType, label: plan.size, validity: plan.validity, retailNgn: plan.retailNgn })),
    ...flutterwaveNetworks.flatMap(network => (network.dataBundles ?? [])
      .filter(bundle => bundle.provider === 'flutterwave')
      .filter(bundle => bundle.providerNetworkId !== undefined)
      .map(bundle => ({ vendor: 'flutterwave' as const, networkId: bundle.providerNetworkId!, network: network.name, planId: bundle.itemCode, category: bundle.planType ?? 'STANDARD', label: bundle.label, validity: bundle.validity ?? '—', retailNgn: bundle.amount }))),
  ]
  const networkKeys = new Set<string>([
    ...DEFAULT_DATA_PLAN_NETWORKS.map(network => network.key),
    ...catalog.map(plan => getDataPlanCategoryKey('network', plan.network)),
    ...disabledCategories.filter(category => category.categoryType === 'network').map(category => category.categoryKey),
  ])
  const planTypeKeys = new Set<string>([
    ...DEFAULT_DATA_PLAN_TYPES,
    ...catalog.map(plan => getDataPlanCategoryKey('plan_type', plan.category)),
    ...disabledCategories.filter(category => category.categoryType === 'plan_type').map(category => category.categoryKey),
  ])
  const categoryOptions = [
    ...Array.from(networkKeys).filter(Boolean).map(key => ({ categoryType: 'network' as const, categoryKey: key, label: getDataPlanCategoryLabel('network', key) })),
    ...Array.from(planTypeKeys).filter(Boolean).map(key => ({ categoryType: 'plan_type' as const, categoryKey: key, label: getDataPlanCategoryLabel('plan_type', key) })),
  ]
  return (
    <AdminPageCard
      title="Disabled data plans"
      description="Switch off a network or plan type across all data providers, or disable an individual plan. Each setting hides matching plans and blocks new purchases."
    >
      <DataPlanCategoryControls options={categoryOptions} initialDisabled={disabledCategories} />
      <DisabledPlansClient initialPlans={plans} catalog={catalog} />
    </AdminPageCard>
  )
}
