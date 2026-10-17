/**
 * The grid's read-only cell previews: a workspace drawn as the editor draws it
 * (photos, stickers, labels through the same placement math), the cell body the
 * overview, the drag overlay and the switcher's pager all share, and the dashed
 * add-slot frame. Pure rendering: no board state lives here.
 */
import type { Photo } from '../../lib/imageStore'
import type { Leaf, Node, PaneLabel, Rect, SeamSides, Sticker } from '../../lib/panes'
import { LayoutDashboard, Plus } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useMemo } from 'react'
import { usePreview } from '../../hooks'
import { fontById } from '../../lib/fonts'
import { useT } from '../../lib/i18n'
import { LABEL_ICON_GAP_EM, labelIconNode } from '../../lib/labelIcons'
import { blendFadePx, boardStickerRect, cornerRadiiCss, expandRectForBlend, labelPaint, layoutTree, leafCornerRadii, leafList, placement, rotationCss, seamFadeWidth, seamMaskStyle, seamSides } from '../../lib/panes'
import { isTransparentBg, useStore } from '../../store'
import { LabelIconGlyph } from '../BoardLabel'
import { SeamBackdrop } from '../Stage'

// Virtual canvas short side for preview layout math. Any value works; the
// tree layout is resolution-independent, only the ratio matters.
const PV = 400

/** One board sticker in a workspace preview (canvas-normalized, scaled by k). */
function PreviewSticker({ st, board, k, photoById }: {
  st: Sticker
  board: { w: number, h: number }
  k: number
  photoById: Map<string, Photo>
}) {
  const photo = photoById.get(st.photoId)
  const preview = usePreview(photo ?? null)
  if (!photo?.trueW || !photo?.trueH || !preview)
    return null
  const r = boardStickerRect(board, st, photo.trueW / photo.trueH)
  return (
    <img
      src={preview.url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute max-w-none"
      style={{
        left: r.x * k,
        top: r.y * k,
        width: r.w * k,
        height: r.h * k,
        transform: rotationCss(st),
      }}
    />
  )
}

/** Photo placement + draw box for a preview leaf (crossfade expands the cell). */
function previewLeafPlace(leaf: Leaf, layout: Rect, cell: Rect, iw: number, ih: number, crossfade: boolean) {
  if (!iw || !ih)
    return null
  return crossfade
    ? placement(layout, leaf, iw, ih)
    : placement({ x: 0, y: 0, w: cell.w, h: cell.h }, leaf, iw, ih)
}

/** One leaf of a workspace preview: the photo, panned/zoomed like the editor. */
function PreviewLeaf({ leaf, rect, k, unit, fade, seam, crossfade, photoById }: {
  leaf: Leaf
  rect: Rect
  /** Virtual→cell scale factor. */
  k: number
  /** Cell-normalized unit (short side / 1000), for radius scaling. */
  unit: number
  /** Blend feather width in cell px (0 turns the fade off). */
  fade: number
  seam?: SeamSides
  crossfade: boolean
  photoById: Map<string, Photo>
}) {
  const photo = leaf.photoId ? photoById.get(leaf.photoId) : undefined
  const preview = usePreview(photo ?? null)
  const radius = useStore(s => s.radius)
  const layout: Rect = { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k }
  const cell = crossfade && leaf.photoId ? expandRectForBlend(layout, seam, fade) : layout
  const style: React.CSSProperties = {
    left: cell.x,
    top: cell.y,
    width: cell.w,
    height: cell.h,
    borderRadius: cornerRadiiCss(leafCornerRadii(radius * unit, seam, 0)),
  }
  const place = previewLeafPlace(leaf, layout, cell, preview?.w ?? 0, preview?.h ?? 0, crossfade)
  const mask = leaf.photoId ? seamMaskStyle(seam, seamFadeWidth(fade, crossfade ? layout : cell)) : undefined
  const imgTx = place
    ? (crossfade
        ? `translate(${place.x - cell.x}px, ${place.y - cell.y}px) scale(${place.scale})`
        : `translate(${place.x}px, ${place.y}px) scale(${place.scale})`)
    : ''
  return (
    <div className={`absolute overflow-hidden ${leaf.photoId ? '' : ' bg-pane-bg bg-pane-empty'}`} style={style}>
      {preview && place
        ? (
            <div
              className="absolute inset-0"
              style={{
                ...mask,
                mixBlendMode: crossfade && mask ? 'plus-lighter' : undefined,
              }}
            >
              <img
                src={preview.url}
                alt=""
                draggable={false}
                className="block max-w-none"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transformOrigin: '0 0',
                  transform: imgTx,
                }}
              />
            </div>
          )
        : null}
    </div>
  )
}

