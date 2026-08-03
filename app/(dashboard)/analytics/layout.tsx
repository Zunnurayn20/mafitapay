import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/layout/AdminShell'
import { isAdminEmail } from '@/lib/admin-access'
import { getCurrentUser } from '@/lib/server/auth'

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isAdminEmail(user.email) && !user.isAdmin) redirect('/dashboard')

  return (
    <AdminShell
      email={user.email}
      name={user.name}
      isAdmin={Boolean(user.isAdmin || isAdminEmail(user.email))}
    >
      {children}
    </AdminShell>
  )
}
