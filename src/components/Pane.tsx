import type { ContextMenu } from '@base-ui/react/context-menu'
import type { Photo, Preview } from '../lib/imageStore'
import type { Leaf, Rect, SeamSides } from '../lib/panes'
import { useNavigate } from '@tanstack/react-router'
import { ImagePlus, SquareSplitHorizontal, SquareSplitVertical, Sticker as StickerIcon, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useMediaQuery, usePanePreview, useToolsSheetTop } from '../hooks'
import { minimapStyles, minimapViewStyle, paintPanePhoto, paneBoxStyle, photoBoxStyle, transformOf } from '../lib/boardPaint'
import { viewScaleAt } from '../lib/canvasView'
import { overDeleteZone, setDeleteZone, useDeleteZone } from '../lib/deleteZone'
import { useT } from '../lib/i18n'
import { EASE_OUT_CSS } from '../lib/motionTokens'
import { pickPhotoForPane } from '../lib/paneCommands'
import { clampLeaf, cornerRadiiCss, isPaneTransformed, leafCornerRadii, paneTransform, paneTransformCss, photoNorm, placement, pressPlan, seamFadeWidth, seamMaskStyle } from '../lib/panes'
import { OVERVIEW_PATH } from '../lib/routes'
import { viewTransitionOption } from '../lib/viewTransition'
import { MAX_ZOOM, MIN_ZOOM, useStore } from '../store'
import { PaneMenu } from './PaneMenu'

/* One split button. The chip's height is the page row's (back / reset), so the
   same chip reads the same in the top row and inside a hovered pane. */
const splitBtnCls = 'grid w-[30px] cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-float-icon transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent pointer-coarse:w-[38px]'

const dropBtnCls = 'flex w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-none border-0 bg-transparent px-2.5 py-2 text-xs text-txt hover:bg-chip-hover active:bg-chip-on active:text-chip-on-txt'

// Holding a pane still this long arms a pane swap drag on touch. Desktop has
// no hold (a still mouse press must stay a pan), so it enters the same carried
// state from the context menu's Move item instead.
const SWAP_HOLD_MS = 500
/** When the last long-press hold or carry ended (see PanePhotoContent's picker). */
let lastCarryEndAt = 0
// Pointer movement that separates a hold from a drag: it cancels a pending
// arm (so a quick drag stays a pan) and starts the carry once the hold armed it.
const SWAP_SLOP = 5

interface Gesture {
  mode: 'pan' | 'pinch' | 'swap'
  lastX: number
  lastY: number
  startDist: number
  base: Leaf
}

// The pane's photo area: the placed preview once loaded, a placeholder note
// while the preview decodes, or the empty pane's own picker (replacing a
// filled pane's photo lives in the tools row, see Stage.tsx).
function PanePhotoContent({
  preview,
  transform,
  photoId,
  mask,
  radius,
  crossfade,
  onPick,
  carried,
  turn,
}: {
  preview: Preview | null
  /** The photo's placement, from `transformOf` (see lib/boardPaint). */
  transform: string | null
  photoId: string | null
  mask?: React.CSSProperties
  radius: number | string
  crossfade?: boolean
  onPick: () => void
  /** The photo is being carried as the swap/Move ghost: dim the original. */
  carried: boolean
  /** CSS for the pane's turn and mirrors; null while it is upright. */
  turn: string | null
}) {
  const t = useT()
  const img = preview && transform
    ? (
        <img
          src={preview.url}
          alt=""
          draggable={false}
          data-photo-img
          className="photo-in block max-w-none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transformOrigin: '0 0',
            transform,
            maxWidth: 'none',
          }}
        />
      )
    : null
  return preview && transform
    ? (
        // The mask wrapper spans the pane box, so the feather gradients line
        // up with the pane edges (the placed img itself overflows the pane).
        // It clips too, which is what the swap transition names (tagSwapClip).
        // Carried: fade, don't hide, so the ghost reads as lifted from here.
        <div
          data-photo-clip=""
          className={`absolute inset-0 overflow-hidden transition-opacity duration-(--dur-surface) ${carried ? ' opacity-25' : ''}`}
          style={{
            ...mask,
            borderRadius: radius,
            mixBlendMode: crossfade && mask ? 'plus-lighter' : undefined,
          }}
        >
          {/* The pane's turn and mirrors ride one layer inside the clip, so
              the pane box (and its radius, mask and feather) stays square:
              only the photo turns, exactly as the exporter turns it. */}
          {turn
            ? <div className="absolute inset-0" style={{ transform: turn }}>{img}</div>
            : img}
        </div>
      )
    : photoId
      ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-pane-hint">{t('Loading...')}</div>
        )
      : (
          // An empty pane is all picker: this transparent button covers the
          // pane, so a click anywhere opens the file picker. The centered
          // glyph over the label is the hint, not a widget of its own, and
          // stays in the neutral gray. Pointerdown bubbles: the pane still
          // focuses on the click.
          <button
            className="absolute inset-0 grid cursor-pointer place-items-center border-0 bg-transparent p-0 transition-colors duration-(--dur-fast) active:bg-chip-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent"
            title={t('Choose a photo')}
            aria-label={t('Choose a photo')}
            onClick={(e) => {
              e.stopPropagation()
              if (Date.now() - lastCarryEndAt > 400)
                onPick()
            }}
          >
            <span className="pointer-events-none flex flex-col items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold text-dim">
              <MorphIcon icon={ImagePlus} size={22} strokeWidth={1.75} />
              {t('Choose a photo')}
            </span>
          </button>
        )
}

/**
 * The two split buttons for one pane, drawn as a single chip. Hovering a pane
 * fades it in at that pane's top center, focused or not, from lg up; below lg
 * the split lives in the focused pane's tools dock (Stage.tsx) instead.
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
    // Placement and visibility belong to the caller: the page row keeps this
    // chip on every width, the hover copy is dropped below sm.
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

/**
 * The chip's inset inside the photo. 20px, not the 8px the corner alone needs:
 * the canvas resize handle sits 15px inside the canvas corner (`Stage.tsx`), so
 * an 8px chip would share the corner with it and lose the hit test to it. 20px
 * clears the handle by 5px at every width and pane size.
 */
const MINIMAP_INSET = 'p-5'

/**
 * The focused pane's minimap: the app's floating chip (float-bg + blur),
 * pinned INSIDE the photo at its bottom-right corner once the photo overflows
 * the pane. It is the only zoom chrome left on a pane: the photo's own zoom is
 * the wheel / pinch gesture and the dock's Fit commands, and a pair of +/-
 * buttons next to it only repeated them.
 *
 * The corner is the placed photo's own rect (`lib/panes.placement`) clipped to
 * the pane, not the pane's corner: a zoomed-out photo pulls the chip in with
 * it, and the inset keeps it clear of the pane's edge, so it can never land on
 * a divider or a neighbour's photo. The tools sheet is a fixed overlay with no
 * put-away state, and a tall canvas keeps running underneath it, so the box
 * also stops at the sheet's top edge and the chip lifts itself over the sheet
 * instead of living behind its glass.
 *
 * Quiet while the photo is the subject (0.7, 0.9 for a finger, which has no
 * hover to confirm the control exists) and full weight under the pointer, so
 * busy photo content never swallows it.
 */
