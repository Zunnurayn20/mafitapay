import { AdminModuleIndex } from '../_components/AdminModuleIndex'

const SUBMODULES = [
  { href: '/admin/operations/orders', label: 'Crypto Orders', description: 'Broadcasts, swaps, receipt syncs, and order resolution.' },
  { href: '/admin/operations/settlements', label: 'Settlements', description: 'Deposit intents, payout requests, manual settlement controls.' },
  { href: '/admin/operations/events', label: 'Provider Events', description: 'Provider event review, failures, and requeue tools.' },
  { href: '/admin/operations/support', label: 'Support Tools', description: 'Webhook acceptance tests, ledger traces, reference support.' },
] as const

export default function AdminOperationsPage() {
  return <AdminModuleIndex title="Operations" description="Choose the operational module you want to work in." items={SUBMODULES} />
}