/** Read-only live preview of a workspace's full collage in a square cell. */
export function CellPreview({ root, canvasRatio, box, photoById, stickers = [], labels = [] }: {
  root: Node
  canvasRatio: number | null
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  stickers?: Sticker[]
  labels?: PaneLabel[]
}) {
  const bg = useStore(s => s.bg)
  const edgeFade = useStore(s => s.edgeFade)
  const fadeStrength = useStore(s => s.edgeFadeStrength)
  const blendCrossfade = useStore(s => s.blendCrossfade)
  const VW = PV
  const VH = Math.round(PV / (canvasRatio ?? 1.5))
  const view = useMemo(() => layoutTree(root, VW, VH, 0), [root, VW, VH])
  // Cover-fit: scale the workspace's own aspect up so it fills the whole
  // square cell, centered; the overflow is cropped away (Moments style).
  const k = Math.max(box.w / VW, box.h / VH)
  // Center the oversized preview box: negative offsets + half overflow.
  const pw = VW * k
  const ph = VH * k
  // Font/radius unit follows the canvas short edge, like the editor.
  const unit = (Math.min(VW, VH) / 1000) * k
  const fade = blendCrossfade
    ? blendFadePx(edgeFade * unit, fadeStrength, 0)
    : edgeFade * unit
  const seams = useMemo(() => seamSides(view.leaves, 0), [view])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={`absolute top-1/2 left-1/2 ${isTransparentBg(bg) ? ' stage-clear' : ''}`}
        style={{
          width: pw,
          height: ph,
          transform: 'translate(-50%, -50%)',
          background: isTransparentBg(bg) ? undefined : bg,
        }}
      >
        {fade > 0 && !blendCrossfade && (
          <SeamBackdrop
            leaves={view.leaves.map(({ node, rect }) => ({
              node,
              rect: { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k },
            }))}
            photoById={photoById}
            radius={Math.max(unit * 40, fade)}
            opacity={fadeStrength / 100}
          />
        )}
        {view.leaves.map(({ node, rect }) => (
          <PreviewLeaf
            key={node.id}
            leaf={node}
            rect={rect}
            k={k}
            unit={unit}
            fade={fade}
            seam={seams.get(node.id)}
            crossfade={blendCrossfade}
            photoById={photoById}
          />
        ))}
        {stickers.map(st => (
          <PreviewSticker
            key={st.id}
            st={st}
            board={{ w: VW, h: VH }}
            k={k}
            photoById={photoById}
          />
        ))}
        {labels.filter(lab => lab.text.trim()).map(lab => (
          <span
            key={lab.id}
            className="absolute whitespace-pre leading-[normal]"
            style={{
              left: `${lab.x * 100}%`,
              top: `${lab.y * 100}%`,
              transform: `translate(-50%, -50%) ${rotationCss(lab)}`,
              fontSize: lab.size * unit,
              fontFamily: fontById(lab.font).cssStack,
              background: labelPaint(lab).fill,
              color: labelPaint(lab).fg,
              padding: '0.22em 0.38em',
              display: 'flex',
              alignItems: 'center',
              gap: `${LABEL_ICON_GAP_EM}em`,
            }}
          >
            {labelIconNode(lab.icon) && <LabelIconGlyph node={labelIconNode(lab.icon)!} />}
            {lab.text}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * The cell's visible body, shared by the in-grid cell, the drag overlay and the
 * switcher's boards. `quiet` draws an empty cell as a plain square: behind the
 * switcher the board is receded and blurred, where a per-cell glyph and caption
 * stack up into placeholder noise (the full overview keeps both).
 */
export function CellBody({ ws, box, photoById, transparent, dimmed, quiet = false }: {
  ws: { root: Node, canvasRatio: number | null, stickers?: Sticker[], labels?: PaneLabel[] }
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
  dimmed: boolean
  /** Empty cell as a bare square: no glyph, no caption (the receded board). */
  quiet?: boolean
}) {
  const t = useT()
  const filled = leafList(ws.root).some(l => l.photoId)
  return (
    <div className={`absolute inset-0 transition-opacity duration-(--dur-surface) ${dimmed ? ' opacity-25' : ''}`}>
      {filled
        ? (
            <div className={`absolute inset-0 ${transparent ? ' stage-clear' : ''}`}>
              <CellPreview root={ws.root} canvasRatio={ws.canvasRatio} box={box} photoById={photoById} stickers={ws.stickers ?? []} labels={ws.labels ?? []} />
            </div>
          )
        : quiet
          ? <span className="absolute inset-0 bg-pane-bg bg-pane-empty" />
          : (
              // The empty pane's hint, worn by the cell: near-canvas fill, and
              // the glyph over the label centered in the neutral gray. No
              // button of its own: the cell is the button.
              <span className="absolute inset-0 grid place-items-center bg-pane-bg bg-pane-empty">
                <span className="flex flex-col items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold text-dim">
                  <MorphIcon icon={LayoutDashboard} size={22} strokeWidth={1.75} />
                  {t('New collage')}
                </span>
              </span>
            )}
    </div>
  )
}

/**
 * The grid's last slot as drawn: the dashed frame and its +. Shared by the live
 * + cell and the inert copy a pager board shows, so both boards are the same
 * shape.
 */
export function AddSlotFrame({ cell, cellH }: { cell: number, cellH: number }) {
  return (
    <>
      {/* The dashed frame is drawn, not a CSS border: an SVG rect inset by
          half its stroke keeps all four edges inside the box at any offset. */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-line-strong">
        <rect x="0.5" y="0.5" width={cell - 1} height={cellH - 1} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 3" shapeRendering="crispEdges" />
      </svg>
      <MorphIcon icon={Plus} size={26} strokeWidth={1.75} />
    </>
  )
}
