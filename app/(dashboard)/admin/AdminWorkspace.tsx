'use client'
import { Card } from '@/components/ui/Card'
import { AdminCatalogsSection } from './_components/AdminCatalogsSection'
import { AdminHealthSection } from './_components/AdminHealthSection'
import { AdminOperationsSection } from './_components/AdminOperationsSection'
import { AdminUsersSection } from './_components/AdminUsersSection'
import { AdminCryptoTabs, type AdminCryptoTab } from './_components/AdminCryptoTabs'
import { type AdminSection, type AdminSubmodule } from './admin-config'
import { useAdminWorkspace } from './useAdminWorkspace'

export { ADMIN_SECTIONS } from './admin-config'

export function AdminWorkspace({ section, submodule }: { section: AdminSection; submodule?: AdminSubmodule }) {
  const workspace = useAdminWorkspace(section, submodule)
  const cryptoTab: AdminCryptoTab | null = submodule === 'orders'
    ? 'orders'
    : submodule === 'crypto-deposits'
      ? 'deposits'
      : section === 'catalogs' && submodule === 'assets'
        ? 'assets'
        : null

  if (workspace.loading) {
    return <Card className="p-6 text-[12px] text-[var(--muted)]">Loading admin catalogs…</Card>
  }

  if (!workspace.authorized) {
    return <Card className="p-6 text-[12px] text-[var(--muted)]">Admin access is restricted for {workspace.user?.email ?? 'this account'}.</Card>
  }

  return (
    <div className="space-y-6">
      {cryptoTab && <AdminCryptoTabs activeTab={cryptoTab} />}
      {section === 'users' && (
        <AdminUsersSection workspace={workspace} submodule={submodule} />
      )}

      {section === 'operations' && (
        <AdminOperationsSection workspace={workspace} submodule={submodule} />
      )}

      {section === 'health' && (
        <AdminHealthSection workspace={workspace} submodule={submodule} />
      )}

      {section === 'catalogs' && (
        <AdminCatalogsSection workspace={workspace} submodule={submodule} />
      )}

    </div>
  )
}
