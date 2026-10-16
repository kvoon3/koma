import type { Workspace } from '../store'
import type { CutoutMap } from './cutout'
import type { Photo } from './imageStore'
import { mapSeq } from './async'
import { downloadBlob } from './exporter'

export interface WorkspaceDocV1 {
  version: 1
  app: 'koma'
  savedAt: string
  workspaces: Workspace[]
  activeId: string
  /** Cutout → original photo ids; absent in files saved before one-tap cutout. */
  cutouts?: CutoutMap
  settings: {
    gap: number
    radius: number
    bg: string
    longSide: number
    format: 'image/jpeg' | 'image/png'
    quality: number
  }
  photos: {
    id: string
    name: string
    trueW: number
    trueH: number
    data: string
    video?: string
  }[]
}

export interface WorkspaceFileState {
  workspaces: Workspace[]
  activeId: string
  gap: number
  radius: number
  bg: string
  longSide: number
  format: 'image/jpeg' | 'image/png'
  quality: number
  photos: Photo[]
  cutouts: CutoutMap
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const res = await fetch(dataUrl)
  // A malformed data: URL makes `fetch` reject rather than answer non-2xx,
  // so this guard never fires for today's inputs. It stays as the required
  // response check and a net for any future non-data source.
  if (!res.ok)
    throw new Error(`Could not read ${name} (HTTP ${res.status})`)
  const blob = await res.blob()
  return new File([blob], name, { type: blob.type || 'application/octet-stream' })
}

/** Build the doc from app state slices (caller passes useStore.getState()). Async because files → data URLs. */
export async function buildDoc(s: WorkspaceFileState): Promise<WorkspaceDocV1> {
  // # ponytail: originals ride along as base64 data URLs, so the saved file is
  // ~33% larger than the photos and a big board spikes memory while encoding.
  // The upgrade path is an fflate zip container with binary entries; not now.

  // One file in flight at a time on purpose: saving runs on phone WebViews,
  // and concurrent reads would peak at the sum of every file.
  const photos = await mapSeq(s.photos, async (p) => {
    const entry: WorkspaceDocV1['photos'][number] = {
      id: p.id,
      name: p.name,
      trueW: p.trueW,
      trueH: p.trueH,
      data: await fileToDataUrl(p.file),
    }
    if (p.videoFile)
      entry.video = await fileToDataUrl(p.videoFile)
    return entry
  })
  return {
    version: 1,
    app: 'koma',
    savedAt: new Date().toISOString(),
    workspaces: s.workspaces,
    activeId: s.activeId,
    cutouts: s.cutouts,
    settings: {
      gap: s.gap,
      radius: s.radius,
      bg: s.bg,
      longSide: s.longSide,
      format: s.format,
      quality: s.quality,
    },
    photos,
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Download as `koma-<YYYYMMDD>-<HHmm>.koma.json` via downloadBlob from './exporter'. */
export function downloadDoc(doc: WorkspaceDocV1): void {
  const d = new Date()
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`
  downloadBlob(
    new Blob([JSON.stringify(doc)], { type: 'application/json' }),
    `koma-${stamp}.koma.json`,
  )
}

function isWorkspaceDoc(v: unknown): v is WorkspaceDocV1 {
  if (typeof v !== 'object' || v === null)
    return false
  const d = v as Record<string, unknown>
  return d.version === 1 && d.app === 'koma' && Array.isArray(d.workspaces) && Array.isArray(d.photos)
}

/** Parse + validate an imported file; rebuild Photo objects (id preserved, data URL → File). */
export async function parseWorkspaceFile(file: File): Promise<{ doc: WorkspaceDocV1, photos: Photo[] }> {
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  }
  catch {
    throw new Error('Not a koma workspace file')
  }
  if (!isWorkspaceDoc(raw))
    throw new Error('Not a koma workspace file')

  // The mirror of the save cap: the doc's data URLs are already in memory,
  // and decoding them one at a time keeps the rebuilt files from all landing
  // at once on a phone.
  const photos = await mapSeq(raw.photos, async (p) => {
    const photo: Photo = {
      id: p.id,
      name: p.name,
      file: await dataUrlToFile(p.data, p.name),
      trueW: p.trueW,
      trueH: p.trueH,
    }
    if (p.video) {
      // Live Photos pair still+video by basename (livephoto.ts baseKey), so
      // name the rebuilt MOV after the still: IMG_1234.HEIC + IMG_1234.mov.
      photo.videoFile = await dataUrlToFile(p.video, `${p.name.replace(/\.[^.]+$/, '')}.mov`)
    }
    return photo
  })
  return { doc: raw, photos }
}
