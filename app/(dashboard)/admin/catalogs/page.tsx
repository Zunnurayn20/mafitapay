import { AdminModuleIndex } from '../_components/AdminModuleIndex'

const SUBMODULES = [
  { href: '/admin/catalogs/rewards', label: 'Reward Rules', description: 'Reward configuration, payout reports, manual review queue.' },
  { href: '/admin/catalogs/bills', label: 'Bill Providers', description: 'Bill service setup and provider activation.' },
  { href: '/admin/catalogs/raw', label: 'Raw Catalog Data', description: 'Low-level JSON editors for remaining catalogs.' },
] as const

export default function AdminCatalogsPage() {
  return <AdminModuleIndex title="Catalogs" description="Bill providers, rewards, and raw catalog data." items={SUBMODULES} />
}
