import { AlertDialog } from '@base-ui/react/alert-dialog'
import { useT } from '../lib/i18n'

// Both footer buttons share the same metrics; only the palette differs.
// Written out explicitly instead of reusing the Button component: its
// `hover:not-disabled:bg-chip-hover` has higher specificity than a danger
// override would, and Clear all must stay red on hover.
const btnBase = 'inline-flex cursor-pointer items-center rounded-none border px-3 py-[6px] text-[11.5px] transition-colors duration-[120ms] focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1 pointer-coarse:px-3.5 pointer-coarse:py-[7px] pointer-coarse:text-xs'

export function ClearConfirm({ open, onClose, onConfirm }: { open: boolean, onClose: () => void, onConfirm: () => void }) {
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
        <AlertDialog.Backdrop className="fixed inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-[120ms] data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 flex w-[min(360px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-[120ms] data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <AlertDialog.Title className="border-b border-line px-4 py-[11px] text-[13.5px] font-semibold">
            {t('Clear library?')}
          </AlertDialog.Title>
          <AlertDialog.Description className="px-4 py-4 text-[12.5px] leading-[1.7] text-dim">
            {t('This removes all imported photos and resets all 9 workspaces to blank canvases. This cannot be undone.')}
          </AlertDialog.Description>
          <div className="flex justify-end gap-[6px] border-t border-line px-3 py-2.5">
            <AlertDialog.Close className={`${btnBase} border-line bg-transparent text-txt hover:bg-chip-hover`}>
              {t('Cancel')}
            </AlertDialog.Close>
            <AlertDialog.Close
              className={`${btnBase} border-danger bg-danger font-semibold text-on-accent hover:bg-danger hover:text-on-accent`}
              onClick={onConfirm}
            >
              {t('Clear all')}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
