import { Toast } from '@base-ui/react/toast'

export const toastManager = Toast.createToastManager()

export function say(title: string, opts?: { timeout?: number }) {
  return toastManager.add({ title, timeout: opts?.timeout ?? 2400 })
}
