import { Toast } from '@base-ui/react/toast'
import { toastManager } from '../lib/toast'
import './toast.css'

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map(toast => (
    <Toast.Root key={toast.id} toast={toast} className="bui-toast-root">
      <Toast.Content className="bui-toast-content">
        <div className="bui-toast-text">
          <Toast.Title className="bui-toast-title" />
          {toast.description != null ? <Toast.Description className="bui-toast-desc" /> : null}
        </div>
        <Toast.Close className="bui-toast-close" aria-label="Dismiss">×</Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ))
}

export default function ToastHost() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Portal>
        <Toast.Viewport className="bui-toast-viewport">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}
