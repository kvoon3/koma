import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { Button, buttonBase, buttonVariants } from '@/components/ui/button'
import { downloadBlob } from '../lib/exporter'
import { say } from '../lib/toast'

export function CropDialog({ report, onClose }: { report: string | null, onClose: () => void }) {
  return (
    <Dialog.Root
      open={report != null}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-150 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-auto flex max-h-[min(86dvh,720px)] w-[min(820px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-none border border-line bg-panel shadow-pop outline-0 transition-[opacity,translate,scale] duration-150 ease-out data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
          <header className="flex items-center justify-between gap-2.5 border-b border-line py-[11px] pl-4 pr-3">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">Per-pane crop parameters</Dialog.Title>
            <div className="flex gap-[5px]">
              <Button
                onClick={() => navigator.clipboard?.writeText(report ?? '').then(() => say('Copied'))}
              >
                Copy
              </Button>
              <Button
                onClick={() => report != null && downloadBlob(new Blob([report], { type: 'text/plain' }), 'crop.sh')}
              >
                Download crop.sh
              </Button>
              <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label="Close"><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Dialog.Close>
            </div>
          </header>
          <textarea className="min-h-[360px] flex-1 resize-none border-0 bg-code-bg p-[13px] text-[11.5px] leading-[1.65] whitespace-pre text-code-txt outline-0 select-text font-mono" readOnly value={report ?? ''} spellCheck={false} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
