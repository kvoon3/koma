import type { IconNode } from 'lucide'
import type { FontMeta } from '../lib/fonts'
import type { PaneLabel } from '../lib/panes'
import { Select } from '@base-ui/react/select'
import { Ban, Check, ChevronDown, Contrast, RefreshCw, RotateCcw, Smile, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AppSlider, ColorField, fieldControlCls, fieldLabelCls, fieldRowCls, RangeField } from '@/components/ui/field'
import { ensureFonts, FONT_CATALOG, fontById } from '../lib/fonts'
import { useT } from '../lib/i18n'
import { LABEL_ICON_EM, LABEL_ICON_GAP_EM, LABEL_ICONS, labelIconNode } from '../lib/labelIcons'
import { labelBgAlpha, labelPaint, nextLabelTheme, rotationCss, rotationOf, snapRotation } from '../lib/panes'
import { useStore } from '../store'

/** A label icon drawn inline at the label's font size, in its text color. */
export function LabelIconGlyph({ node, size = `${LABEL_ICON_EM}em` }: { node: IconNode, size?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      {node.map(([tag, attrs], i) => {
        const Tag = tag as 'path'
        // eslint-disable-next-line react/no-array-index-key -- icon nodes are static and never reorder
        return <Tag key={i} {...(attrs as React.SVGProps<SVGPathElement>)} />
      })}
    </svg>
  )
}

const ICON_NONE = '__none'
const LABEL_ICON_ITEMS = [
  { value: ICON_NONE, label: 'No icon' },
  ...LABEL_ICONS.map(i => ({ value: i.id, label: i.label })),
]

const colorInputCls = 'h-[22px] w-[22px] cursor-pointer rounded-none border border-float-line bg-float-bg-2 p-[2px] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-none [&::-webkit-color-swatch]:border-0'

const LABEL_FONT_ITEMS = [
  { value: '', label: 'System', cat: 'system' as FontMeta['cat'] },
  ...FONT_CATALOG.map(f => ({ value: f.id, label: f.label, cat: f.cat })),
]

const FONT_CATS: { id: FontMeta['cat'], label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'cjk', label: 'CJK' },
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'hand', label: 'Handwriting' },
  { id: 'mono', label: 'Mono' },
]

// Loads a Google font for the preview and bumps a counter once a web font finishes
// loading, so the label re-renders with the real metrics.
function useFontReady(font: string): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (fontById(font).gfFamily)
      void ensureFonts([font])
    const onDone = () => setTick(t => t + 1)
    document.fonts.addEventListener('loadingdone', onDone)
    return () => document.fonts.removeEventListener('loadingdone', onDone)
  }, [font])
  return tick
}

/**
 * The rotate handle stickers and labels share: a curved double arrow at the
 * box's bottom-left, the mirror of the resize corner at the bottom-right.
 * Dragging orbits the pointer around the box center, so the box follows the
 * cursor one-to-one; a held Shift snaps to 15°. The center is measured once
 * per gesture: the box turns under the pointer, but its center never moves.
 */
export function RotationHandle({ rot, shown, onChange }: {
  rot: number
  shown: boolean
  onChange: (rot: number) => void
}) {
  const t = useT()
  const gestureRef = useRef<{ cx: number, cy: number, a0: number, r0: number } | null>(null)

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0)
      return
    e.stopPropagation()
    const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
    if (!box)
      return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    gestureRef.current = {
      cx,
      cy,
      a0: Math.atan2(e.clientY - cy, e.clientX - cx),
      r0: rot,
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g)
      return
    e.stopPropagation()
    const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx)
    onChange(snapRotation(g.r0 + (a - g.a0), e.shiftKey))
  }
  const endGesture = () => {
    gestureRef.current = null
  }

  return (
    <span
      className={`absolute -bottom-2 -left-2 grid h-[15px] w-[15px] cursor-crosshair place-items-center rounded-none border-2 border-float-bg-2 bg-accent text-on-accent opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-opacity duration-(--dur-fast) ${shown ? ' opacity-100' : ''}`}
      title={t('Drag to rotate · hold Shift to snap to 15°')}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <MorphIcon icon={RefreshCw} size={10} strokeWidth={2.5} />
    </span>
  )
}

