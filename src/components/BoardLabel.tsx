import type { IconNode } from 'lucide'
import type { FontMeta } from '../lib/fonts'
import type { Translate } from '../lib/i18n'
import type { TKey } from '../lib/locales/zh-Hans'
import type { LabelAlign, LabelTheme, PaneLabel } from '../lib/panes'
import { Popover } from '@base-ui/react/popover'
import { Select } from '@base-ui/react/select'
import { Switch } from '@base-ui/react/switch'
import { AlignCenter, AlignLeft, AlignRight, Ban, Baseline, Blend, Check, ChevronDown, Contrast, MapPin, Moon, PaintBucket, RefreshCw, RotateCcw, Smile, Sparkles, Sun, Trash2, Type as TypeIcon, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useEffect, useRef, useState } from 'react'
import { AppSlider, colorInputCls as fieldColorInputCls, RangeField } from '@/components/ui/field'
import { ensureFonts, FONT_CATALOG, fontById } from '../lib/fonts'
import { useT } from '../lib/i18n'
import { requestLabelIcon } from '../lib/labelIconJev'
import { LABEL_ICON_EM, LABEL_ICON_GAP_EM, LABEL_ICONS, labelIconNode } from '../lib/labelIcons'
import { DEFAULT_LABEL_THEME, LABEL_THEME_IDS, labelAlign, labelBgAlpha, labelPaint, labelTextShadow, normalizeLabelText, rotationCss, rotationOf, snapRotation } from '../lib/panes'
import { scrollFadeStyle, useScrollFade } from '../lib/useScrollFade'
import { useStore } from '../store'
import { toolsBtnCls, toolsLabelCls } from './ToolsDock'
import { dockBtnStateCls, dockPopupMotionCls } from './ui/menu'

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

/** A menu label: a dictionary key, or literal text such as a font family name. */
type LabelText = { kind: 'key', key: TKey } | { kind: 'text', text: string }

/** Resolve the one place that genuinely mixes keys with proper nouns (font families). */
function labelText(label: LabelText, t: Translate): string {
  return label.kind === 'key' ? t(label.key) : label.text
}

const ICON_NONE = '__none'
// @x18n-keys
const LABEL_ICON_ITEMS: { value: string, label: TKey }[] = [
  { value: ICON_NONE, label: 'No icon' },
  ...LABEL_ICONS.map(i => ({ value: i.id, label: i.label })),
]

const colorInputCls = 'h-[22px] w-[22px] cursor-pointer rounded-none border border-float-line bg-float-bg-2 p-[2px] [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-none [&::-webkit-color-swatch]:border-0'

const LABEL_FONT_ITEMS: { value: string, label: LabelText, cat: FontMeta['cat'] }[] = [
  { value: '', label: { kind: 'key', key: 'System' }, cat: 'system' },
  ...FONT_CATALOG.map(f => ({ value: f.id, label: { kind: 'text' as const, text: f.label }, cat: f.cat })),
]

type FontCat = FontMeta['cat']

// @x18n-keys
const FONT_CATS: { id: FontCat, label: TKey }[] = [
  { id: 'system', label: 'System' },
  { id: 'cjk', label: 'CJK' },
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'hand', label: 'Handwriting' },
  { id: 'mono', label: 'Mono' },
]

/** One read of the theme table: the label the picker shows and the glyph it draws. */
const THEME_ICON: Record<LabelTheme, typeof AlignLeft> = {
  dark: Moon,
  light: Sun,
}
// @x18n-keys
const THEME_LABEL: Record<LabelTheme, TKey> = {
  dark: 'White on black',
  light: 'Black on white',
}
const LABEL_THEME_ITEMS = LABEL_THEME_IDS.map(id => ({ value: id, label: THEME_LABEL[id], icon: THEME_ICON[id] }))

/**
 * The switch chrome shared with the appearance drawer's SwitchField (see
 * AppearanceTools): same box, thumb and checked fill, so the glow toggle reads
 * as the app's own switch rather than a label-only control.
 */
const glowSwitchCls = 'group/switch relative box-border col-start-2 row-start-1 inline-flex h-5 w-[34px] cursor-pointer items-center justify-self-end rounded-none border border-line-strong bg-line-strong p-0 transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] pointer-coarse:h-6 data-checked:border-accent data-checked:bg-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 sm:col-start-3'
const glowSwitchThumbCls = 'block m-0.5 h-3.5 w-3.5 rounded-none border border-line-strong bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-(--dur-fast) group-data-checked/switch:translate-x-3.5'
const glowSwitchRowCls = 'flex items-center justify-between gap-3 px-2 py-[5px]'
const glowSwitchLabelCls = 'text-[12px] text-txt'

