'use client'

import { useRouter } from 'next/navigation'
import type { FormEvent, ReactNode } from 'react'

/** GET filter form that stays inside the Next.js app instead of a full browser load. */
export function AdminGetForm({
  action,
  children,
}: {
  action: string
  children: ReactNode
}) {
  const router = useRouter()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    for (const [key, value] of data.entries()) {
      const text = String(value).trim()
      if (text) params.set(key, text)
    }
    const query = params.toString()
    router.push(query ? `${action}?${query}` : action)
  }

  return (
    <form action={action} onSubmit={onSubmit} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      {children}
    </form>
  )
}
