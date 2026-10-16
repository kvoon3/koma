import { Popover } from '@base-ui/react/popover'
import { Switch } from '@base-ui/react/switch'
import { Settings } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { fieldLabelCls, fieldRowCls } from '@/components/ui/field'
import { Tip } from '@/components/ui/tip'
import { mirrorEnabled, setMirrorEnabled } from '../lib/fonts'
import { useT } from '../lib/i18n'
import { say } from '../lib/toast'

const toggle = 'group/switch relative box-border col-start-2 row-start-1 inline-flex h-5 w-[34px] cursor-pointer items-center justify-self-end rounded-none border border-line-strong bg-line-strong p-0 transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] pointer-coarse:h-6 data-checked:border-accent data-checked:bg-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 sm:col-start-3'
const toggleThumb = 'block m-0.5 h-3.5 w-3.5 rounded-none border border-line-strong bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-(--dur-fast) group-data-checked/switch:translate-x-3.5'

/**
 * Settings keeps text/font mirror only. Appearance (gap, blend, etc.) lives
 * in the bottom Tools dock via AppearanceDockTools.
 */
const popup = 'flex max-h-[min(70dvh,520px)] w-[min(320px,calc(100vw-20px))] max-sm:w-[calc(100vw-12px)] flex-col overflow-hidden rounded-none border border-line-strong bg-panel text-txt shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-(--dur-surface) ease-(--ease-out) data-ending-style:duration-(--dur-fast) data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]'

export function SettingsPanel({ open, onOpenChange, onTriggerEnter }: { open: boolean, onOpenChange: (open: boolean) => void, onTriggerEnter?: () => void }) {
  const t = useT()
  const [mirror, setMirror] = useState(() => mirrorEnabled())

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Tip
        label={t('Settings · Shortcut: ,')}
        trigger={(
          <Popover.Trigger
            onMouseEnter={onTriggerEnter}
            render={(
              <Button variant={open ? 'on' : 'flat'} aria-label={t('Settings · Shortcut: ,')} data-bar-trigger="settings">
                <MorphIcon icon={Settings} size={15} strokeWidth={1.75} />
                <span className="pointer-coarse:hidden max-sm:hidden">{t('Settings')}</span>
              </Button>
            )}
          />
        )}
      />
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={6}
          className="z-[260] select-none outline-0"
        >
          <Popover.Popup className={popup}>
            <header className="flex flex-none items-center gap-2.5 py-1.5 pr-2.5 pl-3.5">
              <Popover.Title className="m-0 text-[12.5px] font-bold">{t('Settings')}</Popover.Title>
              <span className="flex-1" />
              <Button
                aria-label={t('Reset settings')}
                title={t('Reset settings')}
                onClick={() => {
                  setMirror(true)
                  setMirrorEnabled(true)
                  say(t('Settings reset'))
                }}
              >
                {t('Reset')}
              </Button>
            </header>
            <div className="px-3.5 pt-2 pb-3.5">
              <div className={fieldRowCls}>
                <span className={fieldLabelCls}>{t('Font mirror')}</span>
                <Switch.Root
                  className={toggle}
                  aria-label={t('Font mirror')}
                  checked={mirror}
                  onCheckedChange={(checked) => {
                    setMirror(checked)
                    setMirrorEnabled(checked)
                  }}
                >
                  <Switch.Thumb className={toggleThumb} />
                </Switch.Root>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
