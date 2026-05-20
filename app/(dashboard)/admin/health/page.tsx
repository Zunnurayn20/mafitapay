import { AdminModuleIndex } from '../_components/AdminModuleIndex'

const SUBMODULES = [
  { href: '/admin/health/rails', label: 'Rails', description: 'Base executor, treasury, and 0x rail checks.' },
  { href: '/admin/health/providers', label: 'Providers', description: 'Flutterwave and provider-side health.' },
  { href: '/admin/health/market', label: 'Market', description: 'Crypto market cache freshness and live feed state.' },
] as const

export default function AdminHealthPage() {
  return <AdminModuleIndex title="Health" description="Choose the health view you want to inspect." items={SUBMODULES} />
}
