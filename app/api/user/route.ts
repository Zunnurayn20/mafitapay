import { NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/server/auth'
import { sanitizeUser, updateUserProfile } from '@/lib/server/data'

export async function GET() {
  const user = await requireUser()
  if (!user) return unauthorized()

  return NextResponse.json({ data: sanitizeUser(user), success: true })
}

export async function PATCH(req: Request) {
  const user = await requireUser()
  if (!user) return unauthorized()

  const updates = await req.json()
  const updated = await updateUserProfile(user.id, {
    name: typeof updates.name === 'string' ? updates.name : undefined,
    phone: typeof updates.phone === 'string' ? updates.phone : undefined,
  })

  if (!updated) return unauthorized()

  return NextResponse.json({ data: sanitizeUser(updated), success: true })
}
