import type { FontMeta } from '../lib/fonts'
import type { Photo, Preview } from '../lib/imageStore'
import type { Leaf, PaneLabel, Rect, SeamSides, Sticker } from '../lib/panes'
import { ContextMenu } from '@base-ui/react/context-menu'
import { Select } from '@base-ui/react/select'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight, Check, ChevronDown, Contrast, ImagePlus, SquareSplitHorizontal, SquareSplitVertical, Sticker as StickerIcon, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePreview } from '../hooks'
import { ensureFonts, FONT_CATALOG, fontById } from '../lib/fonts'
import { useT } from '../lib/i18n'
import { getLiveVideoUrl } from '../lib/imageStore'
import { clampLeaf, labelColors, nextLabelTheme, photoNorm, placement, seamFadeWidth, seamMaskStyle, stickerRect } from '../lib/panes'
import { viewTransitionOption } from '../lib/viewTransition'
import { activeWs, MAX_ZOOM, MIN_ZOOM, useStore } from '../store'

/* One split button. The chip's height is the page row's (back / reset), so the
   same chip reads the same in the top row and inside a hovered pane. */
const splitBtnCls = 'grid w-[30px] cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-float-icon transition-colors duration-[120ms] hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent pointer-coarse:w-[38px]'

const menuItemCls = 'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-1.5 text-xs text-txt data-highlighted:bg-chip-hover active:bg-chip-on active:text-chip-on-txt'

const menuSeparatorCls = 'mx-1 my-1 h-px border-0 bg-line'

const dropBtnCls = 'flex w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-2 text-xs text-txt hover:bg-chip-hover active:bg-chip-on active:text-chip-on-txt'

// Dragging a photo this many px past its pane's edge upgrades a pan into a
// swap drag (carrying the photo onto another pane).
const SWAP_EDGE = 12

interface Gesture {
  mode: 'pan' | 'pinch' | 'swap'
  lastX: number
  lastY: number
  startDist: number
  base: Leaf
}

const LABEL_FONT_ITEMS = [
  { value: '', label: 'System', cat: 'system' as FontMeta['cat'] },
  ...FONT_CATALOG.map(f => ({ value: f.id, label: f.label, cat: f.cat })),
]

const FONT_CATS: { id: FontMeta['cat'], label: string }[] = [
  { id: 'system', label: 'System' },
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

function StickerView({
  paneId,
  st,
  photo,
  place,
  paneRect,
  toCanvas,
  onFocus,
}: {
  paneId: string
  st: Sticker
  photo: Photo
  place: { x: number, y: number, w: number, h: number }
  paneRect: Rect
  toCanvas: (clientX: number, clientY: number) => { x: number, y: number }
  onFocus: (id: string) => void
}) {
  const preview = usePreview(photo)
  const removeSticker = useStore(s => s.removeSticker)
  const selectSticker = useStore(s => s.selectSticker)
  const t = useT()
  const selected = useStore(s => s.stickerSel?.stickerId === st.id)
  // hover intent: keep the handles alive while the pointer crosses the gap
  // to them, the same treatment labels get.
  const [hot, setHot] = useState(false)
  const leaveRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (leaveRef.current != null)
      window.clearTimeout(leaveRef.current)
  }, [])
  const gestureRef = useRef<{
    mode: 'move' | 'resize'
    ocX: number
    ocY: number
    d0: number
    s0: number
  } | null>(null)

  if (!photo.trueW || !photo.trueH || !preview)
    return null
  const aspect = photo.trueW / photo.trueH
  const r = stickerRect(place, st, photo.trueW, photo.trueH, aspect)

  const onMoveDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0)
      return
    onFocus(paneId)
    selectSticker({ paneId, stickerId: st.id })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gestureRef.current = { mode: 'move', ocX: 0, ocY: 0, d0: 0, s0: st.s }
  }
  const onMoveMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'move')
      return
    e.stopPropagation()
    const p = toCanvas(e.clientX, e.clientY)
    const n = photoNorm(place, p.x, p.y)
    useStore.getState().moveSticker(paneId, st.id, n.x, n.y)
  }

  const onResizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0)
      return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const corner = toCanvas(e.clientX, e.clientY)
    const ocX = 2 * (r.x + r.w / 2) - corner.x
    const ocY = 2 * (r.y + r.h / 2) - corner.y
    gestureRef.current = {
      mode: 'resize',
      ocX,
      ocY,
      d0: Math.max(4, Math.hypot(corner.x - ocX, corner.y - ocY)),
      s0: st.s,
    }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g || g.mode !== 'resize')
      return
    e.stopPropagation()
    const p = toCanvas(e.clientX, e.clientY)
    const dist = Math.hypot(p.x - g.ocX, p.y - g.ocY)
    const n = photoNorm(place, (g.ocX + p.x) / 2, (g.ocY + p.y) / 2)
    const s = useStore.getState()
    s.moveSticker(paneId, st.id, n.x, n.y)
    s.scaleSticker(paneId, st.id, g.s0 * (dist / g.d0))
  }

  const endGesture = () => {
    gestureRef.current = null
  }

  return (
    <div
      className="group/sticker absolute z-2 cursor-grab touch-none active:cursor-grabbing"
      style={{ left: r.x - paneRect.x, top: r.y - paneRect.y, width: r.w, height: r.h }}
      title={photo.name}
      onPointerDown={onMoveDown}
      onPointerMove={onMoveMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerEnter={() => {
        if (leaveRef.current != null) {
          window.clearTimeout(leaveRef.current)
          leaveRef.current = null
        }
        setHot(true)
      }}
      onPointerLeave={() => {
        if (leaveRef.current != null)
          window.clearTimeout(leaveRef.current)
        leaveRef.current = window.setTimeout(() => {
          leaveRef.current = null
          setHot(false)
        }, 220)
      }}
    >
      <img src={preview.url} alt="" draggable={false} className="block h-full w-full max-w-none pointer-events-none shadow-[0_2px_10px_rgba(0,0,0,0.35)]" />
      <span
        className={`group-hover/sticker:opacity-100 absolute -right-2 -bottom-2 h-[15px] w-[15px] cursor-nwse-resize rounded-none border-2 border-float-bg-2 bg-accent opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-opacity duration-[120ms] ${hot || selected ? ' opacity-100' : ''}`}
        title={t('Drag to resize')}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
      <button
        className={`group-hover/sticker:opacity-100 absolute -top-[9px] -right-[9px] grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-none border border-float-bg-2 bg-danger p-0 text-xs leading-none text-on-accent opacity-0 transition-opacity duration-[120ms] ${hot || selected ? ' opacity-100' : ''}`}
        title={t('Remove sticker')}
        onPointerDown={e => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          removeSticker(paneId, st.id)
        }}
      >
        ×
      </button>
    </div>
  )
}

