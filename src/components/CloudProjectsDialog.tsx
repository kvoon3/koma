import type { CloudOpenState } from '../lib/cloudOpenFlow'
import { Dialog } from '@base-ui/react/dialog'
import { CloudDownload } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { useT } from '../lib/i18n'
import { Button } from './ui/button'
import { dialogButton } from './ui/buttonStyles'
import { Spinner } from './ui/spinner'

export function CloudProjectsDialog({ open, onOpenChange, state, onRetry, onOpen }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: CloudOpenState
  onRetry: () => void
  onOpen: (id: string) => Promise<boolean>
}) {
  const t = useT()
  const [busyId, setBusyId] = useState<string | null>(null)

  const pick = async (id: string) => {
    setBusyId(id)
    const opened = await onOpen(id)
    setBusyId(null)
    if (opened)
      onOpenChange(false)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed z-(--z-modal) inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup
          data-cloud-open=""
          className="fixed z-(--z-modal) left-1/2 top-1/2 flex max-h-[min(74dvh,560px)] w-[min(420px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]"
        >
          <Dialog.Title className="border-b border-line px-4 py-[11px] text-[13.5px] font-semibold">
            {t('Cloud sessions')}
          </Dialog.Title>
          <div className="min-h-0 flex-1 overflow-y-auto p-2" data-cloud-list="">
            {state.phase === 'loading' && (
              <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-dim" role="status">
                <Spinner size={13} className="flex text-dim" />
                {t('Loading…')}
              </p>
            )}
            {state.phase === 'error' && (
              <div className="flex flex-col items-start gap-2 px-2 py-3">
                <p role="alert" className="text-[12px] text-danger">{state.message}</p>
                <Button variant="on" onClick={onRetry}>{t('Retry')}</Button>
              </div>
            )}
            {state.phase === 'ready' && state.projects.length === 0 && (
              <p className="px-2 py-3 text-[12px] text-dim">{t('No cloud sessions yet.')}</p>
            )}
            {state.phase === 'ready' && state.projects.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {state.projects.map(project => (
                  <li key={project.id} className="flex items-center gap-2" data-cloud-project="">
                    <div className="min-w-0 flex-1 px-1">
                      <p className="m-0 truncate text-[12.5px] text-txt">{project.name}</p>
                      <p className="m-0 text-[10.5px] text-dim">{project.updatedAt}</p>
                    </div>
                    <Button
                      variant="on"
                      data-cloud-load=""
                      loading={busyId === project.id}
                      disabled={busyId !== null}
                      onClick={() => void pick(project.id)}
                    >
                      <MorphIcon icon={CloudDownload} size={13} strokeWidth={1.75} className="flex" />
                      {t('Load')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end border-t border-line px-3 py-2.5">
            <Dialog.Close className={`${dialogButton} border-line bg-transparent text-txt hover:bg-chip-hover`}>
              {t('Close')}
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
