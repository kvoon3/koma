import { AlertDialog } from '@base-ui/react/alert-dialog'
import { useT } from '../lib/i18n'
import { dialogButton } from './ui/button'

/** Generic destructive-or-not confirm (clear library, open workspace file, …). */
export function ConfirmDialog({ open, title, description, confirmLabel, danger, onClose, onConfirm }: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 flex w-[min(360px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <AlertDialog.Title className="border-b border-line px-4 py-[11px] text-[13.5px] font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="px-4 py-4 text-[12.5px] leading-[1.7] text-dim">
            {description}
          </AlertDialog.Description>
          <div className="flex justify-end gap-[6px] border-t border-line px-3 py-2.5">
            <AlertDialog.Close className={`${dialogButton} border-line bg-transparent text-txt hover:bg-chip-hover`}>
              {t('Cancel')}
            </AlertDialog.Close>
            <AlertDialog.Close
              className={
                danger
                  ? `${dialogButton} border-danger bg-danger font-semibold text-on-accent hover:bg-danger hover:text-on-accent`
                  : `${dialogButton} border-accent bg-accent font-semibold text-on-accent hover:bg-accent hover:text-on-accent`
              }
              onClick={onConfirm}
            >
              {confirmLabel}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
