import type { ContextMenu } from '@base-ui/react/context-menu'
import type { Photo, Preview } from '../lib/imageStore'
import type { Leaf, Rect, SeamSides } from '../lib/panes'
import { useNavigate } from '@tanstack/react-router'
import { ImagePlus, SquareSplitHorizontal, SquareSplitVertical, Sticker as StickerIcon, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { usePreview } from '../hooks'
import { useT } from '../lib/i18n'
import { pickPhotoForPane } from '../lib/paneCommands'
import { clampLeaf, photoNorm, placement, seamFadeWidth, seamMaskStyle } from '../lib/panes'
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
  place,
  rect,
  photoId,
  mask,
  radius,
  onPick,
  carried,
}: {
  preview: Preview | null
  place: ReturnType<typeof placement> | null
  rect: Rect
  photoId: string | null
  mask?: React.CSSProperties
  radius: number
  onPick: () => void
  /** The photo is being carried as the swap/Move ghost: dim the original. */
  carried: boolean
}) {
  const t = useT()
  return preview && place
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
            // Complementary seam alphas must add (not source-over onto black).
            mixBlendMode: mask ? 'plus-lighter' : undefined,
          }}
        >
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
    // The bezier equals the `--ease-out` token; WAAPI cannot read CSS vars in
    // `easing`, so it is spelled out here.
    const anim = el.animate(
      [
        { transform: `translate3d(${from.x}px, ${from.y}px, 0)`, opacity: 0.95 },
        { transform: `translate3d(${to.x}px, ${to.y}px, 0)`, opacity: 0 },
      ],
      { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' },
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
  return {
    x: box.left + place.x - rect.x + place.w / 2,
    y: box.top + place.y - rect.y + place.h / 2,
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
  radius: number
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
  /** Visual box (expanded into seams when blend is on). */
  rect: Rect
  /** Pre-overlap layout cell for photo placement; defaults to `rect`. */
  layoutRect?: Rect
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

/* The Live Photo video layer plus its play badge, drawn together because they
   share the pane's mask and playback flag. */
function PaneLivePhoto({
  photo,
  place,
  rect,
  mask,
  live,
  videoRef,
  onToggle,
}: {
  photo: Photo | null
  place: { x: number, y: number, w: number, h: number }
  rect: Rect
  mask?: React.CSSProperties
  live: boolean
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
          mixBlendMode: mask ? 'plus-lighter' : undefined,
        }}
      >
        {/* The peek plays muted: the export's own recording is silent too (a
            canvas capture carries no audio), and a silent layer is allowed to
            start without waiting on the browser's audio permission. */}
        <video
          ref={videoRef}
          className={`absolute left-0 top-0 z-1 max-w-none bg-pane-bg object-cover opacity-0 pointer-events-none ${live ? ' opacity-100' : ''}`}
          style={{
            left: place.x - rect.x,
            top: place.y - rect.y,
            width: place.w,
            height: place.h,
          }}
          muted
          loop
          playsInline
          preload="auto"
          draggable={false}
        />
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
  if (!at || !preview)
    return null
  return createPortal(
    <div
      className="pointer-events-none fixed left-0 top-0 z-[80]"
      style={{ transform: `translate3d(${at.x}px, ${at.y}px, 0)` }}
    >
      <img
        src={preview.url}
        alt=""
        draggable={false}
        className="pointer-events-none block swap-ghost max-w-none opacity-95 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
        style={{
          width,
          height,
          borderRadius: radius,
          transform: 'translate(-50%, -55%)',
        }}
      />
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
    return r ? { x: cx - r.left, y: cy - r.top } : { x: 0, y: 0 }
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

  return { local, commit, zoomAbout }
}

/* Everything the pointer-gesture helpers below need, in one bag: the pane's
   live values, the refs the machine reads and writes, and the setters it
   calls. Built once per render by usePaneGestures. */
interface PaneGestureRuntime {
  paneId: string
  leaf: Leaf
  cell: Rect
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
  const target = el && el.dataset.paneId !== rt.paneId ? el : null
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
  clearSwapOverEl(rt.overRef)
  document.body.style.cursor = ''
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
  const dx = p.x - g.lastX
  const dy = p.y - g.lastY
  g.lastX = p.x
  g.lastY = p.y
  const pl = placement(rt.cell, rt.leaf, rt.iw, rt.ih)
  rt.commit({ ...rt.leaf, cx: rt.leaf.cx - dx / pl.w, cy: rt.leaf.cy - dy / pl.h })
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
  if (!rt.leaf.photoId)
    return
  const el = rt.elRef.current
  el?.setPointerCapture(e.pointerId)
  // The gesture rewrites the placed photo's transform on every move frame;
  // the compositor hint rides its lifetime (see [data-gesture] in index.css).
  if (el)
    el.dataset.gesture = '1'
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
      base: { ...rt.leaf },
    }
  }
  else {
    rt.gestureRef.current = { mode: 'pan', lastX: p.x, lastY: p.y, startDist: 0, base: { ...rt.leaf } }
    rt.downAtRef.current = { x: e.clientX, y: e.clientY }
    if (e.pointerType !== 'mouse') {
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
  if (!g || !rt.iw || !rt.ih)
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
  if (g.mode === 'pinch' && rt.pointersRef.current.size >= 2) {
    const [a, b] = [...rt.pointersRef.current.values()]
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    const mid = rt.local((a.x + b.x) / 2, (a.y + b.y) / 2)
    const ratio = dist / g.startDist
    // "Pinch past the floor": zoomAbout clamps to MIN_ZOOM, so judge the raw
    // ratio: shrinking an already-minimum photo out of the pane is the
    // explicit exit-to-grid gesture, and it must not commit a zoom either.
    if (g.base.zoom * ratio <= MIN_ZOOM && ratio < 1) {
      rt.exitToGrid()
      return
    }
    rt.zoomAbout(g.base, g.base.zoom * ratio, mid.x, mid.y)
  }
}

function endPointer(rt: PaneGestureRuntime, e: React.PointerEvent) {
  const g = rt.gestureRef.current
  rt.pointersRef.current.delete(e.pointerId)
  if (rt.pointersRef.current.size === 0) {
    rt.gestureRef.current = null
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
  const p = rt.local(e.clientX, e.clientY)
  rt.zoomAbout(rt.leaf, nextZoom, p.x, p.y)
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
    const handler = (e: WheelEvent) => handleWheel({ leaf, iw, ih, exitToGrid, local, zoomAbout }, e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [leaf, iw, ih, local, zoomAbout, exitToGrid, elRef])

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

function PaneImpl({
  leaf,
  rect,
  layoutRect,
  radius,
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
  const preview = usePreview(photo)
  const navigate = useNavigate()

  // Exit the editor back to the grid overview, morphing the canvas into its cell.
  const exitToGrid = useCallback(() => {
    useStore.getState().clearSelection()
    void navigate({ to: '/', viewTransition: viewTransitionOption() })
  }, [navigate])

  const pickForPane = useCallback(() => pickPhotoForPane(leaf.id), [leaf.id])

  const iw = preview?.w ?? 0
  const ih = preview?.h ?? 0
  // Placement stays on the layout cell so enabling blend does not reframe the photo.
  const cell: Rect = layoutRect ?? rect
  const place = iw && ih ? placement(cell, leaf, iw, ih) : null

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const b = elRef.current?.getBoundingClientRect()
      const lx = b ? clientX - b.left : 0
      const ly = b ? clientY - b.top : 0
      return { x: rect.x + lx, y: rect.y + ly }
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
  } = usePaneGestures({ leaf, cell, iw, ih, photo, elRef, onFocus, exitToGrid, local, commit, zoomAbout })

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

  // Feather the photo's seam edges (and the Live Photo video that replaces
  // it visually); stickers/labels stay sharp above it.
  const photoMask = seamMaskStyle(seam, seamFadeWidth(fade, cell))

  // The carried photo rides the pointer at roughly its pane size (capped).
  const ghostW = Math.min(rect.w, 180)
  const ghostH = iw ? (ghostW * ih) / iw : ghostW
  // Where a cancelled carry lands, computed once per render from the dimmed
  // original's live box (the pane can shift while the carry is in flight).
  const swapReturnTo = swapReturnLanding(swapReturn, place, rect, elRef.current)

  const paneNode = (
    <div
      ref={elRef}
      data-pane-id={leaf.id}
      data-swap-armed={swapArmed ? '' : undefined}
      data-swap-source={swapAt ? '' : undefined}
      className={paneShellClass(focused, !!leaf.photoId)}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: radius }}
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
        place={place}
        rect={rect}
        photoId={leaf.photoId}
        mask={photoMask}
        radius={radius}
        onPick={pickForPane}
        carried={!!swapAt}
      />

      {place && (
        <PaneLivePhoto
          photo={photo}
          place={place}
          rect={rect}
          mask={photoMask}
          live={live}
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

      {dropChoice && (
        <DropChoiceOverlay
          paneId={leaf.id}
          photos={dropChoice.photos}
          at={dropChoice.at}
          onClose={() => setDropChoice(null)}
        />
      )}

      <SwapGhost at={swapAt} preview={preview} width={ghostW} height={ghostH} radius={radius} />

      {/* A cancelled carry glides back onto the dimmed original. */}
      <SwapReturnPortal from={swapReturn} preview={preview} to={swapReturnTo} width={ghostW} height={ghostH} radius={radius} onDone={clearSwapReturn} />

      {/* Move mode: one full-screen catcher so the next click drops the carried
          photo wherever it lands (source and empty space drop it back). The
          portal lives in the pane's React tree, so events must not bubble on
          to the pane's own handlers (or Base UI would reopen the menu). */}
      <MoveCatcher active={moving} onMove={moveGhostTo} onDrop={dropMoveAt} onCancel={cancelMove} />

      {canClose && <PaneCloseTool paneId={leaf.id} focused={focused} onClose={onClose} />}

      {/* Drawn last so the pane border stays above its photo/stickers. */}
      <PaneOutline focused={focused} dropping={dropping} bordered={bordered} radius={radius} />
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