function PaneMinimap({
  paneEl,
  leaf,
  cell,
  rect,
  iw,
  ih,
  previewUrl,
  onPan,
}: {
  paneEl: React.RefObject<HTMLDivElement | null>
  leaf: Leaf
  /** The layout cell the photo is placed against. */
  cell: Rect
  /** The pane's own rect, in canvas coordinates. */
  rect: Rect
  iw: number
  ih: number
  /** The pane's own preview URL (filter baked), for the minimap thumbnail. */
  previewUrl: string | undefined
  /** Grab-pan to a photo fraction, through the pane's clamped commit. */
  onPan: (cx: number, cy: number) => void
}) {
  const t = useT()
  const sheetTop = useToolsSheetTop()
  const coarse = useMediaQuery('(pointer: coarse)')
  // A finger gets no hover to confirm the control exists, so the chip rests
  // brighter; a mouse leaves it quiet until the pointer arrives.
  const rest = coarse ? 'opacity-90' : 'opacity-70'
  // The pane's viewport top, for comparing the sheet's edge (viewport px) with
  // the pane-local box. Measured, not derived, and kept fresh by observation
  // rather than by every commit: a pan inside the pane moves neither box.
  const [paneTop, setPaneTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = paneEl.current
    if (!el)
      return
    // The pane moves only when the layout does (a split, a ratio drag, the
    // canvas refit on a window resize), never on a pan inside it, so a size
    // observer plus a window resize is the whole signal.
    const read = () => {
      const next = el.getBoundingClientRect().top
      setPaneTop(prev => (prev != null && Math.abs(prev - next) < 0.5 ? prev : next))
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    window.addEventListener('resize', read)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', read)
    }
  }, [paneEl])

  // The photo's visible part clipped to the pane, and to the room the tools
  // sheet leaves. The math lives in `boardPaint`, so a divider drag paints the
  // same box through `paintPanePhoto`.
  const sheetLimit = sheetTop == null || paneTop == null ? undefined : sheetTop - paneTop

  // The minimap appears once the photo overflows the pane (zoom above
  // ~1.05) and the visible box is wide enough to seat it. The viewport
  // rect is the pane's window as photo fractions: placement inverted.
  // Dragging feeds cx/cy through the pane's clamped commit, so the pan
  // path's coalescing and undo carry.
  const minimap = useMemo(() => {
    const MINIMAP_ZOOM = 1.05
    const { box, view } = minimapStyles(cell, rect, leaf, iw, ih, sheetLimit)
    if (leaf.zoom <= MINIMAP_ZOOM || box.width < 260 || !previewUrl)
      return null
    const frame = coarse ? 'h-[44px] w-[58px]' : 'h-[40px] w-[52px]'
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      // The grab point in photo fractions, keeping the drag's start offset from
      // the viewport centre so a drag carries the view instead of jumping. Both
      // reads are ratios against the chip's measured box, so they hold under the
      // canvas view zoom as well.
      const start = el.getBoundingClientRect()
      const grab = {
        u: view.x + view.w / 2 - (e.clientX - start.left) / start.width,
        v: view.y + view.h / 2 - (e.clientY - start.top) / start.height,
      }
      const move = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const u = (ev.clientX - r.left) / r.width + grab.u
        const v = (ev.clientY - r.top) / r.height + grab.v
        onPan(u, v)
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
      // A plain click (no move) centres on the point: the same handler with
      // the grab offset zeroed would jump; instead treat click as recenter.
      const wasDrag = { moved: false }
      const track = () => {
        wasDrag.moved = true
      }
      el.addEventListener('pointermove', track, { once: true })
      el.addEventListener('pointerup', () => {
        if (!wasDrag.moved) {
          const r = el.getBoundingClientRect()
          onPan((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
        }
      }, { once: true })
    }
    return { frame, box, view, onPointerDown }
  }, [leaf, cell, rect, iw, ih, sheetLimit, previewUrl, onPan, coarse])

  // Nothing to show while the photo fits the pane: the chip appears with the
  // overflow it exists to navigate.
  if (!minimap)
    return null

  return (
    <div
      data-pane-minimap-box=""
      className={`pointer-events-none absolute z-[3] flex items-end justify-end transition-opacity duration-(--dur-fast) hover:opacity-100 focus-within:opacity-100 ${MINIMAP_INSET} ${rest}`}
      style={minimap.box}
    >
      <div
        data-pane-minimap-chip=""
        className="pointer-events-auto flex drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
        // A double click on the chip must not reach the pane's own
        // double-click (reset the view): the chip is not the photo.
        onDoubleClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        <div
          data-pane-minimap=""
          aria-label={t('Photo minimap, drag to pan')}
          title={t('Photo minimap, drag to pan')}
          className={`relative cursor-grab overflow-hidden bg-float-bg ${minimap.frame}`}
          style={{ aspectRatio: `${iw} / ${ih}` }}
          onPointerDown={minimap.onPointerDown}
        >
          {previewUrl && (
            <img
              src={previewUrl}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div
            data-pane-minimap-viewport=""
            className="pointer-events-none absolute border-[1.5px] border-accent outline-1 outline-white/70 bg-accent/15"
            style={minimapViewStyle(minimap.view)}
          />
        </div>
      </div>
    </div>
  )
}

function PaneLiveBadge({ playing, onToggle }: { playing: boolean, onToggle: () => void }) {
  const t = useT()
  return (
    <button
      className={`absolute left-[9px] top-[9px] z-[3] flex cursor-pointer items-center gap-[5px] rounded-none border border-float-line bg-float-bg py-[3px] pl-1.5 pr-[7px] text-[9px] font-bold tracking-[0.09em] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] backdrop-blur-[7px] hover:bg-chip-hover ${
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

/* A cancelled carry's ghost gliding back onto the dimmed original. Mounted for
   the length of the flight and removed by `onDone`, so no cleanup state lingers. */
function SwapGhostReturn({
  from,
  to,
  src,
  width,
  height,
  radius,
  onDone,
}: {
  from: { x: number, y: number }
  to: { x: number, y: number }
  src: string
  width: number
  height: number
  radius: number
  onDone: () => void
}) {
  const elRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = elRef.current
    if (!el) {
      onDone()
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone()
      return
    }
    // The shared `--ease-out` curve (lib/motionTokens); WAAPI cannot read CSS
    // vars in `easing`, so it comes in as the spelled-out string.
    const anim = el.animate(
      [
        { transform: `translate3d(${from.x}px, ${from.y}px, 0)`, opacity: 0.95 },
        { transform: `translate3d(${to.x}px, ${to.y}px, 0)`, opacity: 0 },
      ],
      { duration: 200, easing: EASE_OUT_CSS, fill: 'forwards' },
    )
    anim.onfinish = onDone
    return () => {
      anim.cancel()
    }
  }, [from.x, from.y, to.x, to.y, onDone])
  return (
    <div
      ref={elRef}
      className="pointer-events-none fixed left-0 top-0 z-[80]"
      // The initial transform prevents a first-frame flash at 0,0 before the
      // animation starts.
      style={{ transform: `translate3d(${from.x}px, ${from.y}px, 0)` }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none block max-w-none opacity-95 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
        style={{
          width,
          height,
          borderRadius: radius,
          transform: 'translate(-50%, -55%)',
        }}
      />
    </div>
  )
}

/* The viewport point a cancelled carry lands on: the center of the dimmed
   original photo. `place` is canvas-space, so subtract the pane's canvas origin
   and add the pane's viewport origin. A top-level helper keeps the ternaries out
   of PaneImpl, whose cognitive-complexity budget is already tight. */
function swapReturnLanding(
  returnFrom: { x: number, y: number } | null,
  place: ReturnType<typeof placement> | null,
  rect: Rect,
  el: HTMLElement | null,
): { x: number, y: number } | null {
  if (!returnFrom || !place)
    return null
  const box = el?.getBoundingClientRect()
  if (!box)
    return null
  // The ghost is a fixed-position layer, so its landing point is in screen
  // pixels: the pane-local offset scales by the canvas view zoom.
  const s = viewScaleAt(el)
  return {
    x: box.left + (place.x - rect.x + place.w / 2) * s,
    y: box.top + (place.y - rect.y + place.h / 2) * s,
  }
}

/*
 * The two named roles a photo takes while it crosses panes: src is the photo
 * leaving the source pane, dst the one leaving the target. The names let the
 * View Transition API pair each photo's old and new snapshots, so the swap
 * glides instead of teleporting.
 */
const SWAP_SRC_NAME = 'pane-swap-src'
const SWAP_DST_NAME = 'pane-swap-dst'

/* Tag the clip wrapper, never the img: an element is snapshotted at its own
   box, so naming the img (laid out at full pixel size) glided the whole image
   over the neighbouring panes, while the wrapper snapshots the pane's crop.
   Query fresh: the commit re-renders the panes. */
function tagSwapClip(paneId: string, name: string): HTMLElement | null {
  const clip = document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"] [data-photo-clip]`)
  if (clip)
    clip.style.viewTransitionName = name
  return clip
}

/**
 * Commit a pane swap, gliding the two photos across panes through the View
 * Transition API when it is available and motion is welcome. `apply` performs
 * the store write that moves them; it runs inside a flushSync so the ghost
 * unmount and the photo move land in one commit, giving the transition a single
 * old and new snapshot. Reduced motion or a missing API keeps today's
 * synchronous swap.
 */
function runSwapTransition(sourceId: string, targetId: string, apply: () => void) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply()
    return
  }
  // The old snapshot has to carry the names, so set them before the capture.
  const tagged = new Set<HTMLElement>()
  const tag = (paneId: string, name: string) => {
    const clip = tagSwapClip(paneId, name)
    if (clip)
      tagged.add(clip)
  }
  tag(sourceId, SWAP_SRC_NAME)
  tag(targetId, SWAP_DST_NAME)
  const vt = document.startViewTransition(() => {
    // The new snapshot is captured the instant this callback returns, so the
    // DOM must already match the store; flushSync forces that.
    // eslint-disable-next-line react/dom-no-flush-sync -- DOM must match the store before the new snapshot is captured
    flushSync(apply)
    // Each photo keeps its name in its new pane: the one now in the target
    // pairs with the old source snapshot, and vice versa, so both morph.
    tag(targetId, SWAP_SRC_NAME)
    tag(sourceId, SWAP_DST_NAME)
  })
  // Drop the names once the morph is done so they never clash with the grid's
  // ws-<id> morphs; an interrupted transition rejects, hence the catch.
  void vt.finished.finally(() => {
    for (const el of tagged)
      el.style.viewTransitionName = ''
  }).catch(() => {})
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
      className={`absolute right-[9px] top-[9px] z-[3] grid h-[22px] w-[22px] cursor-pointer place-items-center rounded-none border-0 bg-transparent p-0 text-[15px] leading-none text-float-icon transition-[opacity,color,scale] duration-(--dur-fast) active:scale-[0.97] drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:text-danger focus-visible:opacity-100 pointer-coarse:h-[30px] pointer-coarse:w-[30px] ${
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
  radius: number | string
}) {
  return (
    <div
      aria-hidden
      className={
        `pointer-events-none absolute inset-0 z-[4] outline-1 -outline-offset-1 transition-[outline-color] duration-(--dur-fast) ease-(--ease-out) ${
          focused || dropping ? 'outline-txt' : bordered ? 'outline-line' : 'outline-transparent'
        }${dropping ? ' outline-dashed' : ''}`
      }
      style={{ borderRadius: radius }}
    />
  )
}

interface Props {
  leaf: Leaf
  /** Visual box (expanded into seams when crossfade is on). */
  rect: Rect
  /** Pre-overlap layout cell for photo placement; defaults to `rect`. */
  layoutRect?: Rect
  /** When true, seam masks use plus-lighter compositing. */
  crossfade?: boolean
  radius: number
  gap: number
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

/* The Live Photo video layer plus its play badge, drawn together because they
   share the pane's mask and playback flag. */
function PaneLivePhoto({
  photo,
  box,
  mask,
  crossfade,
  live,
  turn,
  videoRef,
  onToggle,
}: {
  photo: Photo | null
  /** The placed photo's box in pane-local px (see `photoBoxStyle`). */
  box: { left: number, top: number, width: number, height: number }
  mask?: React.CSSProperties
  crossfade?: boolean
  live: boolean
  /** The pane's turn and mirrors, so the video plays in the photo's frame. */
  turn: string | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  onToggle: () => void
}) {
  const file = photo?.videoFile ?? null
  // The video element owns its own object URL: minted when the paired file
  // arrives, released when it changes or the pane goes away.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !file)
      return
    const url = URL.createObjectURL(file)
    el.src = url
    return () => {
      el.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [file, videoRef])
  if (!file)
    return null
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          ...mask,
          mixBlendMode: crossfade && mask ? 'plus-lighter' : undefined,
        }}
      >
        {/* The peek plays muted: the export's own recording is silent too (a
            canvas capture carries no audio), and a silent layer is allowed to
            start without waiting on the browser's audio permission. */}
        <div className="absolute inset-0" style={{ transform: turn ?? undefined }}>
          <video
            ref={videoRef}
            data-live-video=""
            className={`absolute left-0 top-0 z-1 max-w-none bg-pane-bg object-cover opacity-0 pointer-events-none ${live ? ' opacity-100' : ''}`}
            style={box}
            muted
            loop
            playsInline
            preload="auto"
            draggable={false}
          />
        </div>
      </div>
      <PaneLiveBadge playing={live} onToggle={onToggle} />
    </>
  )
}

/* The drop-choice overlay: a full-pane dismiss button under the panel, so the
   backdrop is a real control (keyboard reachable) and the panel's own clicks
   stay inside it. */
function DropChoiceOverlay({
  paneId,
  photos,
  onClose,
}: {
  paneId: string
  photos: Photo[]
  at?: { x: number, y: number }
  onClose: () => void
}) {
  const t = useT()
  return (
    <div className="absolute inset-0 z-[5] flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-overlay-dim"
        aria-label={t('Close')}
        onClick={onClose}
        onPointerDown={e => e.stopPropagation()}
      />
      <div
        className="relative flex w-[min(190px,85%)] flex-col gap-[3px] rounded-none border border-line-strong bg-panel p-1 shadow-pop"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        <button
          className={dropBtnCls}
          onClick={() => {
            const first = photos[0]
            if (first)
              useStore.getState().assign(paneId, first.id)
            onClose()
          }}
        >
          <MorphIcon icon={ImagePlus} size={13} strokeWidth={1.75} className="text-dim" />
          {t('Use as photo')}
        </button>
        <button
          className={dropBtnCls}
          onClick={() => {
            const s = useStore.getState()
            for (const [i, ph] of photos.entries())
              s.addSticker(ph.id, Math.min(0.8, 0.5 + i * 0.06), Math.min(0.8, 0.5 + i * 0.06))
            onClose()
          }}
        >
          <MorphIcon icon={StickerIcon} size={13} strokeWidth={1.75} className="text-dim" />
          {t('Use as sticker')}
        </button>
      </div>
    </div>
  )
}

/* The dragged-out photo following the pointer in a portal above everything.
   The wrapper takes the pointer position as a transform (compositor-only, so a
   move writes no layout) and the img centers on it and pops in. */
function SwapGhost({
  at,
  preview,
  width,
  height,
  radius,
}: {
  at: { x: number, y: number } | null
  preview: Preview | null
  width: number
  height: number
  radius: number
}) {
  if (!at)
    return null
  return createPortal(
    <div
      className="pointer-events-none fixed left-0 top-0 z-[80]"
      style={{ transform: `translate3d(${at.x}px, ${at.y}px, 0)` }}
    >
      {preview
        ? (
            <img
              src={preview.url}
              alt=""
              draggable={false}
              className="pointer-events-none block swap-ghost max-w-none opacity-95 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
              style={{ width, height, borderRadius: radius, transform: 'translate(-50%, -55%)' }}
            />
          )
        : (
            // An empty pane carries as its own blank tile.
            <div
              className="pointer-events-none block swap-ghost bg-pane-bg bg-pane-empty opacity-95 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
              style={{ width, height, borderRadius: radius, transform: 'translate(-50%, -55%)' }}
            />
          )}
    </div>,
    document.body,
  )
}

/* A cancelled carry gliding back onto the dimmed original. */
function SwapReturnPortal({
  from,
  preview,
  to,
  width,
  height,
  radius,
  onDone,
}: {
  from: { x: number, y: number } | null
  preview: Preview | null
  to: { x: number, y: number } | null
  width: number
  height: number
  radius: number
  onDone: () => void
}) {
  if (!from || !preview || !to)
    return null
  return createPortal(
    <SwapGhostReturn from={from} to={to} src={preview.url} width={width} height={height} radius={radius} onDone={onDone} />,
    document.body,
  )
}

/* Move mode: one full-screen catcher so the next click drops the carried photo
   wherever it lands (source and empty space drop it back). The portal lives in
   the pane's React tree, so events must not bubble on to the pane's own
   handlers (or Base UI would reopen the menu). */
function MoveCatcher({
  active,
  onMove,
  onDrop,
  onCancel,
}: {
  active: boolean
  onMove: (x: number, y: number) => void
  onDrop: (x: number, y: number) => void
  onCancel: () => void
}) {
  if (!active)
    return null
  return createPortal(
    <div
      className="fixed inset-0 z-[70] cursor-grabbing touch-none select-none"
      onPointerMove={(e) => {
        e.stopPropagation()
        onMove(e.clientX, e.clientY)
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (e.button !== 0)
          return
        onDrop(e.clientX, e.clientY)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }}
    />,
    document.body,
  )
}

/**
 * The leaf a zoom about a canvas point lands on: the scale clamped to the
 * pane's range, then the centre moved so the point under the cursor stays put.
 * Pure, and the one place the math lives, so the wheel, the pinch and the
 * minimap cannot disagree about where a zoom ends up.
 */
function zoomLeaf(base: Leaf, cell: Rect, iw: number, ih: number, nextZoom: number, mx: number, my: number): Leaf {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  const before = placement(cell, base, iw, ih)
  const u = (mx - before.x) / before.w
  const v = (my - before.y) / before.h
  const after = placement(cell, { ...base, zoom }, iw, ih)
  const tx = mx - u * after.w
  const ty = my - v * after.h
  return { ...base, zoom, cx: (cell.w / 2 - tx) / after.w, cy: (cell.h / 2 - ty) / after.h }
}

/* The pane's viewport math: pointer-local coords, the clamped commit, and zoom
   about an anchor. Split out so the gesture hook below stays about events, not
   about the transform. */
function usePaneViewport({
  leaf,
  cell,
  iw,
  ih,
  elRef,
  onUpdate,
}: {
  leaf: Leaf
  cell: Rect
  iw: number
  ih: number
  elRef: React.RefObject<HTMLDivElement | null>
  onUpdate: (id: string, patch: Partial<Leaf>) => void
}) {
  const local = useCallback((cx: number, cy: number) => {
    const r = elRef.current?.getBoundingClientRect()
    if (!r)
      return { x: 0, y: 0 }
    // The canvas may carry the view zoom: its client rect is in screen pixels,
    // the gesture math wants the pane's own.
    const s = viewScaleAt(elRef.current)
    return { x: (cx - r.left) / s, y: (cy - r.top) / s }
  }, [elRef])

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
      commit(zoomLeaf(base, cell, iw, ih, nextZoom, mx, my))
    },
    [iw, ih, commit, cell],
  )

  return { local, commit, zoomAbout }
}

/* Everything the pointer-gesture helpers below need, in one bag: the pane's
   live values, the refs the machine reads and writes, and the setters it
   calls. Built once per render by usePaneGestures. */
interface PaneGestureRuntime {
  paneId: string
  leaf: Leaf
  cell: Rect
  /** The pane's drawn box: `paintLeaf` offsets the photo transform by it. */
  drawRect: Rect
  /** What this gesture painted but has not committed; null when it has none. */
  draftRef: React.RefObject<Leaf | null>
  iw: number
  ih: number
  photo: Photo | null
  hasLiveVideo: boolean
  elRef: React.RefObject<HTMLDivElement | null>
  pointersRef: React.RefObject<Map<number, { x: number, y: number }>>
  gestureRef: React.RefObject<Gesture | null>
  touchPressRef: React.RefObject<boolean>
  downAtRef: React.RefObject<{ x: number, y: number } | null>
  swapArmedRef: React.RefObject<boolean>
  swapHoldRef: React.RefObject<number | null>
  overRef: React.RefObject<HTMLElement | null>
  swapAtRef: React.RefObject<{ x: number, y: number } | null>
  holdTimerRef: React.RefObject<number | null>
  onFocus: (id: string) => void
  local: (cx: number, cy: number) => { x: number, y: number }
  commit: (next: Leaf) => void
  zoomAbout: (base: Leaf, nextZoom: number, mx: number, my: number) => void
  exitToGrid: () => void
  clearHold: () => void
  clearSwapHold: () => void
  setSwapAt: (v: { x: number, y: number } | null) => void
  setSwapArmed: (v: boolean) => void
  setSwapReturn: (v: { x: number, y: number } | null) => void
  setLiveFor: (v: string | null) => void
  setMoving: (v: boolean) => void
}

/** The placement the pane is showing: the gesture's draft first, then the tree. */
function currentLeaf(rt: { leaf: Leaf, draftRef: React.RefObject<Leaf | null> }): Leaf {
  return rt.draftRef.current ?? rt.leaf
}

/**
 * Put a leaf's placement straight on the pane's DOM: the photo's transform,
 * and the minimap's two boxes when it is showing.
 *
 * Panning is the app's most common gesture, and a store commit per pointermove
 * made one image move by a few pixels re-render the board, the dock and the
 * canvas menu. On a phone that was the whole frame budget. The gesture paints
 * here instead and commits once, on release (see `flushDraft`).
 */
function paintLeaf(rt: PaneGestureRuntime, leaf: Leaf) {
  paintPanePhoto(
    rt.elRef.current,
    { leaf, rect: rt.cell, draw: rt.drawRect, fade: 0, seam: undefined },
    rt.iw,
    rt.ih,
  )
}

/** Paint the placement and keep it as the value this gesture is carrying. */
function paintDraft(rt: PaneGestureRuntime, leaf: Leaf) {
  rt.draftRef.current = leaf
  paintLeaf(rt, leaf)
}

/**
 * Commit what the gesture painted: one store update, and one undo step (the
 * stream of a drag coalesces in `lib/history`). A tap that painted nothing
 * commits nothing.
 */
function flushDraft(rt: PaneGestureRuntime) {
  const draft = rt.draftRef.current
  if (!draft)
    return
  rt.draftRef.current = null
  rt.commit(draft)
}

/** The slice a swap drop needs, so endSwapDrag can stay a stable callback. */
interface SwapDropCtx {
  paneId: string
  overRef: React.RefObject<HTMLElement | null>
  swapAtRef: React.RefObject<{ x: number, y: number } | null>
  setSwapAt: (v: { x: number, y: number } | null) => void
  setSwapReturn: (v: { x: number, y: number } | null) => void
}

/** The pane shell's class: focus and emptiness are the only things that vary. */
function paneShellClass(focused: boolean, hasPhoto: boolean): string {
  return `group/pane absolute cursor-grab touch-none select-none ${
    focused ? ' z-1 cursor-grab' : ''
  }${hasPhoto ? '' : ' bg-pane-bg bg-pane-empty'}`
}

function clearSwapOverEl(overRef: React.RefObject<HTMLElement | null>) {
  if (overRef.current) {
    delete overRef.current.dataset.swapOver
    overRef.current = null
  }
}

/**
 * Highlight the pane a carried photo is over, ticking the motor on each new
 * target. `elements`, not `element`: the Move overlay covers the stage, so the
 * target has to be the topmost pane below it.
 */
function swapOverAtEl(rt: PaneGestureRuntime, x: number, y: number) {
  const el = document.elementsFromPoint(x, y)
    .map(n => n.closest<HTMLElement>('[data-pane-id]'))
    .find(n => n != null) ?? null
  // The delete strip under the top bar wins over any pane beneath it.
  const onZone = overDeleteZone(x, y)
  setDeleteZone(true, onZone)
  const target = !onZone && el && el.dataset.paneId !== rt.paneId ? el : null
  if (rt.overRef.current !== target) {
    clearSwapOverEl(rt.overRef)
    if (target) {
      target.dataset.swapOver = '1'
      rt.overRef.current = target
      navigator.vibrate?.(5)
    }
  }
}

/**
 * Drop or cancel a carry. Only a drop that found a different pane commits the
 * swap; anything else (empty space, the source pane, pointercancel, Escape)
 * flies the ghost home.
 */
function finishSwapDrag(rt: SwapDropCtx, commit: boolean) {
  const targetId = rt.overRef.current?.dataset.paneId
  const toDelete = useDeleteZone.getState().over
  setDeleteZone(false)
  clearSwapOverEl(rt.overRef)
  document.body.style.cursor = ''
  if (commit && toDelete) {
    navigator.vibrate?.(10)
    rt.setSwapAt(null)
    useStore.getState().deletePane(rt.paneId)
    return
  }
  if (commit && targetId) {
    navigator.vibrate?.(10)
    const sourceId = rt.paneId
    runSwapTransition(sourceId, targetId, () => {
      rt.setSwapAt(null)
      const s = useStore.getState()
      s.swapPhotos(sourceId, targetId)
      s.focus(targetId)
    })
    return
  }
  // Read the last ghost point from the ref mirror so a cancel seeds the
  // fly-home animation.
  const at = rt.swapAtRef.current
  if (at)
    rt.setSwapReturn(at)
  rt.setSwapAt(null)
}

/** The armed hold became a drag: carry the photo as a ghost from now on. */
function beginSwapDrag(rt: PaneGestureRuntime, x: number, y: number) {
  rt.clearHold()
  rt.clearSwapHold()
  rt.swapArmedRef.current = false
  rt.setSwapArmed(false)
  rt.downAtRef.current = null
  rt.setLiveFor(null)
  rt.gestureRef.current = { mode: 'swap', lastX: 0, lastY: 0, startDist: 0, base: { ...rt.leaf } }
  document.body.style.cursor = 'grabbing'
  rt.setSwapAt({ x, y })
  swapOverAtEl(rt, x, y)
}

/**
 * Move mode (the context menu item): the photo follows the pointer with no
 * button held, and the next click drops it on the pane underneath.
 */
function startMovePane(rt: PaneGestureRuntime, x: number, y: number) {
  rt.setMoving(true)
  rt.setSwapAt({ x, y })
  swapOverAtEl(rt, x, y)
}

/**
 * Single-pointer pan. A touch held still (see SWAP_HOLD_MS) armed the swap:
 * the first movement after that starts carrying the photo, so a drag that
 * began as a hold never pans halfway through.
 */
function panPane(rt: PaneGestureRuntime, e: React.PointerEvent, g: Gesture) {
  const p = rt.local(e.clientX, e.clientY)
  const moved = rt.downAtRef.current
    ? Math.hypot(e.clientX - rt.downAtRef.current.x, e.clientY - rt.downAtRef.current.y)
    : 0
  if (rt.swapArmedRef.current) {
    if (moved > SWAP_SLOP)
      beginSwapDrag(rt, e.clientX, e.clientY)
    return
  }
  // Moving means panning, not holding: drop the Live Photo timer and the
  // pending swap arm before they fire.
  if (moved > SWAP_SLOP) {
    rt.clearHold()
    rt.clearSwapHold()
  }
  // Nothing placed to pan (an empty pane, or a photo still decoding).
  if (!rt.iw || !rt.ih)
    return
  const base = currentLeaf(rt)
  const dx = p.x - g.lastX
  const dy = p.y - g.lastY
  g.lastX = p.x
  g.lastY = p.y
  const pl = placement(rt.cell, base, rt.iw, rt.ih)
  const next = { ...base, cx: base.cx - dx / pl.w, cy: base.cy - dy / pl.h }
  paintDraft(rt, clampLeaf(next, rt.cell, rt.iw, rt.ih))
}

/** Start the touch hold that arms the carry (see SWAP_HOLD_MS). */
function armSwapHold(rt: PaneGestureRuntime) {
  // The ring wipes in while the hold runs (see [data-swap-hold] in
  // index.css); clearSwapHold retracts it on every cancel path.
  if (rt.elRef.current)
    rt.elRef.current.dataset.swapHold = '1'
  rt.swapHoldRef.current = window.setTimeout(() => {
    rt.swapHoldRef.current = null
    // The hold completed: the ring has nothing left to show and the armed
    // lift takes over. This path bypasses clearSwapHold.
    delete rt.elRef.current?.dataset.swapHold
    rt.swapArmedRef.current = true
    // The arm is otherwise invisible: tick the motor and lift the pane so
    // the user learns the hold registered (vibrate is a no-op where
    // unsupported, iOS Safari included).
    rt.setSwapArmed(true)
    navigator.vibrate?.(10)
  }, SWAP_HOLD_MS)
}

function beginPointer(rt: PaneGestureRuntime, e: React.PointerEvent) {
  // Only the primary button focuses or starts a gesture. A right-click must
  // leave focus alone so the menu's swap item can target the focused pane.
  if (e.button !== 0)
    return
  // A second pointer while carrying a photo out must not start a new gesture.
  if (rt.gestureRef.current?.mode === 'swap')
    return
  rt.onFocus(rt.paneId)
  useStore.getState().selectLabel(null)
  const plan = pressPlan(!!rt.leaf.photoId, e.pointerType)
  // A mouse on an empty pane has nothing to pan or arm: leave it to the click.
  if (!plan.pan && !plan.armHold)
    return
  // An empty pane has nothing to pinch: a second finger is ignored.
  if (!plan.pan && rt.pointersRef.current.size >= 1)
    return
  const el = rt.elRef.current
  if (plan.capture) {
    el?.setPointerCapture(e.pointerId)
    // The gesture rewrites the placed photo's transform on every move frame;
    // the compositor hint rides its lifetime (see [data-gesture] in index.css).
    if (el)
      el.dataset.gesture = '1'
  }
  rt.pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const p = rt.local(e.clientX, e.clientY)
  if (rt.pointersRef.current.size >= 2) {
    rt.clearHold()
    rt.clearSwapHold()
    rt.swapArmedRef.current = false
    rt.setSwapArmed(false)
    const [a, b] = [...rt.pointersRef.current.values()]
    rt.gestureRef.current = {
      mode: 'pinch',
      lastX: 0,
      lastY: 0,
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      base: { ...currentLeaf(rt) },
    }
  }
  else {
    rt.gestureRef.current = { mode: 'pan', lastX: p.x, lastY: p.y, startDist: 0, base: { ...rt.leaf } }
    rt.downAtRef.current = { x: e.clientX, y: e.clientY }
    if (plan.armHold)
      armSwapHold(rt)
    if (rt.hasLiveVideo) {
      rt.holdTimerRef.current = window.setTimeout(() => {
        rt.holdTimerRef.current = null
        rt.setLiveFor(rt.photo?.id ?? null)
      }, 320)
    }
  }
}

function movePointer(rt: PaneGestureRuntime, e: React.PointerEvent) {
  if (!rt.pointersRef.current.has(e.pointerId))
    return
  rt.pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  const g = rt.gestureRef.current
  if (!g)
    return

  if (g.mode === 'pan' && rt.pointersRef.current.size === 1) {
    panPane(rt, e, g)
    return
  }
  if (g.mode === 'swap' && rt.pointersRef.current.size === 1) {
    rt.setSwapAt({ x: e.clientX, y: e.clientY })
    swapOverAtEl(rt, e.clientX, e.clientY)
    return
  }
  if (g.mode === 'pinch' && rt.pointersRef.current.size >= 2 && rt.iw && rt.ih) {
    const [a, b] = [...rt.pointersRef.current.values()]
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    const mid = rt.local((a.x + b.x) / 2, (a.y + b.y) / 2)
    const ratio = dist / g.startDist
    // "Pinch past the floor": zoomAbout clamps to MIN_ZOOM, so judge the raw
    // ratio: shrinking an already-minimum photo out of the pane is the
    // explicit exit-to-grid gesture, and it must not commit a zoom either.
    if (g.base.zoom * ratio <= MIN_ZOOM && ratio < 1) {
      // The pinch out is the exit: keep the view it painted, then leave.
      flushDraft(rt)
      rt.exitToGrid()
      return
    }
    const zoomed = zoomLeaf(g.base, rt.cell, rt.iw, rt.ih, g.base.zoom * ratio, mid.x, mid.y)
    paintDraft(rt, clampLeaf(zoomed, rt.cell, rt.iw, rt.ih))
  }
}

function endPointer(rt: PaneGestureRuntime, e: React.PointerEvent) {
  const g = rt.gestureRef.current
  rt.pointersRef.current.delete(e.pointerId)
  if (rt.pointersRef.current.size === 0) {
    // A hold that armed or carried is not a tap: the empty pane's picker
    // button must not open on the click that follows the release.
    if (rt.swapArmedRef.current || g?.mode === 'swap')
      lastCarryEndAt = Date.now()
    rt.gestureRef.current = null
    // What the gesture painted becomes the board: one update, one undo step.
    flushDraft(rt)
    rt.clearHold()
    rt.clearSwapHold()
    rt.swapArmedRef.current = false
    rt.setSwapArmed(false)
    rt.downAtRef.current = null
    rt.setLiveFor(null)
    delete rt.elRef.current?.dataset.gesture
    // pointerup over another pane commits the swap; pointercancel drops it.
    if (g?.mode === 'swap')
      finishSwapDrag(rt, e.type === 'pointerup')
  }
  else {
    rt.clearSwapHold()
    rt.swapArmedRef.current = false
    rt.setSwapArmed(false)
    const only = [...rt.pointersRef.current.values()][0]
    const p = rt.local(only.x, only.y)
    rt.downAtRef.current = { x: only.x, y: only.y }
    rt.gestureRef.current = { mode: 'pan', lastX: p.x, lastY: p.y, startDist: 0, base: { ...rt.leaf } }
  }
}

/**
 * A touch long press arms the swap drag, not the menu, so cancel Base UI's own
 * long-press open. A menu opened while a gesture runs (right-click mid-pan)
 * hands the gesture back so the finger crossing the menu doesn't keep
 * panning.
 */
function paneMenuOpenChange(rt: PaneGestureRuntime, open: boolean, details: ContextMenu.Root.ChangeEventDetails) {
  if (open && rt.touchPressRef.current) {
    details.cancel()
    return
  }
  if (!open)
    return
  finishSwapDrag(rt, false)
  const el = rt.elRef.current
  if (el) {
    for (const id of [...rt.pointersRef.current.keys()]) {
      if (el.hasPointerCapture(id))
        el.releasePointerCapture(id)
    }
  }
  rt.pointersRef.current.clear()
  rt.gestureRef.current = null
  rt.clearHold()
  rt.clearSwapHold()
  rt.swapArmedRef.current = false
  rt.setSwapArmed(false)
  rt.downAtRef.current = null
  rt.setLiveFor(null)
  delete rt.elRef.current?.dataset.gesture
}

/**
 * The slice the wheel handler needs, so its effect can depend only on the
 * viewport inputs rather than the whole runtime bag.
 */
interface WheelCtx {
  leaf: Leaf
  draftRef: React.RefObject<Leaf | null>
  iw: number
  ih: number
  exitToGrid: () => void
  local: (cx: number, cy: number) => { x: number, y: number }
  zoomAbout: (base: Leaf, nextZoom: number, mx: number, my: number) => void
}

function handleWheel(rt: WheelCtx, e: WheelEvent) {
  // Pinch/ctrl+wheel must never fall through to browser page zoom, even when
  // this pane has nothing to zoom (the stage forwards these here).
  if (e.ctrlKey || (rt.leaf.photoId && rt.iw && rt.ih))
    e.preventDefault()
  // Pinching in (shrinking) on a pane without a photo: nothing to zoom, so the
  // pinch itself is the exit-to-grid gesture.
  if (!rt.leaf.photoId && e.ctrlKey && e.deltaY > 0) {
    rt.exitToGrid()
    return
  }
  if (!rt.leaf.photoId || !rt.iw || !rt.ih)
    return
  const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0012))
  const nextZoom = rt.leaf.zoom * factor
  // Ctrl+pinch that would shrink below MIN_ZOOM has hit the floor and is still
  // pushing out: zoom out all the way into the 3×3 grid instead of clamping.
  // Plain (non-ctrl) wheel is never an exit signal.
  if (e.ctrlKey && nextZoom <= MIN_ZOOM) {
    rt.exitToGrid()
    return
  }
  const base = currentLeaf(rt)
  const p = rt.local(e.clientX, e.clientY)
  // A wheel tick is a settled step of its own, committed as it comes (the
  // stream coalesces in lib/history), so a gesture's painted draft hands over
  // to it here instead of waiting for a release that may never come.
  rt.draftRef.current = null
  rt.zoomAbout(base, nextZoom, p.x, p.y)
}

/**
 * The pane's pointer machine: pan/pinch zoom, the long-press swap carry, and
 * the Live Photo hold. It owns the gesture state and refs and hands the pane
 * the handlers and render state; the branchy gesture math lives in the module
 * helpers above.
 */
function usePaneGestures({
  leaf,
  cell,
  drawRect,
  draftRef,
  iw,
  ih,
  photo,
  elRef,
  onFocus,
  exitToGrid,
  local,
  commit,
  zoomAbout,
}: {
  leaf: Leaf
  cell: Rect
  drawRect: Rect
  draftRef: React.RefObject<Leaf | null>
  iw: number
  ih: number
  photo: Photo | null
  elRef: React.RefObject<HTMLDivElement | null>
  onFocus: (id: string) => void
  exitToGrid: () => void
  local: (cx: number, cy: number) => { x: number, y: number }
  commit: (next: Leaf) => void
  zoomAbout: (base: Leaf, nextZoom: number, mx: number, my: number) => void
}) {
  const pointersRef = useRef(new Map<number, { x: number, y: number }>())
  const gestureRef = useRef<Gesture | null>(null)
  // The pointer type of the last press: Base UI opens the pane menu on a touch
  // long press too, and some browsers raise a native contextmenu for it, so
  // keying the suppression off the press is more reliable than off the event.
  const touchPressRef = useRef(false)
  const downAtRef = useRef<{ x: number, y: number } | null>(null)

  // ---- Long-press pane swap -------------------------------------------------
  // Touch arms the swap with a still hold; desktop uses the menu's Move item,
  // since a still mouse press must stay a pan. The ghost follows the pointer
  // and dropping it on another pane swaps the two; dropping elsewhere cancels.
  const [swapAt, setSwapAt] = useState<{ x: number, y: number } | null>(null)
  // Mirror of swapAt so endSwapDrag can read the latest point without
  // depending on the state value in its useCallback deps and without calling
  // setSwapReturn from inside a setSwapAt updater (which is forbidden because
  // updaters can run more than once in dev/StrictMode).
  const swapAtRef = useRef<{ x: number, y: number } | null>(null)
  useEffect(
    () => { swapAtRef.current = swapAt },
    [swapAt],
  )
  const [moving, setMoving] = useState(false)
  // A cancelled carry (dropped on empty space, pointercancel, Escape) flies the
  // ghost home onto the dimmed original instead of vanishing. This holds the
  // point it was released at, which seeds the return animation.
  const [swapReturn, setSwapReturn] = useState<{ x: number, y: number } | null>(null)
  const clearSwapReturn = useCallback(() => setSwapReturn(null), [])
  // Mirror of swapArmedRef for rendering: the hold registered (SWAP_HOLD_MS),
  // the finger hasn't moved yet. The ref stays the synchronous source of truth
  // for the gesture code; the state only drives the lifted-pane look.
  const [swapArmed, setSwapArmed] = useState(false)
  const swapHoldRef = useRef<number | null>(null)
  const swapArmedRef = useRef(false)
  const clearSwapHold = useCallback(() => {
    if (swapHoldRef.current != null) {
      clearTimeout(swapHoldRef.current)
      swapHoldRef.current = null
    }
    delete elRef.current?.dataset.swapHold
  }, [elRef])
  const overRef = useRef<HTMLElement | null>(null)
  const clearSwapOver = useCallback(() => {
    if (overRef.current) {
      delete overRef.current.dataset.swapOver
      overRef.current = null
    }
  }, [])

  // Live Photo: press and hold to play the paired video, release to stop; the
  // play button pins playback instead (toggles, survives gestures). Both record
  // which photo they belong to, so swapping the pane's photo invalidates
  // playback without an effect.
  const [liveFor, setLiveFor] = useState<string | null>(null)
  const [livePin, setLivePin] = useState<string | null>(null)
  const liveVideoRef = useRef<HTMLVideoElement | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const hasLiveVideo = !!photo?.videoFile
  const live = hasLiveVideo && !!photo && (liveFor === photo.id || livePin === photo.id)

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
      v.play().catch(() => {})
    }
    else {
      v.pause()
    }
  }, [live, photo?.videoFile])

  const runtime: PaneGestureRuntime = {
    paneId: leaf.id,
    leaf,
    cell,
    drawRect,
    draftRef,
    iw,
    ih,
    photo,
    hasLiveVideo,
    elRef,
    pointersRef,
    gestureRef,
    touchPressRef,
    downAtRef,
    swapArmedRef,
    swapHoldRef,
    overRef,
    swapAtRef,
    holdTimerRef,
    onFocus,
    local,
    commit,
    zoomAbout,
    exitToGrid,
    clearHold,
    clearSwapHold,
    setSwapAt,
    setSwapArmed,
    setSwapReturn,
    setLiveFor,
    setMoving,
  }
  const endSwapDrag = useCallback((commit: boolean) => {
    finishSwapDrag({ paneId: leaf.id, overRef, swapAtRef, setSwapAt, setSwapReturn }, commit)
  }, [leaf.id])

  useEffect(() => {
    if (!moving)
      return
    // Escape drops the carried pane; capture so it never reaches the global
    // handler, which would close the tools panel and then leave the editor.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape')
        return
      e.preventDefault()
      e.stopPropagation()
      setMoving(false)
      endSwapDrag(false)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [moving, endSwapDrag])

  useEffect(() => () => {
    clearSwapOver()
    clearSwapHold()
    document.body.style.cursor = ''
  }, [clearSwapOver, clearSwapHold])

  useEffect(() => {
    const el = elRef.current
    if (!el)
      return
    const handler = (e: WheelEvent) => handleWheel({ leaf, draftRef, iw, ih, exitToGrid, local, zoomAbout }, e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [leaf, iw, ih, local, zoomAbout, exitToGrid, elRef, draftRef])

  const toggleLivePin = useCallback(() => {
    if (photo)
      setLivePin(live ? null : photo.id)
  }, [photo, live])

  return {
    swapAt,
    moving,
    swapReturn,
    swapArmed,
    live,
    liveVideoRef,
    toggleLivePin,
    clearSwapReturn,
    onPointerDown: (e: React.PointerEvent) => beginPointer(runtime, e),
    onPointerMove: (e: React.PointerEvent) => movePointer(runtime, e),
    onPointerUp: (e: React.PointerEvent) => endPointer(runtime, e),
    onPointerDownCapture: (e: React.PointerEvent) => {
      touchPressRef.current = e.pointerType !== 'mouse'
    },
    onMenuOpenChange: (open: boolean, details: ContextMenu.Root.ChangeEventDetails) => paneMenuOpenChange(runtime, open, details),
    startMove: (x: number, y: number) => startMovePane(runtime, x, y),
    moveGhostTo: (x: number, y: number) => {
      setSwapAt({ x, y })
      swapOverAtEl(runtime, x, y)
    },
    dropMoveAt: (x: number, y: number) => {
      swapOverAtEl(runtime, x, y)
      setMoving(false)
      finishSwapDrag(runtime, true)
    },
    cancelMove: () => {
      setMoving(false)
      finishSwapDrag(runtime, false)
    },
  }
}

interface DropChoice {
  photos: Photo[]
  at: { x: number, y: number }
}

/**
 * The pane's file drag-and-drop: track the drag-over look, ingest the dropped
 * files, and either assign straight into an empty pane or raise the choice
 * overlay for a filled one.
 */
function usePaneDrop({
  paneId,
  hasPhoto,
  place,
  toCanvas,
  setDropChoice,
}: {
  paneId: string
  hasPhoto: boolean
  place: { x: number, y: number, w: number, h: number } | null
  toCanvas: (clientX: number, clientY: number) => { x: number, y: number }
  setDropChoice: (v: DropChoice | null) => void
}) {
  const [dropping, setDropping] = useState(false)
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files'))
      return
    e.preventDefault()
    e.stopPropagation()
    setDropping(true)
  }
  const onDragLeave = () => setDropping(false)
  const onDrop = (e: React.DragEvent) => {
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
    if (hasPhoto) {
      const pt = place ? toCanvas(e.clientX, e.clientY) : null
      const at = pt && place ? photoNorm(place, pt.x, pt.y) : { x: 0.5, y: 0.5 }
      setDropChoice({ photos: created, at })
      return
    }
    const first = created[0]
    if (first)
      s.assign(paneId, first.id)
  }
  return { dropping, onDragOver, onDragLeave, onDrop }
}

/**
 * Everything a pane's render derives from its props: the cell its photo is
 * placed against, where that placement lands, and the chrome measured against
 * it. Pure, so the markup below is props in, elements out.
 *
 * `leaf` is the shown leaf, not the committed one: a gesture paints its draft
 * straight onto the DOM (see `paintLeaf`), and the render has to agree with it.
 */
function paneFrame({
  leaf,
  rect,
  layoutRect,
  preview,
  fade,
  seam,
  gap,
  radius,
}: {
  leaf: Leaf
  rect: Rect
  layoutRect: Rect | undefined
  preview: Preview | null
  fade: number
  seam: SeamSides | undefined
  gap: number
  radius: number
}) {
  const iw = preview?.w ?? 0
  const ih = preview?.h ?? 0
  // Placement stays on the layout cell so enabling crossfade does not reframe
  // the photo. Derived once: the transform, the Live Photo box, the minimap and
  // the drop/return targets all read these numbers.
  const cell: Rect = layoutRect ?? rect
  const place = iw && ih ? placement(cell, leaf, iw, ih) : null
  // The pane's turn and mirrors, about the pane box's center (the exporter
  // turns about the same point, from the same `paneTransform`). Upright and
  // unflipped panes keep the plain img, so today's rendering is untouched.
  const transform = paneTransform(rect, leaf)
  // The carried photo rides the pointer at roughly its pane size (capped).
  const ghostW = Math.min(rect.w, 180)
  return {
    iw,
    ih,
    cell,
    place,
    /** The photo's transform, or null when nothing is placed yet. */
    photoStyle: place ? transformOf(place, rect) : null,
    // Feather the photo's seam edges (and the Live Photo video that replaces
    // it visually); stickers/labels stay sharp above it.
    mask: seamMaskStyle(seam, seamFadeWidth(fade, cell)),
    turn: isPaneTransformed(transform) ? paneTransformCss(transform) : null,
    radiusCss: cornerRadiiCss(leafCornerRadii(radius, seam, gap)),
    /** The drag ghost's box, at the pane's aspect. */
    ghost: { w: ghostW, h: iw ? (ghostW * ih) / iw : ghostW },
  }
}

function PaneImpl({
  leaf,
  rect,
  layoutRect,
  crossfade,
  radius,
  gap,
  bordered,
  fade,
  seam,
  unit: _unit,
  photo,
  photoById: _photoById,
  focused,
  canClose,
  onFocus,
  onUpdate,
  onSplit,
  onClose,
}: Props) {
  const elRef = useRef<HTMLDivElement | null>(null)
  // A gesture paints its placement straight onto the DOM (see `paintLeaf`), so
  // the tree still holds the value it started from. Rendering the draft keeps
  // any render that lands mid-gesture (a photo finishing its decode, say) in
  // step with the finger, and the release commits the same value.
  const draftRef = useRef<Leaf | null>(null)
  const shownLeaf = draftRef.current ?? leaf
  // The photo as this pane shows it: with its texture filter baked in when one
  // is set (`lib/filterCache`, the same pixels the exporter draws).
  const preview = usePanePreview(photo, shownLeaf.filter)
  const navigate = useNavigate()

  // Exit the editor back to the grid overview, morphing the canvas into its cell.
  const exitToGrid = useCallback(() => {
    useStore.getState().clearSelection()
    void navigate({ to: OVERVIEW_PATH, viewTransition: viewTransitionOption() })
  }, [navigate])

  const pickForPane = useCallback(() => pickPhotoForPane(leaf.id), [leaf.id])

  const { iw, ih, cell, place, photoStyle, mask: photoMask, turn, radiusCss, ghost } = paneFrame({
    leaf: shownLeaf,
    rect,
    layoutRect,
    preview,
    fade,
    seam,
    gap,
    radius,
  })

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const b = elRef.current?.getBoundingClientRect()
      const lx = b ? clientX - b.left : 0
      const ly = b ? clientY - b.top : 0
      // Screen pixels to canvas pixels: the view zoom scales the whole canvas.
      const s = viewScaleAt(elRef.current)
      return { x: rect.x + lx / s, y: rect.y + ly / s }
    },
    [rect.x, rect.y],
  )

  const { local, commit, zoomAbout } = usePaneViewport({ leaf, cell, iw, ih, elRef, onUpdate })
  const {
    swapAt,
    moving,
    swapReturn,
    swapArmed,
    live,
    liveVideoRef,
    toggleLivePin,
    clearSwapReturn,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerDownCapture,
    onMenuOpenChange,
    startMove,
    moveGhostTo,
    dropMoveAt,
    cancelMove,
  } = usePaneGestures({ leaf, cell, drawRect: rect, draftRef, iw, ih, photo, elRef, onFocus, exitToGrid, local, commit, zoomAbout })

  // A drop on a pane that already holds a photo asks what the image should
  // become; `at` is the drop point in pane-normalized coords for stickers.
  const [dropChoice, setDropChoice] = useState<DropChoice | null>(null)
  const { dropping, onDragOver, onDragLeave, onDrop } = usePaneDrop({
    paneId: leaf.id,
    hasPhoto: !!leaf.photoId,
    place,
    toCanvas,
    setDropChoice,
  })

  // Where a cancelled carry lands, computed once per render from the dimmed
  // original's live box (the pane can shift while the carry is in flight).
  const swapReturnTo = swapReturnLanding(swapReturn, place, rect, elRef.current)

  const paneNode = (
    <div
      ref={elRef}
      data-pane-id={leaf.id}
      data-swap-armed={swapArmed ? '' : undefined}
      data-swap-source={swapAt ? '' : undefined}
      // The preview's own size rides the element: a divider drag paints the
      // photo straight onto the DOM and has no hook to ask for it.
      data-photo-w={iw || undefined}
      data-photo-h={ih || undefined}
      className={paneShellClass(focused, !!leaf.photoId)}
      style={{ ...paneBoxStyle(rect), borderRadius: radiusCss }}
      onPointerDown={onPointerDown}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => leaf.photoId && onUpdate(leaf.id, { zoom: 1, cx: 0.5, cy: 0.5 })}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={e => e.preventDefault()}
    >
      <PanePhotoContent
        preview={preview}
        transform={photoStyle}
        photoId={leaf.photoId}
        mask={photoMask}
        crossfade={crossfade}
        radius={radiusCss}
        onPick={pickForPane}
        carried={!!swapAt}
        turn={turn}
      />

      {photoStyle && (
        <PaneLivePhoto
          photo={photo}
          box={photoBoxStyle(cell, rect, shownLeaf, iw, ih)}
          mask={photoMask}
          crossfade={crossfade}
          live={live}
          turn={turn}
          videoRef={liveVideoRef}
          onToggle={toggleLivePin}
        />
      )}

      {/* The pane's only hover chrome: the split chip, faded in while the
          pointer is over the pane, focused or not. Hidden below lg, where
          splitting lives in the focused pane's tools dock (Stage.tsx). */}
      <PaneSplitTools
        paneId={leaf.id}
        onSplit={onSplit}
        className="pointer-events-none absolute left-1/2 top-[9px] z-[3] -translate-x-1/2 opacity-0 transition-opacity duration-(--dur-fast) group-hover/pane:pointer-events-auto group-hover/pane:opacity-100 max-lg:hidden"
      />

      {/* Focus-only, like the × close button: the minimap, parked inside the
          photo at its bottom-right once the photo overflows the pane. */}
      {photoStyle && focused && (
        <PaneMinimap
          paneEl={elRef}
          leaf={shownLeaf}
          cell={cell}
          rect={rect}
          iw={iw}
          ih={ih}
          previewUrl={preview?.url}
          onPan={(cx, cy) => commit({ ...shownLeaf, cx, cy })}
        />
      )}

      {dropChoice && (
        <DropChoiceOverlay
          paneId={leaf.id}
          photos={dropChoice.photos}
          at={dropChoice.at}
          onClose={() => setDropChoice(null)}
        />
      )}

      <SwapGhost at={swapAt} preview={preview} width={ghost.w} height={ghost.h} radius={radius} />

      {/* A cancelled carry glides back onto the dimmed original. */}
      <SwapReturnPortal from={swapReturn} preview={preview} to={swapReturnTo} width={ghost.w} height={ghost.h} radius={radius} onDone={clearSwapReturn} />

      {/* Move mode: one full-screen catcher so the next click drops the carried
          photo wherever it lands (source and empty space drop it back). The
          portal lives in the pane's React tree, so events must not bubble on
          to the pane's own handlers (or Base UI would reopen the menu). */}
      <MoveCatcher active={moving} onMove={moveGhostTo} onDrop={dropMoveAt} onCancel={cancelMove} />

      {canClose && <PaneCloseTool paneId={leaf.id} focused={focused} onClose={onClose} />}

      {/* Drawn last so the pane border stays above its photo/stickers. */}
      <PaneOutline focused={focused} dropping={dropping} bordered={bordered} radius={radiusCss} />
    </div>
  )

  // Every pane keeps its context menu mounted: right-click works on the
  // focused pane too, and the swap item shows up on unfocused panes only (see
  // swapTargetId). The menu is grouped by what the rows act on: this pane's
  // photo, its decoration, their arrangement, then the pane itself.
  return (
    <PaneMenu
      leaf={leaf}
      rect={rect}
      photo={photo}
      iw={iw}
      ih={ih}
      live={live}
      focused={focused}
      canClose={canClose}
      paneNode={paneNode}
      onOpenChange={onMenuOpenChange}
      onSplit={onSplit}
      onClose={onClose}
      onFocus={onFocus}
      onToggleLive={toggleLivePin}
      onStartMove={startMove}
      onPickPhoto={pickForPane}
    />
  )
}

export const Pane = memo(PaneImpl)
