import { AdminModuleIndex } from '../_components/AdminModuleIndex'

const SUBMODULES = [
  { href: '/admin/users/kyc', label: 'KYC Queue', description: 'Review submitted KYC records and approve or reject them.' },
  { href: '/admin/users/accounts', label: 'Accounts', description: 'Activate or deactivate user access.' },
  { href: '/admin/users/audit', label: 'Audit Trail', description: 'Inspect recent admin and system audit activity.' },
] as const

export default function AdminUsersPage() {
  return <AdminModuleIndex title="Users" description="Choose the user administration area you need." items={SUBMODULES} />
}
