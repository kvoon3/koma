import { Toast } from '@base-ui/react/toast'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useT } from '../lib/i18n'
import { toastManager } from '../lib/toast'

function ToastList() {
  const { toasts } = Toast.useToastManager()
  const t = useT()
  return toasts.map(toast => (
    <Toast.Root key={toast.id} toast={toast} className="absolute bottom-0 right-0 box-border z-[calc(1000-var(--toast-index))] w-full select-none origin-bottom-right border border-line bg-panel-2 px-3 py-2 text-xs text-txt shadow-pop [--gap:8px] [--peek:8px] [--scale:calc(max(0,1-(var(--toast-index)*0.08)))] [--shrink:calc(1-var(--scale))] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] h-[var(--height)] translate-x-[var(--toast-swipe-movement-x)] translate-y-[calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height)))] scale-[var(--scale)] transition-[transform,opacity,height] duration-(--dur-surface) data-expanded:h-[var(--toast-height)] data-expanded:translate-y-[var(--offset-y)] data-starting-style:opacity-0 data-starting-style:translate-x-10 data-ending-style:opacity-0 data-ending-style:h-0 data-ending-style:translate-x-10 data-limited:opacity-0 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1">
      <Toast.Content className="box-border flex items-start gap-2 overflow-hidden transition-opacity duration-(--dur-surface) data-behind:opacity-0 data-expanded:opacity-100">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Toast.Title className="m-0 text-xs leading-[1.4] font-medium text-txt" />
          {toast.description != null ? <Toast.Description className="m-0 text-xs leading-[1.4] text-dim" /> : null}
        </div>
        <Toast.Close className="ml-auto flex h-4 w-4 flex-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-sm leading-none text-dim transition-colors duration-(--dur-fast) active:scale-[0.97] hover:text-txt focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1" aria-label={t('Dismiss')}><MorphIcon icon={X} size={13} strokeWidth={1.75} /></Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ))
}

/**
 * The toast surface: mounts the shared `toastManager` and renders its stack in
 * the bottom-right corner, above the status bar. Every confirmation the app
 * speaks through `say` lands here (a save, a reset, an export failure), so the
 * stack's place, width and dismissal stay one component.
 */
export default function ToastHost() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Portal>
        <Toast.Viewport className="fixed right-2.5 bottom-[calc(var(--statusH,31px)+env(safe-area-inset-bottom,0px)+10px)] z-60 w-[min(340px,calc(100vw-20px))] rounded-none outline-0">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}