/**
 * The reset-angle chip stickers and labels share: a bottom-center button that
 * only exists while the box is actually turned, so there is always a one-click
 * way back to 0° without hunting the exact drag. `flip` puts it above a label
 * whose toolbar already takes the space below.
 */
export function ResetRotationButton({ shown, flip, onReset }: {
  shown: boolean
  flip?: boolean
  onReset: () => void
}) {
  const t = useT()
  return (
    <button
      className={`absolute left-1/2 z-[3] grid h-[22px] w-[22px] -translate-x-1/2 cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg p-0 text-float-icon backdrop-blur-[7px] transition-[opacity,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt ${
        flip ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
      } ${shown ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      title={t('Reset rotation')}
      aria-label={t('Reset rotation')}
      onPointerDown={e => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onReset()
      }}
    >
      <MorphIcon icon={RotateCcw} size={13} strokeWidth={2} />
    </button>
  )
}

function LabelEditor({ text, onDone }: { text: string, onDone: (text: string) => void }) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const t = useT()

  // the editor only exists while editing, so focus and select all on mount
  useEffect(() => {
    const el = editorRef.current
    if (!el)
      return
    el.focus()
    const sel = window.getSelection()
    if (!sel)
      return
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [])

  const finish = (e: React.FocusEvent<HTMLDivElement>) => {
    onDone((e.currentTarget.textContent ?? '').replace(/\s+/g, ' ').trim())
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing)
      return
    if (e.key !== 'Enter' && e.key !== 'Escape')
      return
    // keep Esc/Enter from reaching the global handler (Esc would deselect)
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    if (e.key === 'Enter')
      e.preventDefault()
    el.blur()
  }

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-label={t('Edit text label')}
      contentEditable
      suppressContentEditableWarning
      onBlur={finish}
      onKeyDown={onKeyDown}
    >
      {text}
    </div>
  )
}

/**
 * The label's move/resize gesture and its hover intent, split out of LabelView
 * so the component reads as its own markup. The gesture state stays local to
 * the label: a press starts a move, the corner handle a resize, and the hover
 * timeout keeps the chrome alive while the pointer crosses the gap to it.
 */
function useLabelGesture({
  labelId,
  lab,
  editing,
  elRef,
  onFocus,
  setLabel,
  selectLabel,
}: {
  labelId: string
  lab: PaneLabel
  editing: boolean
  elRef: React.RefObject<HTMLElement | null>
  onFocus: (id: string) => void
  setLabel: (id: string, patch: Partial<PaneLabel>) => void
  selectLabel: (id: string | null) => void
}) {
  // hover intent: keep the toolbar alive while the pointer crosses the gap to it
  const [hot, setHot] = useState(false)
  const leaveRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (leaveRef.current != null)
      window.clearTimeout(leaveRef.current)
  }, [])
  const gestureRef = useRef<{
    mode: 'move' | 'resize'
    cx: number
    cy: number
    d0: number
    s0: number
  } | null>(null)

  const onBoxDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    // A right-click on the label must not steal focus: the swap item in the
    // pane's context menu targets the focused pane, so the pane must stay
    // unfocused for it to appear.
    if (editing || e.button !== 0)
      return
    onFocus(labelId)
    selectLabel(labelId)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gestureRef.current = { mode: 'move', cx: 0, cy: 0, d0: 0, s0: lab.size }
  }
  const onBoxMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'move')
      return
    e.stopPropagation()
    const r = elRef.current?.getBoundingClientRect()
    if (!r)
      return
    setLabel(labelId, {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    })
  }

  const onSizeDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    const r = elRef.current?.getBoundingClientRect()
    if (!r)
      return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const cx = r.left + lab.x * r.width
    const cy = r.top + lab.y * r.height
    gestureRef.current = {
      mode: 'resize',
      cx,
      cy,
      d0: Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy)),
      s0: lab.size,
    }
  }
  const onSizeMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'resize')
      return
    e.stopPropagation()
    const dist = Math.hypot(e.clientX - g.cx, e.clientY - g.cy)
    setLabel(labelId, { size: g.s0 * (dist / g.d0) })
  }

  const endGesture = () => {
    gestureRef.current = null
  }

  const onPointerEnter = () => {
    if (leaveRef.current != null) {
      window.clearTimeout(leaveRef.current)
      leaveRef.current = null
    }
    setHot(true)
  }
  const onPointerLeave = () => {
    if (leaveRef.current != null)
      window.clearTimeout(leaveRef.current)
    leaveRef.current = window.setTimeout(() => {
      leaveRef.current = null
      setHot(false)
    }, 220)
  }

  return { hot, onBoxDown, onBoxMove, onSizeDown, onSizeMove, endGesture, onPointerEnter, onPointerLeave }
}

/**
 * The handles a selected label grows: the resize corner, the rotate handle,
 * the reset-angle chip and the remove button. They exist only while the label
 * is not being edited, and each reads `hot || selected` for its visibility.
 */
function LabelChrome({
  editing,
  labelId,
  lab,
  rot,
  hot,
  selected,
  setLabel,
  onRemove,
  onSizeDown,
  onSizeMove,
  endGesture,
}: {
  editing: boolean
  labelId: string
  lab: PaneLabel
  rot: number
  hot: boolean
  selected: boolean
  setLabel: (id: string, patch: Partial<PaneLabel>) => void
  onRemove: () => void
  onSizeDown: (e: React.PointerEvent) => void
  onSizeMove: (e: React.PointerEvent) => void
  endGesture: () => void
}) {
  const t = useT()
  const shown = !editing && (hot || selected)
  const hover = editing ? '' : 'group-hover/label:opacity-100'
  return (
    <div inert={editing} className="contents">
      <span
        className={`${hover} absolute -right-2 -bottom-2 h-[15px] w-[15px] cursor-nwse-resize rounded-none border-2 border-float-bg-2 bg-accent opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-opacity duration-(--dur-fast) ${shown ? ' opacity-100' : ''}`}
        title={t('Drag to resize')}
        onPointerDown={onSizeDown}
        onPointerMove={onSizeMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
      <RotationHandle
        rot={rot}
        shown={shown}
        onChange={value => setLabel(labelId, { rot: value })}
      />
      <ResetRotationButton
        shown={rot !== 0 && shown}
        // The toolbar already takes the space under a label parked near the
        // pane's top (see `lab.y < 0.3` below), so the chip moves up instead.
        flip={lab.y < 0.3}
        onReset={() => setLabel(labelId, { rot: 0 })}
      />
      <button
        className={`${hover} absolute -top-[9px] -right-[9px] grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-none border border-float-bg-2 bg-danger p-0 text-on-accent opacity-0 transition-[opacity,scale] duration-(--dur-fast) active:scale-[0.97] ${shown ? ' opacity-100' : ''}`}
        title={t('Remove label')}
        onPointerDown={e => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        <MorphIcon icon={X} size={12} strokeWidth={2} />
      </button>
    </div>
  )
}

/**
 * The label's font/hue toolbar, pinned above or below the label and
 * counter-rotated so it stays upright however the label is turned. Stays in
 * the tree even when hidden so its popup keeps its anchor.
 */
function LabelToolbar({
  labelId,
  lab,
  rot,
  editing,
  hot,
  selected,
  setLabel,
  selectLabel,
}: {
  labelId: string
  lab: PaneLabel
  rot: number
  editing: boolean
  hot: boolean
  selected: boolean
  setLabel: (id: string, patch: Partial<PaneLabel>) => void
  selectLabel: (id: string | null) => void
}) {
  return (
    <div
      className={`absolute left-1/2 z-[4] flex gap-[3px] rounded-none max-lg:hidden border border-float-line bg-float-bg p-[3px] backdrop-blur-[7px] transition-opacity duration-(--dur-fast) ${
        lab.y < 0.3 ? 'bottom-auto top-[calc(100%+10px)]' : 'bottom-[calc(100%+10px)]'
      } ${
        // Mutually exclusive classes: a base `pointer-events-none` plus a
        // conditional `pointer-events-auto` would both stay in the class
        // list and `none` wins in Tailwind's output order, silently killing
        // clicks on a pinned toolbar.
        editing || hot || selected
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0'
      }`}
      style={{
        // Counter-rotate about the edge that faces the label, so the
        // toolbar stays upright and pinned no matter how the label is turned.
        transform: `translateX(-50%) rotate(${-rot}rad)`,
        transformOrigin: lab.y < 0.3 ? '50% 0%' : '50% 100%',
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        selectLabel(labelId)
      }}
    >
      <LabelControls labelId={labelId} lab={lab} setLabel={setLabel} selectLabel={selectLabel} />
    </div>
  )
}

const sectionCls = 'flex min-w-0 flex-col gap-[7px]'
const headingCls = 'm-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-faint'
const panelBodyCls = 'grid min-w-0 content-start gap-y-3.5 px-3.5 pt-3 pb-3'

interface LabelControlProps {
  labelId: string
  lab: PaneLabel
  setLabel: (id: string, patch: Partial<PaneLabel>) => void
  selectLabel: (id: string | null) => void
}

function LabelFontSelect({ labelId, lab, setLabel, selectLabel, triggerClassName }: LabelControlProps & { triggerClassName: string }) {
  const t = useT()
  return (
    <Select.Root
      items={LABEL_FONT_ITEMS}
      value={lab.font}
      onValueChange={value => setLabel(labelId, { font: String(value) })}
      onOpenChange={(open) => {
        // Keep the toolbar pinned while the font popup is open, also when
        // the list was opened from the keyboard instead of a click.
        if (open)
          selectLabel(labelId)
      }}
    >
      <Select.Trigger className={triggerClassName} title={t('Label font')} aria-label={t('Label font')}>
        <Select.Value />
        <Select.Icon className="flex flex-none text-dim">
          <MorphIcon icon={ChevronDown} size={12} strokeWidth={1.75} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="z-[260] select-none outline-0"
          sideOffset={4}
          align="start"
          alignItemWithTrigger={false}
        >
          <Select.Popup className="box-border min-w-[var(--anchor-width)] rounded-none border border-line bg-panel py-1 text-txt outline-0 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
            <Select.List className="relative max-h-[var(--available-height)] overflow-y-auto">
              {FONT_CATS.map((cat) => {
                const items = LABEL_FONT_ITEMS.filter(i => i.cat === cat.id)
                if (!items.length)
                  return null
                return (
                  <Select.Group key={cat.id}>
                    <Select.GroupLabel className="px-2.5 pt-[5px] pb-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-faint">{t(cat.label)}</Select.GroupLabel>
                    {items.map(item => (
                      <Select.Item
                        key={item.value || 'system'}
                        value={item.value}
                        className="flex cursor-default select-none items-center gap-2 px-2.5 py-[5px] text-[13px] outline-0 data-highlighted:bg-accent data-highlighted:text-on-accent"
                        style={{ fontFamily: fontById(item.value).cssStack }}
                      >
                        <Select.ItemIndicator className="flex w-3.5 text-current">
                          <MorphIcon icon={Check} size={12} strokeWidth={2} />
                        </Select.ItemIndicator>
                        <Select.ItemText className="flex-1">{t(item.label)}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Group>
                )
              })}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

function LabelIconSelect({ labelId, lab, setLabel, selectLabel, triggerClassName, glyphSize = '13' }: LabelControlProps & { triggerClassName: string, glyphSize?: string }) {
  const t = useT()
  const icon = labelIconNode(lab.icon)
  return (
    <Select.Root
      items={LABEL_ICON_ITEMS}
      value={lab.icon ?? ICON_NONE}
      onValueChange={value => setLabel(labelId, { icon: value === ICON_NONE ? undefined : String(value) })}
      onOpenChange={(open) => {
        if (open)
          selectLabel(labelId)
      }}
    >
      <Select.Trigger className={triggerClassName} title={t('Label icon')} aria-label={t('Label icon')} data-label-icon-trigger="">
        {icon
          ? <LabelIconGlyph node={icon} size={glyphSize} />
          : <MorphIcon icon={Smile} size={Number(glyphSize) || 13} strokeWidth={1.75} />}
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="z-[260] select-none outline-0" sideOffset={4} align="start" alignItemWithTrigger={false}>
          <Select.Popup className="box-border rounded-none border border-line bg-panel py-1 text-txt outline-0 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
            <Select.List className="relative grid max-h-[var(--available-height)] grid-cols-4 gap-0.5 overflow-y-auto px-1">
              {LABEL_ICON_ITEMS.map(item => (
                <Select.Item
                  key={item.value}
                  value={item.value}
                  title={t(item.label)}
                  aria-label={t(item.label)}
                  className="grid h-8 w-8 cursor-default select-none place-items-center outline-0 data-highlighted:bg-accent data-highlighted:text-on-accent data-selected:outline-1 data-selected:outline-accent"
                >
                  {item.value === ICON_NONE
                    ? <MorphIcon icon={Ban} size={15} strokeWidth={1.75} />
                    : <LabelIconGlyph node={labelIconNode(item.value)!} size="16" />}
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

/** Compact icon-row controls for the desktop floating label toolbar. */
export function LabelControls({ labelId, lab, setLabel, selectLabel }: LabelControlProps) {
  const t = useT()
  const opacityPct = Math.round(labelBgAlpha(lab) * 100)
  const paint = labelPaint(lab)
  return (
    <>
      <LabelFontSelect
        labelId={labelId}
        lab={lab}
        setLabel={setLabel}
        selectLabel={selectLabel}
        triggerClassName="box-border inline-flex h-[22px] min-w-[92px] max-w-[150px] cursor-pointer items-center justify-between gap-1.5 overflow-hidden rounded-none border border-float-line bg-float-bg-2 px-1.5 text-[11px] whitespace-nowrap text-txt hover:bg-chip-hover"
      />
      <button
        className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg-2 p-0 text-txt hover:bg-chip-hover"
        title={lab.theme === 'dark' ? t('Switch to black text on white') : t('Switch to white text on black')}
        aria-label={lab.theme === 'dark' ? t('Switch to black text on white') : t('Switch to white text on black')}
        onPointerDown={e => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          // The quick toggle resets custom colors back to a theme pair.
          setLabel(labelId, { theme: nextLabelTheme(lab.theme), fg: undefined, bg: undefined })
        }}
      >
        <MorphIcon icon={Contrast} size={13} strokeWidth={1.75} />
      </button>
      <input
        type="color"
        className={colorInputCls}
        value={paint.fg}
        title={t('Text color')}
        aria-label={t('Text color')}
        onPointerDown={e => e.stopPropagation()}
        onChange={e => setLabel(labelId, { fg: e.target.value })}
      />
      <input
        type="color"
        className={colorInputCls}
        value={paint.bg}
        title={t('Background color')}
        aria-label={t('Background color')}
        onPointerDown={e => e.stopPropagation()}
        onChange={e => setLabel(labelId, { bg: e.target.value })}
      />
      <div className="box-border h-[22px] w-[72px] self-center" onPointerDown={e => e.stopPropagation()}>
        <AppSlider
          dense
          min={0}
          max={100}
          step={5}
          value={opacityPct}
          label={t('Background opacity')}
          onChange={v => setLabel(labelId, { bgAlpha: v / 100 })}
        />
      </div>
      <LabelIconSelect
        labelId={labelId}
        lab={lab}
        setLabel={setLabel}
        selectLabel={selectLabel}
        triggerClassName="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg-2 p-0 text-txt hover:bg-chip-hover"
      />
    </>
  )
}

/**
 * Mobile (< lg) label editor: a Settings-style panel in the bottom dock, with
 * labelled rows instead of the cramped icon toolbar.
 */
export function LabelPanel({ labelId, lab, setLabel, selectLabel, onDelete }: LabelControlProps & { onDelete: () => void }) {
  const t = useT()
  const opacityPct = Math.round(labelBgAlpha(lab) * 100)
  const paint = labelPaint(lab)
  const themeLabel = lab.theme === 'dark' ? t('Switch to black text on white') : t('Switch to white text on black')
  return (
    <div className={panelBodyCls} data-label-panel="">
      <section className={sectionCls}>
        <h3 className={headingCls}>{t('Style')}</h3>
        <div className={fieldRowCls}>
          <span className={fieldLabelCls}>{t('Font')}</span>
          <LabelFontSelect
            labelId={labelId}
            lab={lab}
            setLabel={setLabel}
            selectLabel={selectLabel}
            triggerClassName={`${fieldControlCls} box-border inline-flex h-[26px] w-full cursor-pointer items-center justify-between gap-1.5 overflow-hidden rounded-none border border-line-strong bg-panel-2 px-2 text-xs whitespace-nowrap text-txt hover:bg-chip-hover focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1`}
          />
        </div>
        <div className={fieldRowCls}>
          <span className={fieldLabelCls}>{t('Theme')}</span>
          <button
            type="button"
            className={`${fieldControlCls} box-border inline-flex h-[26px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-none border border-line-strong bg-panel-2 px-2 text-xs text-txt hover:bg-chip-hover`}
            title={themeLabel}
            aria-label={themeLabel}
            onClick={() => setLabel(labelId, { theme: nextLabelTheme(lab.theme), fg: undefined, bg: undefined })}
          >
            <MorphIcon icon={Contrast} size={14} strokeWidth={1.75} />
            <span className="truncate">{lab.theme === 'dark' ? t('White on black') : t('Black on white')}</span>
          </button>
        </div>
        <ColorField label={t('Text color')} value={paint.fg} onChange={fg => setLabel(labelId, { fg })} />
        <ColorField label={t('Background color')} value={paint.bg} onChange={bg => setLabel(labelId, { bg })} />
        <RangeField
          label={t('Background opacity')}
          text={`${opacityPct}%`}
          min={0}
          max={100}
          step={5}
          value={opacityPct}
          onChange={v => setLabel(labelId, { bgAlpha: v / 100 })}
        />
        <div className={fieldRowCls}>
          <span className={fieldLabelCls}>{t('Label icon')}</span>
          <LabelIconSelect
            labelId={labelId}
            lab={lab}
            setLabel={setLabel}
            selectLabel={selectLabel}
            glyphSize="16"
            triggerClassName={`${fieldControlCls} box-border inline-flex h-[26px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-none border border-line-strong bg-panel-2 px-2 text-txt hover:bg-chip-hover`}
          />
        </div>
      </section>
      <section className={sectionCls}>
        <div className="flex w-full justify-center">
          <Button
            variant="flat"
            aria-label={t('Delete')}
            title={t('Remove label')}
            onClick={onDelete}
          >
            {t('Delete')}
          </Button>
        </div>
      </section>
    </div>
  )
}

function LabelView({
  labelId,
  lab,
  unit,
  editing,
  setEditing,
  elRef,
  onFocus,
}: {
  labelId: string
  lab: PaneLabel
  unit: number
  editing: boolean
  setEditing: (v: boolean) => void
  elRef: React.RefObject<HTMLElement | null>
  onFocus: (id: string) => void
}) {
  const setLabel = useStore(s => s.setLabel)
  const removeLabel = useStore(s => s.removeLabel)
  const selectLabel = useStore(s => s.selectLabel)
  const selected = useStore(s => s.labelSel === labelId)
  const fontTick = useFontReady(lab.font)
  const colors = labelPaint(lab)
  const icon = labelIconNode(lab.icon)
  const rot = rotationOf(lab)
  const { hot, onBoxDown, onBoxMove, onSizeDown, onSizeMove, endGesture, onPointerEnter, onPointerLeave } = useLabelGesture({
    labelId,
    lab,
    editing,
    elRef,
    onFocus,
    setLabel,
    selectLabel,
  })

  const commitEdit = (text: string) => {
    setEditing(false)
    if (!text)
      removeLabel(labelId)
    else
      setLabel(labelId, { text })
  }

  return (
    <div
      className={`group/label absolute z-[6] touch-none px-[0.38em] py-[0.22em] leading-[normal] whitespace-pre outline-1 outline-offset-3 transition-[outline-color] duration-(--dur-fast) ease-(--ease-out) ${
        editing ? 'cursor-text select-text' : 'cursor-grab active:cursor-grabbing'
      } ${editing || selected ? 'outline-txt' : 'outline-transparent'}`}
      data-font-tick={fontTick}
      style={{
        left: `${lab.x * 100}%`,
        top: `${lab.y * 100}%`,
        transform: `translate(-50%, -50%) ${rotationCss(lab)}`,
        fontSize: `${lab.size * unit}px`,
        fontFamily: fontById(lab.font).cssStack,
        background: colors.fill,
        color: colors.fg,
      }}
      onPointerDown={onBoxDown}
      onPointerMove={onBoxMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
    >
      {editing
        ? <LabelEditor text={lab.text} onDone={commitEdit} />
        : (
            <div className="flex items-center" style={{ gap: `${LABEL_ICON_GAP_EM}em` }}>
              {icon && <LabelIconGlyph node={icon} />}
              <span>{lab.text}</span>
            </div>
          )}
      <LabelChrome
        editing={editing}
        labelId={labelId}
        lab={lab}
        rot={rot}
        hot={hot}
        selected={selected}
        setLabel={setLabel}
        onRemove={() => removeLabel(labelId)}
        onSizeDown={onSizeDown}
        onSizeMove={onSizeMove}
        endGesture={endGesture}
      />
      <LabelToolbar
        labelId={labelId}
        lab={lab}
        rot={rot}
        editing={editing}
        hot={hot}
        selected={selected}
        setLabel={setLabel}
        selectLabel={selectLabel}
      />
    </div>
  )
}

function noFocus() {}

/**
 * A board-level text label. Its x/y are normalized to the whole
 * collage board, so it moves freely across panes. The Text tool asks a label
 * into edit mode through the store's sequenced request.
 */
export function BoardLabel({ lab, unit, boardRef }: {
  lab: PaneLabel
  unit: number
  boardRef: React.RefObject<HTMLElement | null>
}) {
  const [editing, setEditing] = useState(false)
  const editReq = useStore(s => s.labelEditReq)
  const [seenEditSeq, setSeenEditSeq] = useState(0)
  if (editReq && editReq.seq !== seenEditSeq) {
    setSeenEditSeq(editReq.seq)
    if (editReq.labelId === lab.id)
      setEditing(true)
  }
  return (
    <LabelView
      labelId={lab.id}
      lab={lab}
      unit={unit}
      editing={editing}
      setEditing={setEditing}
      elRef={boardRef}
      onFocus={noFocus}
    />
  )
}
