import { AdminModuleIndex } from '../_components/AdminModuleIndex'

const SUBMODULES = [
  { href: '/admin/catalogs/assets', label: 'Crypto Assets', description: 'Price controls, spreads, execution rails, pair creation.' },
  { href: '/admin/catalogs/rewards', label: 'Reward Rules', description: 'Reward configuration, payout reports, manual review queue.' },
  { href: '/admin/catalogs/bills', label: 'Bill Providers', description: 'Bill service setup and provider activation.' },
  { href: '/admin/catalogs/raw', label: 'Raw Catalog Data', description: 'Low-level JSON editors for remaining catalogs.' },
] as const

export default function AdminCatalogsPage() {
  return <AdminModuleIndex title="Catalogs" description="Choose the catalog area you want to manage. Each submodule opens as its own admin page." items={SUBMODULES} />
}
