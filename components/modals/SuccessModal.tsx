'use client'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store'

export function SuccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { modalData } = useAppStore()
  const { headline = 'Done!', body = 'Transaction was successful.', ref = 'MFP-—' } = modalData as Record<string, string>

  return (
    <Modal open={open} onClose={onClose} title="Transaction Complete">
      <div className="p-9 text-center flex flex-col items-center gap-4">
        <div className="w-[72px] h-[72px] rounded-full bg-[rgba(46,170,92,.12)] border-2 border-[rgba(46,170,92,.3)] flex items-center justify-center text-[28px] animate-pop">✅</div>
        <div className="font-display font-black text-[24px] text-[var(--text)]">{headline}</div>
        <div className="text-[13px] text-[var(--text2)] leading-relaxed max-w-xs">{body}</div>
        <div className="bg-[var(--clay)] border border-[var(--border)] p-3 w-full text-left">
          <div className="text-[8px] text-[var(--muted)] uppercase tracking-[1px] mb-1">Transaction Reference</div>
          <div className="text-[11px] text-[var(--gold2)] font-mono">{ref}</div>
        </div>
        <Button onClick={onClose} className="w-full py-3">Done</Button>
      </div>
    </Modal>
  )
}