/** The glow on/off switch: one `setLabel({ glow })` patch, one undo step. */
function GlowSwitch({ checked, label, onChange }: { checked: boolean, label: string, onChange: (checked: boolean) => void }) {
  return (
    <Switch.Root className={glowSwitchCls} aria-label={label} checked={checked} onCheckedChange={onChange}>
      <Switch.Thumb className={glowSwitchThumbCls} />
    </Switch.Root>
  )
}

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
    // Climb past display:contents wrappers (LabelChrome): those return an
    // empty rect, which parked the pivot at (0,0) and made label rotation
    // feel sticky. Stickers nest the handle directly in the box, so they
    // were already 1:1; labels need the same visual-box center.
    let node: HTMLElement | null = (e.currentTarget as HTMLElement).parentElement
    while (node && getComputedStyle(node).display === 'contents')
      node = node.parentElement
    const box = node?.getBoundingClientRect()
    if (!box || (box.width === 0 && box.height === 0))
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

/**
 * A line break at the caret. `insertLineBreak` keeps the contentEditable's own
 * undo/selection bookkeeping (it writes a `<br>`), and the Range fallback
 * writes a literal newline, which `white-space: pre-wrap` renders the same way.
 * InnerText turns either into a `\n` on commit.
 */
function insertLineBreak() {
  try {
    if (typeof document.execCommand === 'function' && document.execCommand('insertLineBreak'))
      return
  }
  catch {
  }
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount)
    return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode('\n')
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

