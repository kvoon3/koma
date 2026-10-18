import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { Button } from './button'
import { buttonBase, buttonVariants } from './buttonStyles'

/**
 * The one text prompt the library surfaces need: a name for a new entry or for
 * a rename, a sticker folder and a photo tag alike. It validates through the
 * caller's `onSubmit` (the pure rules in `lib/stickerLibrary` / `lib/photoTags`),
 * so a duplicate or a blank name reads the same here as it does in the store.
 *
 * `field` names the test / measurement hooks on the field and its actions
 * (`data-folder-input` for a folder, `data-tag-input` for a tag): one dialog,
 * two surfaces, each still addressable on its own.
 */
export function NamePrompt({ open, title, initial, confirmLabel, error, field, placeholder, maxLength, onSubmit, onClose }: {
  open: boolean
  title: string
  initial: string
  confirmLabel: string
  /** Why the last submit was refused, from the caller's own name rules. */
  error: string | null
  /** Which surface's hooks this prompt wears. */
  field: 'folder' | 'tag'
  placeholder: string
  maxLength: number
  /** Return false to keep the dialog open (the caller's rule refused the name). */
  onSubmit: (name: string) => boolean
  onClose: () => void
}) {
  const t = useT()
  // The caller remounts this dialog per opening (`key`), so the field starts
  // from the name it was opened with: a rename prefills, a create is blank.
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (!onSubmit(value))
      return
    onClose()
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o)
          onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed z-(--z-modal) inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup
          initialFocus={inputRef}
          className="fixed z-(--z-modal) left-1/2 top-1/2 flex w-[min(360px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]"
        >
          <header className="flex items-center justify-between gap-2.5 border-b border-line py-2 pl-4 pr-2">
            <Dialog.Title className="m-0 text-[13.5px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Cancel')}>
              <MorphIcon icon={X} size={15} strokeWidth={1.75} />
            </Dialog.Close>
          </header>
          <div className="flex flex-col gap-1.5 px-4 py-4">
            <input
              ref={inputRef}
              className="box-border h-[30px] w-full border border-line-strong bg-panel-2 px-2.5 text-[12.5px] text-txt outline-0 focus-visible:border-accent"
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              aria-label={placeholder}
              {...{ [`data-${field}-input`]: '' }}
              onChange={e => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter')
                  return
                e.preventDefault()
                submit()
              }}
            />
            {/* Fixed line: the dialog must not resize as the hint comes and goes. */}
            <p className={`m-0 min-h-[1.4em] text-[11px] leading-[1.4] ${error ? 'text-danger' : 'text-faint'}`} {...{ [`data-${field}-error`]: '' }}>
              {error ?? t('Letters, numbers and emoji all work.')}
            </p>
          </div>
          <div className="flex justify-end gap-[6px] border-t border-line px-3 py-2.5">
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="strong" onClick={submit} {...{ [`data-${field}-submit`]: '' }}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
