import { useAppStore } from '@/store'

export function useModal() {
  const { activeModal, openModal, closeModal, modalData, setModalData } = useAppStore()

  return {
    activeModal,
    open: openModal,
    close: closeModal,
    data: modalData,
    setData: setModalData,
    isOpen: (id: string) => activeModal === id,
  }
}
