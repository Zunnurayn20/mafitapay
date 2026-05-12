'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store'
export default function Page() {
  const { openModal } = useAppStore()
  const router = useRouter()
  useEffect(() => { openModal('deposit'); router.replace('/dashboard') }, [openModal, router])
  return null
}
