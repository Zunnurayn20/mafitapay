import { AdminModuleIndex } from '../_components/AdminModuleIndex'

const SUBMODULES = [
  { href: '/admin/operations/orders', label: 'Crypto Orders', description: 'Broadcast crypto deliveries, run swap routes, sync onchain receipts, inspect execution rails, and resolve stuck buy or sell orders.' },
  { href: '/admin/operations/settlements', label: 'Settlements', description: 'Review deposit intents and payout requests with provider references, retry counts, gross/net amounts, manual success/failure actions, and case inspection.' },
  { href: '/admin/operations/events', label: 'Provider Events', description: 'Inspect webhook/provider events, failed callbacks, retry queues, external event IDs, processing timestamps, and requeue actions.' },
  { href: '/admin/operations/support', label: 'Support Tools', description: 'Run webhook acceptance tests, inspect transaction ledger traces, open a full reference case, and compare linked transaction/provider/audit records.' },
] as const

export default function AdminOperationsPage() {
  return <AdminModuleIndex title="Operations" description="Choose the operational module you want to work in." items={SUBMODULES} />
}
