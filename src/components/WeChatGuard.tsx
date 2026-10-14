import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Dialog } from '@base-ui/react/dialog'
import { ArrowUpRight, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { isWeChat, tryOpenInBrowser, weChatPlatform } from '../lib/browser'
import { useT } from '../lib/i18n'
import { buttonBase, buttonVariants, dialogButton } from './ui/buttonStyles'

/**
 * Asked once per tab session: stay in WeChat, or leave for the system browser.
 * Staying is remembered in `sessionStorage`, so a reload does not re-ask and a
 * new session does; iOS and the desktop client cannot be escaped from script
 * at all (see `lib/browser`), so the answer is always the menu path, drawn as
 * a picture of it: the ··· chip stands in for WeChat's own nav bar button, which
 * lives above the page and cannot be drawn by the page itself. The card is
 * bottom-anchored like the drawers, which puts it under the thumb on a phone
 * and follows how the app already places transient panels.
 */
const STAYED = 'collage:wechatStayed'

function stayedHere() {
  try {
    return sessionStorage.getItem(STAYED) === '1'
  }
  catch {
    return false
  }
}

export function WeChatGuard() {
  const t = useT()
  const [step, setStep] = useState<'ask' | 'guide' | null>(() => (isWeChat() && !stayedHere() ? 'ask' : null))
  const [copied, setCopied] = useState(false)

  /** Both answers end the question for this session. */
  const answered = () => {
    try {
      sessionStorage.setItem(STAYED, '1')
    }
    catch {
    }
  }

  const stay = () => {
    answered()
    setStep(null)
  }

  const toBrowser = () => {
    answered()
    tryOpenInBrowser()
    setStep('guide')
  }

  const copyLink = () => {
    void navigator.clipboard?.writeText(location.href).then(() => {
      setCopied(true)
      setTimeout(setCopied, 1600, false)
    })
  }

  const steps = [
    t('Tap ··· at the top right'),
    weChatPlatform() === 'ios' ? t('Choose “Open in Safari”') : t('Choose “Open in Browser”'),
  ]

  return (
    <>
      <AlertDialog.Root open={step === 'ask'}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
          <AlertDialog.Popup className="fixed left-1/2 top-1/2 flex w-[min(380px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98]">
            <AlertDialog.Title className="border-b border-line px-4 py-[11px] text-[13.5px] font-semibold">
              {t('WeChat browser detected')}
            </AlertDialog.Title>
            <AlertDialog.Description className="px-4 py-4 text-[12.5px] leading-[1.7] text-dim">
              {t('Saving an exported image may not work in the WeChat browser. Open koma in the system browser for the full editor, or continue here.')}
            </AlertDialog.Description>
            <div className="flex justify-end gap-[6px] border-t border-line px-3 py-2.5">
              <AlertDialog.Close className={`${dialogButton} border-line bg-transparent text-txt hover:bg-chip-hover`} onClick={stay}>
                {t('Continue anyway')}
              </AlertDialog.Close>
              <AlertDialog.Close className={`${dialogButton} border-accent bg-accent font-semibold text-on-accent hover:bg-accent hover:text-on-accent`} onClick={toBrowser}>
                {t('Open in browser')}
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <Dialog.Root
        open={step === 'guide'}
        onOpenChange={(o) => {
          if (!o)
            setStep(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-ending-style:opacity-0" />
          {/* The menu button lives in WeChat's own bar, above the page: this is
              a stand-in for it, and the arrow below points up at the real one. */}
          <div aria-hidden="true" className="pointer-events-none fixed right-2.5 top-2.5 flex flex-col items-center gap-1.5">
            <span className="grid h-[30px] w-[54px] place-items-center border border-line-strong bg-panel-2 pl-[0.12em] text-[15px] leading-none tracking-[0.12em] text-txt shadow-pop">···</span>
            <span className="text-accent"><MorphIcon icon={ArrowUpRight} size={15} strokeWidth={2} /></span>
          </div>
          <Dialog.Popup className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+14px)] left-1/2 flex w-[min(360px,calc(100vw-32px))] -translate-x-1/2 flex-col border border-line bg-panel text-txt shadow-pop outline-0 transition-[transform,opacity] duration-(--dur-dialog) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:translate-y-3 data-starting-style:opacity-0 data-ending-style:opacity-0">
            <header className="flex items-center justify-between gap-2.5 border-b border-line py-[11px] pl-4 pr-3">
              <Dialog.Title className="m-0 text-[13.5px] font-semibold">{t('Open in your browser')}</Dialog.Title>
              <Dialog.Close className={`${buttonBase} ${buttonVariants.close}`} aria-label={t('Close')}>
                <MorphIcon icon={X} size={15} strokeWidth={1.75} />
              </Dialog.Close>
            </header>
            <Dialog.Description className="px-4 pt-3.5 text-[12.5px] leading-[1.7] text-dim">
              {t('WeChat only opens this page in its own browser. From the menu at the top right:')}
            </Dialog.Description>
            <ol className="m-0 flex list-none flex-col gap-2 px-4 py-3.5">
              {steps.map((s, i) => (
                <li key={s} className="flex items-center gap-2.5 text-[12.5px] text-txt">
                  <span className="grid h-[18px] w-[18px] flex-none place-items-center bg-chip-strong text-[10.5px] font-semibold tabular-nums">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="m-0 border-t border-line px-4 py-3 text-[11.5px] leading-[1.6] text-faint">
              {t('Photos already imported stay in this browser.')}
            </p>
            <div className="flex justify-end gap-[6px] border-t border-line px-3 py-2.5">
              {typeof navigator.clipboard?.writeText === 'function' && (
                <button type="button" className={`${dialogButton} border-line bg-transparent text-txt hover:bg-chip-hover`} onClick={copyLink}>
                  {copied ? t('Link copied') : t('Copy link')}
                </button>
              )}
              <Dialog.Close className={`${dialogButton} border-line bg-transparent text-txt hover:bg-chip-hover`}>
                {t('Got it')}
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
