import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { downloadBlob } from '../lib/exporter'
import { say } from '../lib/toast'
import './cropdialog.css'

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
        <Dialog.Backdrop className="bui-crop-backdrop" />
        <Dialog.Popup className="bui-crop-popup">
          <header className="bui-crop-head">
            <Dialog.Title className="bui-crop-title">Per-pane crop parameters</Dialog.Title>
            <div className="bui-crop-actions">
              <button
                className="flat"
                onClick={() => navigator.clipboard?.writeText(report ?? '').then(() => say('Copied'))}
              >
                Copy
              </button>
              <button
                className="flat"
                onClick={() => report != null && downloadBlob(new Blob([report], { type: 'text/plain' }), 'crop.sh')}
              >
                Download crop.sh
              </button>
              <Dialog.Close className="flat bui-drawer-close" aria-label="Close"><MorphIcon icon={X} size={15} strokeWidth={1.75} /></Dialog.Close>
            </div>
          </header>
          <textarea className="bui-crop-text" readOnly value={report ?? ''} spellCheck={false} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
