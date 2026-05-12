import { redirect } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { getCurrentUser } from '@/lib/server/auth'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  return <DashboardLayout>{children}</DashboardLayout>
}