function LabelEditor({ text, onDone }: { text: string, onDone: (text: string) => void }) {
  const editorRef = useRef<HTMLDivElement | null>(null)

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
      contentEditable
      suppressContentEditableWarning
      onBlur={finish}
      onKeyDown={onKeyDown}
    >
      {text}
    </div>
  )
}

function LabelView({
  paneId,
  lab,
  unit,
  editing,
  setEditing,
  elRef,
  onFocus,
}: {
  paneId: string
  lab: PaneLabel
  unit: number
  editing: boolean
  setEditing: (v: boolean) => void
  elRef: React.RefObject<HTMLDivElement | null>
  onFocus: (id: string) => void
}) {
  const setLabel = useStore(s => s.setLabel)
  const removeLabel = useStore(s => s.removeLabel)
  const selectLabel = useStore(s => s.selectLabel)
  const t = useT()
  const selected = useStore(s => s.labelSel === paneId)
  const fontTick = useFontReady(lab.font)
  const colors = labelColors(lab.theme)
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
    onFocus(paneId)
    selectLabel(paneId)
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
    setLabel(paneId, {
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
    setLabel(paneId, { size: g.s0 * (dist / g.d0) })
  }

  const endGesture = () => {
    gestureRef.current = null
  }

  const commitEdit = (text: string) => {
    setEditing(false)
    if (!text)
      removeLabel(paneId)
    else
      setLabel(paneId, { text })
  }

  return (
    <div
      className={`group/label absolute z-2 touch-none px-[0.38em] py-[0.22em] leading-[normal] whitespace-pre ${
        editing ? ' cursor-text select-text outline-1 outline-txt outline-offset-3' : ' cursor-grab active:cursor-grabbing'
      }${selected ? ' outline-1 outline-txt outline-offset-3' : ''}`}
      data-font-tick={fontTick}
      style={{
        left: `${lab.x * 100}%`,
        top: `${lab.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        fontSize: `${lab.size * unit}px`,
        fontFamily: fontById(lab.font).cssStack,
        background: colors.bg,
        color: colors.fg,
      }}
      onPointerDown={onBoxDown}
      onPointerMove={onBoxMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerEnter={() => {
        if (leaveRef.current != null) {
          window.clearTimeout(leaveRef.current)
          leaveRef.current = null
        }
        setHot(true)
      }}
      onPointerLeave={() => {
        if (leaveRef.current != null)
          window.clearTimeout(leaveRef.current)
        leaveRef.current = window.setTimeout(() => {
          leaveRef.current = null
          setHot(false)
        }, 220)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
    >
      {editing
        ? <LabelEditor text={lab.text} onDone={commitEdit} />
        : <div>{lab.text}</div>}
      {!editing && (
        <span
          className={`group-hover/label:opacity-100 absolute -right-2 -bottom-2 h-[15px] w-[15px] cursor-nwse-resize rounded-none border-2 border-float-bg-2 bg-accent opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-opacity duration-[120ms] ${hot || selected ? ' opacity-100' : ''}`}
          title={t('Drag to resize')}
          onPointerDown={onSizeDown}
          onPointerMove={onSizeMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        />
      )}
      {!editing && (
        <button
          className={`group-hover/label:opacity-100 absolute -top-[9px] -right-[9px] grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-none border border-float-bg-2 bg-danger p-0 text-xs leading-none text-on-accent opacity-0 transition-opacity duration-[120ms] ${hot || selected ? ' opacity-100' : ''}`}
          title={t('Remove label')}
          onPointerDown={e => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            removeLabel(paneId)
          }}
        >
          ×
        </button>
      )}
      <div
        className={`absolute left-1/2 z-[4] flex -translate-x-1/2 gap-[3px] rounded-none border border-float-line bg-float-bg p-[3px] backdrop-blur-[7px] transition-opacity duration-[140ms] ${
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
        onPointerDown={(e) => {
          e.stopPropagation()
          selectLabel(paneId)
        }}
      >
        <Select.Root
          items={LABEL_FONT_ITEMS}
          value={lab.font}
          onValueChange={value => setLabel(paneId, { font: String(value) })}
          onOpenChange={(open) => {
            // Keep the toolbar pinned while the font popup is open, also when
            // the list was opened from the keyboard instead of a click.
            if (open)
              selectLabel(paneId)
          }}
        >
          <Select.Trigger className="box-border inline-flex h-[22px] min-w-[92px] max-w-[150px] cursor-pointer items-center justify-between gap-1.5 overflow-hidden rounded-none border border-float-line bg-float-bg-2 px-1.5 text-[11px] whitespace-nowrap text-txt hover:bg-chip-hover" title={t('Label font')} aria-label={t('Label font')}>
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
        <button
          className="grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg-2 p-0 text-txt hover:bg-chip-hover"
          title={lab.theme === 'dark' ? t('Switch to black text on white') : t('Switch to white text on black')}
          aria-label={lab.theme === 'dark' ? t('Switch to black text on white') : t('Switch to white text on black')}
          onPointerDown={e => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setLabel(paneId, { theme: nextLabelTheme(lab.theme) })
          }}
        >
          <MorphIcon icon={Contrast} size={13} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

// The pane's photo area: the placed preview once loaded, a placeholder note
// while the preview decodes, or the empty pane's placeholder icon (picking a
// photo lives in the focused pane's tools row, see Stage.tsx).
function PanePhotoContent({
  preview,
  place,
  rect,
  photoId,
  mask,
}: {
  preview: Preview | null
  place: ReturnType<typeof placement> | null
  rect: Rect
  photoId: string | null
  mask?: React.CSSProperties
}) {
  const t = useT()
  return preview && place
    ? (
        // The mask wrapper spans the pane box, so the feather gradients line
        // up with the pane edges (the placed img itself overflows the pane).
        <div className="absolute inset-0" style={mask}>
          <img
            src={preview.url}
            alt=""
            draggable={false}
            className="block max-w-none will-change-transform"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transformOrigin: '0 0',
              transform: `translate(${place.x - rect.x}px, ${place.y - rect.y}px) scale(${place.scale})`,
              maxWidth: 'none',
            }}
          />
        </div>
      )
    : photoId
      ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-pane-hint">{t('Loading...')}</div>
        )
      : (
          // A placeholder, not a button: the pane's tools (including picking a
          // photo) appear once it is focused.
          <div className="absolute inset-0 grid place-items-center">
            <MorphIcon icon={ImagePlus} size={22} strokeWidth={1.75} className="pointer-events-none text-faint" />
          </div>
        )
}

/**
 * The two split buttons for one pane, drawn as a single chip. Hovering a pane
 * fades it in at that pane's top center; the focused pane's chip rides in the
 * page row between back and reset instead (FloatActions.tsx), where it never
 * covers the pane it splits.
 */
export function PaneSplitTools({
  paneId,
  onSplit,
  className = '',
}: {
  paneId: string
  onSplit: (id: string, dir: 'row' | 'column') => void
  /** Placement and visibility, supplied by the caller. */
  className?: string
}) {
  const t = useT()
  return (
    <div
      className={`flex h-[30px] rounded-none border border-float-line bg-float-bg backdrop-blur-[7px] pointer-coarse:h-[38px] ${className}`}
      onPointerDown={e => e.stopPropagation()}
    >
      <button
        className={splitBtnCls}
        title={t('Split top/bottom')}
        onClick={(e) => {
          e.stopPropagation()
          onSplit(paneId, 'column')
        }}
      >
        <MorphIcon icon={SquareSplitVertical} size={15} strokeWidth={1.75} />
      </button>
      <button
        className={splitBtnCls}
        title={t('Split left/right')}
        onClick={(e) => {
          e.stopPropagation()
          onSplit(paneId, 'row')
        }}
      >
        <MorphIcon icon={SquareSplitHorizontal} size={15} strokeWidth={1.75} />
      </button>
    </div>
  )
}

function PaneLiveBadge({ playing, onToggle }: { playing: boolean, onToggle: () => void }) {
  const t = useT()
  return (
    <button
      className={`absolute left-[9px] top-[9px] z-[3] flex cursor-pointer items-center gap-[5px] rounded-none border border-float-line bg-float-bg py-[3px] pl-1.5 pr-[7px] text-[9px] font-bold tracking-[0.09em] transition-colors duration-[140ms] backdrop-blur-[7px] hover:bg-chip-hover ${
        // hover:text-txt carries class+pseudo specificity that would beat
        // text-danger, so it only rides the idle state.
        playing ? ' text-danger' : ' text-float-icon hover:text-txt'
      }`}
      title={playing ? t('Stop Live Photo') : t('Live Photo: press and hold or use the play button')}
      aria-label={playing ? t('Stop Live Photo') : t('Play Live Photo')}
      onPointerDown={e => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full border-[1.5px] border-current shadow-[inset_0_0_0_2.5px_var(--floatBg),inset_0_0_0_3.5px_currentColor] ${
          playing ? ' animate-[live-blink_1.4s_var(--ease-in-out)_infinite]' : ''
        }`}
      />
      LIVE
    </button>
  )
}

function PaneCloseTool({
  paneId,
  focused,
  onClose,
}: {
  paneId: string
  focused: boolean
  onClose: (id: string) => void
}) {
  const t = useT()
  return (
    <button
      className={`absolute right-[9px] top-[9px] z-[3] grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-[15px] leading-none text-float-icon transition-[opacity,color] duration-[140ms] drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:text-danger focus-visible:opacity-100 pointer-coarse:h-[30px] pointer-coarse:w-[30px] ${
        focused ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
      title={t('Close this pane')}
      onPointerDown={e => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClose(paneId)
      }}
    >
      <MorphIcon icon={X} size={14} strokeWidth={1.75} />
    </button>
  )
}

function PaneOutline({
  focused,
  dropping,
  bordered,
  radius,
}: {
  focused: boolean
  dropping: boolean
  bordered: boolean
  radius: number
}) {
  return (
    <div
      aria-hidden
      className={
        `pointer-events-none absolute inset-0 z-[4] -outline-offset-1 ${
          bordered ? ' outline-1 outline-line' : ''
        }${focused ? ' outline-1 outline-txt' : ''}${dropping ? ' outline-dashed outline-1 outline-txt' : ''}`
      }
      style={{ borderRadius: radius }}
    />
  )
}

interface Props {
  leaf: Leaf
  rect: Rect
  radius: number
  bordered: boolean
  fade: number
  seam?: SeamSides
  unit: number
  photo: Photo | null
  photoById: Map<string, Photo>
  focused: boolean
  canClose: boolean
  onFocus: (id: string) => void
  onUpdate: (id: string, patch: Partial<Leaf>) => void
  onSplit: (id: string, dir: 'row' | 'column') => void
  onClose: (id: string) => void
}

function PaneImpl({
  leaf,
  rect,
  radius,
  bordered,
  fade,
  seam,
  unit,
  photo,
  photoById,
  focused,
  canClose,
  onFocus,
  onUpdate,
  onSplit,
  onClose,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const preview = usePreview(photo)
  const t = useT()
  const navigate = useNavigate()

  // Exit the editor back to the grid overview, morphing the canvas into its cell.
  const exitToGrid = useCallback(() => {
    useStore.getState().clearSelection()
    void navigate({ to: '/', viewTransition: viewTransitionOption() })
  }, [navigate])

  const pointersRef = useRef(new Map<number, { x: number, y: number }>())
  const gestureRef = useRef<Gesture | null>(null)
  // Whether the active touch gesture already focused this pane. Touch defers
  // focus to the first move or the release, so a long-press opens the pane's
  // context menu with this pane still unfocused, the same state a desktop
  // right-click produces, which is what makes "Swap with focused pane" work.
  const touchFocusedRef = useRef(true)
  const [dropping, setDropping] = useState(false)
  const [editing, setEditing] = useState(false)

  // ---- Drag-out photo swap --------------------------------------------------
  // Panning past the pane's edge carries the photo out as a ghost; dropping
  // it on another pane swaps the two photos. The hovered target highlights
  // imperatively via a data-swap-over attribute (see index.css); dropping
  // nowhere, on the source pane, or a pointercancel cancels.
  const [swapAt, setSwapAt] = useState<{ x: number, y: number } | null>(null)
  const overRef = useRef<HTMLElement | null>(null)
  const clearSwapOver = useCallback(() => {
    if (overRef.current) {
      delete overRef.current.dataset.swapOver
      overRef.current = null
    }
  }, [])
  const swapOverAt = useCallback((x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pane-id]') ?? null
    const target = el && el.dataset.paneId !== leaf.id ? el : null
    if (overRef.current !== target) {
      clearSwapOver()
      if (target) {
        target.dataset.swapOver = '1'
        overRef.current = target
      }
    }
  }, [leaf.id, clearSwapOver])
  const endSwapDrag = useCallback((commit: boolean) => {
    const targetId = overRef.current?.dataset.paneId
    clearSwapOver()
    document.body.style.cursor = ''
    setSwapAt(null)
    if (commit && targetId) {
      const s = useStore.getState()
      s.swapPhotos(leaf.id, targetId)
      s.focus(targetId)
    }
  }, [leaf.id, clearSwapOver])
  useEffect(() => () => {
    clearSwapOver()
    document.body.style.cursor = ''
  }, [clearSwapOver])
  // A drop on a pane that already holds a photo asks what the image should
  // become; `at` is the drop point in pane-normalized coords for stickers.
  const [dropChoice, setDropChoice] = useState<{ photos: Photo[], at: { x: number, y: number } } | null>(null)

  // The global Text tool (tools bar) asks a pane's label into edit mode via
  // the store. Consume the request during render; the monotonic sequence
  // makes even repeated requests for the same pane fire every time.
  const editReq = useStore(s => s.labelEditReq)
  const [seenEditSeq, setSeenEditSeq] = useState(0)
  if (editReq && editReq.seq !== seenEditSeq) {
    setSeenEditSeq(editReq.seq)
    if (editReq.paneId === leaf.id)
      setEditing(true)
  }

  // Live Photo: press and hold to play the paired video, release to stop; the
  // play button pins playback instead (toggles, survives gestures). Both
  // record which photo they belong to, so swapping the pane's photo
  // invalidates playback without an effect.
  const [liveFor, setLiveFor] = useState<string | null>(null)
  const [livePin, setLivePin] = useState<string | null>(null)
  const liveVideoRef = useRef<HTMLVideoElement | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const downAtRef = useRef<{ x: number, y: number } | null>(null)
  const liveUrl = photo?.videoFile ? getLiveVideoUrl(photo) : null
  const live = !!liveUrl && !!photo && (liveFor === photo.id || livePin === photo.id)

  const clearHold = useCallback(() => {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearHold(), [clearHold])

  useEffect(() => {
    const v = liveVideoRef.current
    if (!v)
      return
    if (live) {
      v.currentTime = 0
      v.play().catch(() => {
        v.muted = true
        v.play().catch(() => {})
      })
    }
    else {
      v.pause()
    }
  }, [live, liveUrl])

  const iw = preview?.w ?? 0
  const ih = preview?.h ?? 0
  const cell: Rect = rect

  const local = useCallback((cx: number, cy: number) => {
    const r = elRef.current?.getBoundingClientRect()
    return r ? { x: cx - r.left, y: cy - r.top } : { x: 0, y: 0 }
  }, [])

  const commit = useCallback(
    (next: Leaf) => {
      if (!iw || !ih)
        return
      onUpdate(leaf.id, clampLeaf(next, cell, iw, ih))
    },
    [leaf.id, iw, ih, onUpdate, cell],
  )

  const zoomAbout = useCallback(
    (base: Leaf, nextZoom: number, mx: number, my: number) => {
      if (!iw || !ih)
        return
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
      const before = placement(cell, base, iw, ih)
      const u = (mx - before.x) / before.w
      const v = (my - before.y) / before.h
      const after = placement(cell, { ...base, zoom }, iw, ih)
      const tx = mx - u * after.w
      const ty = my - v * after.h
      commit({ ...base, zoom, cx: (cell.w / 2 - tx) / after.w, cy: (cell.h / 2 - ty) / after.h })
    },
    [iw, ih, commit, cell],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    // Only the primary button focuses or starts a gesture. A right-click must
    // leave focus alone so the menu's swap item can target the focused pane;
    // touch defers focus to the first move or release (see touchFocusedRef).
    if (e.button !== 0)
      return
    // A second pointer while carrying a photo out must not start a new gesture.
    if (gestureRef.current?.mode === 'swap')
      return
    const touch = e.pointerType !== 'mouse'
    touchFocusedRef.current = !touch
    if (!touch)
      onFocus(leaf.id)
    useStore.getState().selectLabel(null)
    if (!leaf.photoId)
      return
    elRef.current?.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = local(e.clientX, e.clientY)
    if (pointersRef.current.size >= 2) {
      clearHold()
      const [a, b] = [...pointersRef.current.values()]
      gestureRef.current = {
        mode: 'pinch',
        lastX: 0,
        lastY: 0,
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        base: { ...leaf },
      }
    }
    else {
      gestureRef.current = { mode: 'pan', lastX: p.x, lastY: p.y, startDist: 0, base: { ...leaf } }
      if (liveUrl) {
        downAtRef.current = { x: e.clientX, y: e.clientY }
        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = null
          downAtRef.current = null
          setLiveFor(photo?.id ?? null)
        }, 320)
      }
    }
  }

  // Single-pointer pan; dragging past the pane's edge upgrades it into a
  // swap drag instead of panning further.
  const panMove = (e: React.PointerEvent, g: Gesture) => {
    const r = elRef.current?.getBoundingClientRect()
    if (r && Math.max(r.left - e.clientX, e.clientX - r.right, r.top - e.clientY, e.clientY - r.bottom) >= SWAP_EDGE) {
      clearHold()
      downAtRef.current = null
      setLiveFor(null)
      gestureRef.current = { mode: 'swap', lastX: 0, lastY: 0, startDist: 0, base: g.base }
      document.body.style.cursor = 'grabbing'
      setSwapAt({ x: e.clientX, y: e.clientY })
      swapOverAt(e.clientX, e.clientY)
      return
    }
    const p = local(e.clientX, e.clientY)
    // Dragging means panning, not holding; cancel the Live Photo timer.
    if (holdTimerRef.current != null && downAtRef.current
      && Math.hypot(e.clientX - downAtRef.current.x, e.clientY - downAtRef.current.y) > 5) {
      clearHold()
    }
    const dx = p.x - g.lastX
    const dy = p.y - g.lastY
    g.lastX = p.x
    g.lastY = p.y
    const pl = placement(cell, leaf, iw, ih)
    commit({ ...leaf, cx: leaf.cx - dx / pl.w, cy: leaf.cy - dy / pl.h })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId))
      return
    // A moving touch (pan or pinch starting) means the user is working on
    // this pane; focus it now; a still press may still become a long-press
    // menu instead, which must find the pane unfocused.
    if (!touchFocusedRef.current) {
      touchFocusedRef.current = true
      onFocus(leaf.id)
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gestureRef.current
    if (!g || !iw || !ih)
      return

    if (g.mode === 'pan' && pointersRef.current.size === 1) {
      panMove(e, g)
      return
    }
    if (g.mode === 'swap' && pointersRef.current.size === 1) {
      setSwapAt({ x: e.clientX, y: e.clientY })
      swapOverAt(e.clientX, e.clientY)
      return
    }
    if (g.mode === 'pinch' && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2)
      const ratio = dist / g.startDist
      // "Pinch past the floor": zoomAbout clamps to MIN_ZOOM, so judge the
      // raw ratio: shrinking an already-minimum photo out of the pane is the
      // explicit exit-to-grid gesture, and it must not commit a zoom either.
      if (g.base.zoom * ratio <= MIN_ZOOM && ratio < 1) {
        exitToGrid()
        return
      }
      zoomAbout(g.base, g.base.zoom * ratio, mid.x, mid.y)
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    // A touch that stayed still and never opened the menu is a tap: focus now.
    // When the long-press menu is open this pointerup lands on the menu
    // backdrop, so the pane stays unfocused (and onOpenChange already armed
    // touchFocusedRef against a stray late event).
    if (!touchFocusedRef.current) {
      touchFocusedRef.current = true
      onFocus(leaf.id)
    }
    const g = gestureRef.current
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size === 0) {
      gestureRef.current = null
      clearHold()
      downAtRef.current = null
      setLiveFor(null)
      // pointerup over another pane commits the swap; pointercancel drops it.
      if (g?.mode === 'swap')
        endSwapDrag(e.type === 'pointerup')
    }
    else {
      const only = [...pointersRef.current.values()][0]
      const p = local(only.x, only.y)
      gestureRef.current = { mode: 'pan', lastX: p.x, lastY: p.y, startDist: 0, base: { ...leaf } }
    }
  }

  // The menu opens mid-gesture on touch (Base UI long-presses the trigger):
  // hand the gesture back so the finger moving over the open menu doesn't
  // keep panning the photo underneath, and stop Live Photo playback.
  const onMenuOpenChange = (open: boolean) => {
    if (!open)
      return
    endSwapDrag(false)
    const el = elRef.current
    if (el) {
      for (const id of [...pointersRef.current.keys()]) {
        if (el.hasPointerCapture(id))
          el.releasePointerCapture(id)
      }
    }
    pointersRef.current.clear()
    gestureRef.current = null
    clearHold()
    downAtRef.current = null
    setLiveFor(null)
    touchFocusedRef.current = true
  }

  useEffect(() => {
    const el = elRef.current
    if (!el)
      return
    const handler = (e: WheelEvent) => {
      // Pinch/ctrl+wheel must never fall through to browser page zoom, even
      // when this pane has nothing to zoom (the stage forwards these here).
      if (e.ctrlKey || (leaf.photoId && iw && ih))
        e.preventDefault()
      // Pinching in (shrinking) on a pane without a photo: nothing to zoom,
      // so the pinch itself is the exit-to-grid gesture.
      if (!leaf.photoId && e.ctrlKey && e.deltaY > 0) {
        exitToGrid()
        return
      }
      if (!leaf.photoId || !iw || !ih)
        return
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0012))
      const nextZoom = leaf.zoom * factor
      // Ctrl+pinch that would shrink below MIN_ZOOM has hit the floor and is
      // still pushing out: zoom out all the way into the 3×3 grid instead of
      // clamping. Plain (non-ctrl) wheel is never an exit signal.
      if (e.ctrlKey && nextZoom <= MIN_ZOOM) {
        exitToGrid()
        return
      }
      const p = local(e.clientX, e.clientY)
      zoomAbout(leaf, nextZoom, p.x, p.y)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [leaf, iw, ih, local, zoomAbout, exitToGrid])

  const place = iw && ih ? placement(cell, leaf, iw, ih) : null
  // Feather the photo's seam edges (and the Live Photo video that replaces
  // it visually); stickers/labels stay sharp above it.
  const photoMask = seamMaskStyle(seam, seamFadeWidth(fade, cell))

  // The carried photo rides the pointer at roughly its pane size (capped).
  const ghostW = Math.min(rect.w, 180)
  const ghostH = iw ? (ghostW * ih) / iw : ghostW

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const b = elRef.current?.getBoundingClientRect()
      const lx = b ? clientX - b.left : 0
      const ly = b ? clientY - b.top : 0
      return { x: rect.x + lx, y: rect.y + ly }
    },
    [rect.x, rect.y],
  )

  const swapPhotos = useStore(s => s.swapPhotos)
  // A swap needs a target other than this pane: on desktop that's any right
  // click on an unfocused pane, on touch it's a long-press (focus was
  // deferred, so the previously focused pane is still the target).
  const focusId = useStore(s => activeWs(s).focusId)
  const swapTargetId = !focused && focusId && focusId !== leaf.id ? focusId : null

  const paneNode = (
    <div
      ref={elRef}
      data-pane-id={leaf.id}
      className={
        `group/pane absolute cursor-grab touch-none select-none overflow-hidden [contain:paint] ${
          focused
            ? ' z-1 cursor-grab'
            : ''
        }${leaf.photoId ? '' : ' bg-pane-bg bg-pane-empty'}`
      }
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: radius }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={() => leaf.photoId && onUpdate(leaf.id, { zoom: 1, cx: 0.5, cy: 0.5 })}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files'))
          return
        e.preventDefault()
        e.stopPropagation()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        const files = [...(e.dataTransfer?.files ?? [])]
        setDropping(false)
        if (!files.length)
          return
        e.preventDefault()
        e.stopPropagation()
        const s = useStore.getState()
        const created = s.addPhotos(files, false)
        if (!created.length)
          return
        // A pane with a photo asks what the dropped image should become.
        if (leaf.photoId) {
          const pt = place ? toCanvas(e.clientX, e.clientY) : null
          const at = pt && place ? photoNorm(place, pt.x, pt.y) : { x: 0.5, y: 0.5 }
          setDropChoice({ photos: created, at })
          return
        }
        const first = created[0]
        if (first)
          s.assign(leaf.id, first.id)
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <PanePhotoContent
        preview={preview}
        place={place}
        rect={rect}
        photoId={leaf.photoId}
        mask={photoMask}
      />

      {liveUrl && place && (
        <div className="absolute inset-0" style={photoMask}>
          <video
            ref={liveVideoRef}
            className={`absolute left-0 top-0 z-1 max-w-none bg-pane-bg object-cover opacity-0 pointer-events-none ${live ? ' opacity-100' : ''}`}
            src={liveUrl}
            style={{
              left: place.x - rect.x,
              top: place.y - rect.y,
              width: place.w,
              height: place.h,
            }}
            loop
            playsInline
            preload="auto"
            draggable={false}
          />
        </div>
      )}

      {photo?.videoFile && place && (
        <PaneLiveBadge playing={live} onToggle={() => setLivePin(live ? null : photo!.id)} />
      )}

      {place
        && leaf.stickers.map((st) => {
          const sp = st.photoId ? photoById.get(st.photoId) : undefined
          return sp
            ? (
                <StickerView
                  key={st.id}
                  paneId={leaf.id}
                  st={st}
                  photo={sp}
                  place={place}
                  paneRect={rect}
                  toCanvas={toCanvas}
                  onFocus={onFocus}
                />
              )
            : null
        })}

      {leaf.label && (
        <LabelView
          paneId={leaf.id}
          lab={leaf.label}
          unit={unit}
          editing={editing}
          setEditing={setEditing}
          elRef={elRef}
          onFocus={onFocus}
        />
      )}

      {/* The pane's only hover chrome: the split chip, faded in while the
          pointer is over the pane. A focused pane draws no chip here (its chip
          is in the page row), so the buttons never appear twice. */}
      {!focused && (
        <PaneSplitTools
          paneId={leaf.id}
          onSplit={onSplit}
          className="pointer-events-none absolute left-1/2 top-[9px] z-[3] -translate-x-1/2 opacity-0 transition-opacity duration-[140ms] group-hover/pane:pointer-events-auto group-hover/pane:opacity-100"
        />
      )}

      {dropChoice && (
        <div
          className="absolute inset-0 z-[5] flex items-center justify-center bg-overlay-dim"
          onClick={() => setDropChoice(null)}
          onPointerDown={e => e.stopPropagation()}
        >
          <div
            className="flex w-[min(190px,85%)] flex-col gap-[3px] rounded-none border border-line-strong bg-panel p-1 shadow-pop"
            onClick={e => e.stopPropagation()}
          >
            <button
              className={dropBtnCls}
              onClick={() => {
                const first = dropChoice.photos[0]
                if (first)
                  useStore.getState().assign(leaf.id, first.id)
                setDropChoice(null)
              }}
            >
              <MorphIcon icon={ImagePlus} size={13} strokeWidth={1.75} className="text-dim" />
              {t('Use as photo')}
            </button>
            <button
              className={dropBtnCls}
              onClick={() => {
                const s = useStore.getState()
                for (const ph of dropChoice.photos)
                  s.addSticker(leaf.id, ph.id, dropChoice.at.x, dropChoice.at.y)
                setDropChoice(null)
              }}
            >
              <MorphIcon icon={StickerIcon} size={13} strokeWidth={1.75} className="text-dim" />
              {t('Use as sticker')}
            </button>
          </div>
        </div>
      )}

      {/* The dragged-out photo follows the pointer in a portal above everything. */}
      {swapAt && preview && createPortal(
        <img
          src={preview.url}
          alt=""
          draggable={false}
          className="pointer-events-none fixed z-[80] block max-w-none opacity-95 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
          style={{
            left: swapAt.x,
            top: swapAt.y,
            width: ghostW,
            height: ghostH,
            borderRadius: radius,
            transform: 'translate(-50%, -55%)',
          }}
        />,
        document.body,
      )}

      {canClose && <PaneCloseTool paneId={leaf.id} focused={focused} onClose={onClose} />}

      {/* Drawn last so the pane border stays above its photo/stickers. */}
      <PaneOutline focused={focused} dropping={dropping} bordered={bordered} radius={radius} />
    </div>
  )

  // Every pane keeps its context menu mounted (right-click, or long-press on
  // touch); mounting it only on unfocused panes would let a touch's focus
  // change tear it down before the long-press fires.
  return (
    <ContextMenu.Root onOpenChange={onMenuOpenChange}>
      <ContextMenu.Trigger render={paneNode} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-90">
          <ContextMenu.Popup className="min-w-[180px] rounded-none border border-line-strong bg-panel p-1 shadow-pop outline-0 origin-[var(--transform-origin)] transition-[opacity,scale] duration-[160ms] ease-(--ease-out) data-ending-style:duration-[120ms] data-starting-style:opacity-0 data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:scale-[0.97]">
            <ContextMenu.Item className={menuItemCls} onClick={() => onSplit(leaf.id, 'column')}>
              <MorphIcon icon={SquareSplitVertical} size={13} strokeWidth={1.75} className="text-dim" />
              {t('Split top/bottom')}
            </ContextMenu.Item>
            <ContextMenu.Item className={menuItemCls} onClick={() => onSplit(leaf.id, 'row')}>
              <MorphIcon icon={SquareSplitHorizontal} size={13} strokeWidth={1.75} className="text-dim" />
              {t('Split left/right')}
            </ContextMenu.Item>
            {swapTargetId && (
              <>
                <ContextMenu.Separator className={menuSeparatorCls} />
                <ContextMenu.Item className={menuItemCls} onClick={() => swapPhotos(leaf.id, swapTargetId)}>
                  <MorphIcon icon={ArrowLeftRight} size={13} strokeWidth={1.75} className="text-dim" />
                  {t('Swap with focused pane')}
                </ContextMenu.Item>
              </>
            )}
            {canClose && (
              <>
                <ContextMenu.Separator className={menuSeparatorCls} />
                <ContextMenu.Item
                  className="flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-1.5 text-xs text-danger data-highlighted:bg-danger data-highlighted:text-on-accent"
                  onClick={() => onClose(leaf.id)}
                >
                  <MorphIcon icon={X} size={13} strokeWidth={1.75} />
                  {t('Close pane')}
                </ContextMenu.Item>
              </>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export const Pane = memo(PaneImpl)