function LabelEditor({ text, align, onDone }: { text: string, align: LabelAlign, onDone: (text: string) => void }) {
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
    // innerText, not textContent: a contentEditable stores a typed Enter as
    // <br> / <div>, and only the rendered text knows where the lines break.
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- that is the whole point
    const raw = e.currentTarget.innerText ?? e.currentTarget.textContent ?? ''
    onDone(normalizeLabelText(raw))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // IME composition owns Enter: committing there would eat a candidate.
    if (e.nativeEvent.isComposing)
      return
    // Keep both keys from reaching the global handler (Esc would deselect).
    e.stopPropagation()
    if (e.key === 'Escape') {
      ;(e.currentTarget as HTMLElement).blur()
      return
    }
    if (e.key !== 'Enter')
      return
    // Enter is a line break, not a commit: commit is blur / Esc.
    e.preventDefault()
    insertLineBreak()
  }

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-label={t('Edit text label')}
      contentEditable
      suppressContentEditableWarning
      // `pre-wrap` keeps the newlines legible while typing; the committed
      // string is plain text with `\n`, never a DOM structure.
      className="whitespace-pre-wrap outline-0"
      style={{ textAlign: align }}
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
      className={`absolute left-1/2 z-[4] flex items-center gap-[3px] rounded-none max-lg:hidden border border-float-line bg-float-bg p-[3px] backdrop-blur-[7px] transition-opacity duration-(--dur-fast) ${
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
      items={LABEL_FONT_ITEMS.map(i => ({ value: i.value, label: labelText(i.label, t) }))}
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
                        <Select.ItemText className="flex-1">{labelText(item.label, t)}</Select.ItemText>
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

/**
 * The label's look: the two box themes plus the glow effect, in one panel so
 * the relationship is visible (glow hides the box). A theme pick and the glow
 * switch are each one `setLabel` patch, so undo coalescing is unchanged.
 */
function LabelThemeSelect({ labelId, lab, setLabel, selectLabel, triggerClassName }: LabelControlProps & { triggerClassName: string }) {
  const t = useT()
  const currentTheme = lab.theme ?? DEFAULT_LABEL_THEME
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open)
          selectLabel(labelId)
      }}
    >
      <Popover.Trigger className={triggerClassName} title={t('Label theme')} aria-label={t('Label theme')} data-label-theme-trigger="">
        <MorphIcon icon={lab.glow ? Sparkles : THEME_ICON[currentTheme] ?? Contrast} size={13} strokeWidth={1.75} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={6} collisionPadding={8} className="z-[260] select-none outline-0">
          <Popover.Popup className="box-border w-[196px] rounded-none border border-line bg-panel p-1 text-txt outline-0 shadow-[0_12px_32px_rgba(0,0,0,0.45)]" data-label-theme-panel="">
            <div className="grid gap-0.5" role="group" aria-label={t('Label theme')}>
              {LABEL_THEME_ITEMS.map(item => (
                <button
                  key={item.value}
                  type="button"
                  className="flex cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-[6px] text-left text-[13px] text-txt hover:bg-chip-hover aria-pressed:bg-accent aria-pressed:text-on-accent"
                  aria-pressed={currentTheme === item.value}
                  onClick={() => setLabel(labelId, { theme: item.value })}
                >
                  <span className="flex w-3.5 flex-none items-center">{currentTheme === item.value && <MorphIcon icon={Check} size={12} strokeWidth={2} />}</span>
                  <span className="flex w-4 flex-none items-center"><MorphIcon icon={item.icon} size={13} strokeWidth={1.75} /></span>
                  <span className="flex-1">{t(item.label)}</span>
                </button>
              ))}
            </div>
            <div className={`${glowSwitchRowCls} mt-1 border-t border-line-strong pt-1.5`}>
              <span className={glowSwitchLabelCls}>{t('Glow')}</span>
              <GlowSwitch checked={!!lab.glow} label={t('Glow')} onChange={glow => setLabel(labelId, { glow })} />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function LabelIconSelect({ labelId, lab, setLabel, selectLabel, triggerClassName, glyphSize = '13' }: LabelControlProps & { triggerClassName: string, glyphSize?: string }) {
  const iconFadeRef = useScrollFade<HTMLDivElement>()
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
            <Select.List ref={iconFadeRef} style={scrollFadeStyle} data-icon-fade="" className="relative grid max-h-[min(var(--available-height),176px)] grid-cols-4 content-start gap-0.5 overflow-y-auto overscroll-contain p-1">
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

/**
 * The glyph per alignment, keyed by the type so a fourth alignment is a
 * compile error here rather than a dock trigger with no icon.
 */
const ALIGN_ICON: Record<LabelAlign, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
}

// @x18n-keys
const ALIGN_ITEMS: { id: LabelAlign, icon: typeof AlignLeft, label: TKey }[] = [
  { id: 'left', icon: ALIGN_ICON.left, label: 'Align left' },
  { id: 'center', icon: ALIGN_ICON.center, label: 'Align center' },
  { id: 'right', icon: ALIGN_ICON.right, label: 'Align right' },
]

/**
 * The three-button alignment group: one radio-like group per label, shared by
 * the desktop toolbar and the dock's popover so both act on `align` through
 * the same `setLabel` patch (and therefore the same `setLabel:<id>` undo step).
 */
function AlignButtons({ labelId, lab, setLabel, className, buttonClassName, iconSize = 13 }: {
  labelId: string
  lab: PaneLabel
  setLabel: (id: string, patch: Partial<PaneLabel>) => void
  className?: string
  buttonClassName?: string
  iconSize?: number
}) {
  const t = useT()
  const current = labelAlign(lab)
  return (
    <div
      role="group"
      aria-label={t('Label alignment')}
      className={className ?? 'flex h-[22px] items-stretch overflow-hidden border border-float-line bg-float-bg-2'}
    >
      {ALIGN_ITEMS.map(({ id, icon, label }) => (
        <button
          key={id}
          type="button"
          className={buttonClassName ?? 'grid w-[21px] cursor-pointer place-items-center border-0 bg-transparent p-0 text-txt hover:bg-chip-hover aria-pressed:bg-accent aria-pressed:text-on-accent'}
          title={t(label)}
          aria-label={t(label)}
          aria-pressed={current === id}
          onPointerDown={e => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setLabel(labelId, { align: id })
          }}
        >
          <MorphIcon icon={icon} size={iconSize} strokeWidth={1.75} />
        </button>
      ))}
    </div>
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
      <AlignButtons labelId={labelId} lab={lab} setLabel={setLabel} />
      <LabelThemeSelect
        labelId={labelId}
        lab={lab}
        setLabel={setLabel}
        selectLabel={selectLabel}
        triggerClassName="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg-2 p-0 text-txt hover:bg-chip-hover"
      />
      <button
        className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg-2 p-0 text-txt hover:bg-chip-hover"
        title={t('Invert colors')}
        aria-label={t('Invert colors')}
        onPointerDown={e => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          // Swap effective text/background; leave bgAlpha alone.
          const paint = labelPaint(lab)
          setLabel(labelId, { fg: paint.bg, bg: paint.fg })
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
      <div className="box-border flex h-[22px] w-[72px] items-center" onPointerDown={e => e.stopPropagation()}>
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

const DOCK_SWATCHES = ['#ffffff', '#000000', '#e5484d', '#f5a524', '#f7e463', '#30a46c', '#0090ff', '#8e4ec6']

/** The dock's own tool button and caption (see ToolsDock): the label tools are dock tools. */
const dockToolCls = `${toolsBtnCls} ${dockBtnStateCls}`
const dockPopupCls = 'box-border max-w-[calc(100vw-16px)] rounded-none border border-line-strong bg-panel p-2 text-txt shadow-pop outline-0'
const swatchCls = 'box-border h-7 w-7 cursor-pointer rounded-none border border-line-strong p-0 transition-[scale] duration-(--dur-fast) active:scale-[0.97] aria-pressed:outline-2 aria-pressed:outline-accent aria-pressed:outline-offset-1'

type DockTool = 'font' | 'theme' | 'fg' | 'bg' | 'alpha' | 'icon' | 'align'

/**
 * One dock tool that opens its control in a small popover just above it. The
 * trigger is the dock's own tool button (`toolsBtnCls`): icon plus the caption
 * the display mode shows, exactly like the tools it stands in for.
 */
function DockPopover({ id, openTool, setOpenTool, label, caption, trigger, children }: {
  id: DockTool
  openTool: DockTool | null
  setOpenTool: (tool: DockTool | null) => void
  /** Title: the full name of the control. */
  label: string
  /** Caption: the short name the dock row shows under the icon. */
  caption: string
  trigger: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Popover.Root
      open={openTool === id}
      onOpenChange={open => setOpenTool(open ? id : (openTool === id ? null : openTool))}
    >
      <Popover.Trigger className={dockToolCls} title={label} aria-label={caption}>
        {trigger}
        <span className={toolsLabelCls}>{caption}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={8} collisionPadding={8} className="z-[260] select-none outline-0">
          <Popover.Popup className={`${dockPopupCls} ${dockPopupMotionCls}`} data-label-popover={id}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * A tool icon with a small bar showing its current color underneath. The whole
 * glyph is the icon line's 22px (17 + 1 gap + 4 bar), so the button it sits in
 * is the same height as every other dock tool's.
 */
function ColorGlyph({ icon, color }: { icon: IconNode, color: string }) {
  return (
    <span className="flex h-[22px] w-[22px] flex-col items-center justify-center gap-[1px]">
      <MorphIcon icon={icon} size={17} strokeWidth={1.5} />
      <span className="h-[4px] w-[18px] border border-line-strong" style={{ background: color }} />
    </span>
  )
}

function SwatchGrid({ value, label, onChange }: { value: string, label: string, onChange: (hex: string) => void }) {
  const t = useT()
  const cur = value.toLowerCase()
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {DOCK_SWATCHES.map(hex => (
        <button
          key={hex}
          type="button"
          className={swatchCls}
          style={{ background: hex }}
          aria-label={hex}
          aria-pressed={cur === hex}
          onClick={() => onChange(hex)}
        />
      ))}
      <input
        type="color"
        className={`${fieldColorInputCls} !h-7 w-7 border-line-strong`}
        value={value}
        title={`${label} · ${t('Custom color')}`}
        aria-label={`${label} · ${t('Custom color')}`}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

/**
 * Mobile (< lg) label tools: the dock's own tool buttons (see ToolsDock), one
 * popover each, anchored above the button so the label being edited stays in
 * view; only one is open at a time. `contents` keeps the wrapper out of the
 * layout: the buttons are flex items of the dock's row / wrapped container, so
 * they carry the sheet's display mode and geometry rather than their own.
 */
export function LabelDockTools({ labelId, lab, setLabel, onDelete, onInsertLocation }: Omit<LabelControlProps, 'selectLabel'> & { onDelete: () => void, onInsertLocation?: () => void }) {
  const iconFadeRef = useScrollFade<HTMLDivElement>()
  const t = useT()
  const [openTool, setOpenTool] = useState<DockTool | null>(null)
  const opacityPct = Math.round(labelBgAlpha(lab) * 100)
  const paint = labelPaint(lab)
  const icon = labelIconNode(lab.icon)
  const pop = { openTool, setOpenTool }
  return (
    <div className="contents" data-label-dock="">
      <DockPopover id="font" {...pop} label={t('Label font')} caption={t('Font')} trigger={<MorphIcon icon={TypeIcon} size={22} strokeWidth={1.5} />}>
        <div className="-mx-2 -my-2 max-h-[min(30dvh,240px)] w-[200px] overflow-y-auto py-1">
          {FONT_CATS.map((cat) => {
            const items = LABEL_FONT_ITEMS.filter(i => i.cat === cat.id)
            if (!items.length)
              return null
            return (
              <div key={cat.id}>
                <div className="px-2.5 pt-[5px] pb-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-faint">{t(cat.label)}</div>
                {items.map(item => (
                  <button
                    key={item.value || 'system'}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2.5 py-[6px] text-left text-[13px] text-txt hover:bg-chip-hover aria-pressed:bg-accent aria-pressed:text-on-accent"
                    style={{ fontFamily: fontById(item.value).cssStack }}
                    aria-pressed={lab.font === item.value}
                    onClick={() => setLabel(labelId, { font: item.value })}
                  >
                    {labelText(item.label, t)}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </DockPopover>
      <DockPopover
        id="theme"
        {...pop}
        label={t('Label theme')}
        caption={t('Theme')}
        trigger={<MorphIcon icon={lab.glow ? Sparkles : THEME_ICON[lab.theme ?? DEFAULT_LABEL_THEME] ?? Contrast} size={22} strokeWidth={1.5} />}
      >
        <div className="w-[196px]">
          <div className="grid gap-1" role="group" aria-label={t('Label theme')}>
            {LABEL_THEME_IDS.map(id => (
              <button
                key={id}
                type="button"
                className="flex cursor-pointer items-center gap-2 rounded-none border border-line-strong bg-transparent px-2.5 py-2 text-left text-[13px] text-txt hover:bg-chip-hover aria-pressed:bg-accent aria-pressed:text-on-accent"
                aria-pressed={(lab.theme ?? DEFAULT_LABEL_THEME) === id}
                onClick={() => setLabel(labelId, { theme: id })}
              >
                <MorphIcon icon={THEME_ICON[id]} size={15} strokeWidth={1.75} />
                {t(THEME_LABEL[id])}
              </button>
            ))}
          </div>
          <div className={`${glowSwitchRowCls} mt-1 border-t border-line-strong px-1 pt-2`}>
            <span className={glowSwitchLabelCls}>{t('Glow')}</span>
            <GlowSwitch checked={!!lab.glow} label={t('Glow')} onChange={glow => setLabel(labelId, { glow })} />
          </div>
        </div>
      </DockPopover>
      <DockPopover
        id="align"
        {...pop}
        label={t('Label alignment')}
        caption={t('Align')}
        trigger={<MorphIcon icon={ALIGN_ICON[labelAlign(lab)]} size={22} strokeWidth={1.5} />}
      >
        <AlignButtons
          labelId={labelId}
          lab={lab}
          setLabel={setLabel}
          className="flex gap-1.5"
          buttonClassName="grid h-9 w-12 cursor-pointer place-items-center rounded-none border border-line-strong bg-transparent p-0 text-txt hover:bg-chip-hover aria-pressed:bg-accent aria-pressed:text-on-accent"
          iconSize={18}
        />
      </DockPopover>
      <DockPopover id="fg" {...pop} label={t('Text color')} caption={t('Text color')} trigger={<ColorGlyph icon={Baseline} color={paint.fg} />}>
        <SwatchGrid value={paint.fg} label={t('Text color')} onChange={fg => setLabel(labelId, { fg })} />
      </DockPopover>
      <DockPopover id="bg" {...pop} label={t('Background color')} caption={t('Background')} trigger={<ColorGlyph icon={PaintBucket} color={paint.bg} />}>
        <SwatchGrid value={paint.bg} label={t('Background color')} onChange={bg => setLabel(labelId, { bg })} />
      </DockPopover>
      <DockPopover id="alpha" {...pop} label={t('Background opacity')} caption={t('Opacity')} trigger={<MorphIcon icon={Blend} size={22} strokeWidth={1.5} />}>
        <div className="w-[min(260px,calc(100vw-40px))]">
          <RangeField
            label={t('Background opacity')}
            text={`${opacityPct}%`}
            min={0}
            max={100}
            step={5}
            value={opacityPct}
            onChange={v => setLabel(labelId, { bgAlpha: v / 100 })}
          />
        </div>
      </DockPopover>
      <DockPopover
        id="icon"
        {...pop}
        label={t('Label icon')}
        caption={t('Icon')}
        trigger={icon ? <LabelIconGlyph node={icon} size="22" /> : <MorphIcon icon={Smile} size={22} strokeWidth={1.5} />}
      >
        <div ref={iconFadeRef} style={scrollFadeStyle} data-icon-fade="" className="grid h-[120px] max-h-[min(40dvh,260px)] grid-cols-6 content-start gap-0.5 overflow-y-auto overscroll-contain p-1">
          {LABEL_ICON_ITEMS.map(item => (
            <button
              key={item.value}
              type="button"
              title={t(item.label)}
              aria-label={t(item.label)}
              aria-pressed={(lab.icon ?? ICON_NONE) === item.value}
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-txt outline-0 hover:bg-chip-hover aria-pressed:outline-1 aria-pressed:outline-accent focus-visible:outline-1 focus-visible:outline-accent"
              onClick={() => setLabel(labelId, { icon: item.value === ICON_NONE ? undefined : item.value })}
            >
              {item.value === ICON_NONE
                ? <MorphIcon icon={Ban} size={16} strokeWidth={1.75} />
                : <LabelIconGlyph node={labelIconNode(item.value)!} size="18" />}
            </button>
          ))}
        </div>
      </DockPopover>
      {onInsertLocation && (
        <button
          type="button"
          className={dockToolCls}
          title={t('Insert a location label from this photo\'s GPS')}
          aria-label={t('Location')}
          onClick={onInsertLocation}
        >
          <MorphIcon icon={MapPin} size={22} strokeWidth={1.5} />
          <span className={toolsLabelCls}>{t('Location')}</span>
        </button>
      )}
      <button
        type="button"
        className={dockToolCls}
        title={t('Invert colors')}
        aria-label={t('Invert')}
        onClick={() => {
          const paint = labelPaint(lab)
          setLabel(labelId, { fg: paint.bg, bg: paint.fg })
        }}
      >
        <MorphIcon icon={Contrast} size={22} strokeWidth={1.5} />
        <span className={toolsLabelCls}>{t('Invert')}</span>
      </button>
      <button type="button" className={`${dockToolCls} hover:!text-danger`} title={t('Remove label')} aria-label={t('Delete')} onClick={onDelete}>
        <MorphIcon icon={Trash2} size={22} strokeWidth={1.5} />
        <span className={toolsLabelCls}>{t('Delete')}</span>
      </button>
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
    if (!text) {
      removeLabel(labelId)
      return
    }
    setLabel(labelId, { text })
    requestLabelIcon(labelId, text)
  }

  return (
    <div
      className={`group/label absolute z-[6] touch-none px-[0.38em] py-[0.22em] leading-[normal] whitespace-pre outline-1 outline-offset-3 transition-[outline-color] duration-(--dur-fast) ease-(--ease-out) ${
        editing ? 'cursor-text select-text' : 'cursor-grab active:cursor-grabbing'
      } ${editing || selected ? 'outline-txt' : 'outline-transparent'}`}
      data-label-id={labelId}
      data-font-tick={fontTick}
      style={{
        left: `${lab.x * 100}%`,
        top: `${lab.y * 100}%`,
        transform: `translate(-50%, -50%) ${rotationCss(lab)}`,
        fontSize: `${lab.size * unit}px`,
        fontFamily: fontById(lab.font).cssStack,
        background: colors.fill,
        color: colors.fg,
        // Inherited by the text (and the editor): one em-relative stack, so the
        // glow keeps its proportions at any label size.
        textShadow: labelTextShadow(lab),
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
        ? <LabelEditor text={lab.text} align={labelAlign(lab)} onDone={commitEdit} />
        : (
            <div className="flex items-center" style={{ gap: `${LABEL_ICON_GAP_EM}em` }}>
              {icon && <LabelIconGlyph node={icon} />}
              {/* The text block is as wide as its longest line (a flex item
                  shrink-wraps to max-content); `text-align` then places each
                  shorter line the exporter also places through
                  `labelAlignOffset`. `pre` keeps explicit newlines only. */}
              <span style={{ display: 'block', whiteSpace: 'pre', textAlign: labelAlign(lab) }}>{lab.text}</span>
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
