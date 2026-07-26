'use client'
import { useAppStore } from '@/store'
import { SendModal } from './SendModal'
import { DepositModal } from './DepositModal'
import { WithdrawModal } from './WithdrawModal'
import { BuyModal } from './BuyModal'
import { SellModal } from './SellModal'
import { BillsModal } from './BillsModal'
import { SuccessModal } from './SuccessModal'

export function ModalManager() {
  const { activeModal, closeModal } = useAppStore()
  const isOpen = (id: string) => activeModal === id

  return (
    <>
      <SendModal    open={isOpen('send')}    onClose={closeModal} />
      <DepositModal open={isOpen('deposit')} onClose={closeModal} />
      <WithdrawModal open={isOpen('withdraw')} onClose={closeModal} />
      <BuyModal     open={isOpen('buy')}     onClose={closeModal} />
      <SellModal    open={isOpen('sell')}    onClose={closeModal} />
      <BillsModal   open={isOpen('bills')}   onClose={closeModal} />
      <SuccessModal open={isOpen('success')} onClose={closeModal} />
    </>
  )
}
