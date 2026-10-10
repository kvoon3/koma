// Apple Live Photos travel as two sibling files: IMG_1234.HEIC (the key frame
// the collage is built from) and IMG_1234.MOV (~3s of video around it). Pair
// them by basename so panes can offer iOS-style press-and-hold playback.
// Export always uses the still; the video is preview-only.

const LIVE_VIDEO_EXT = /\.mov$/i
const LIVE_VIDEO_TYPES = new Set(['video/quicktime', 'video/mp4'])

export function looksLikeLiveVideo(file: File): boolean {
  return LIVE_VIDEO_EXT.test(file.name) || LIVE_VIDEO_TYPES.has(file.type.toLowerCase())
}

/** Lowercased basename without extension: "IMG_1234.HEIC" → "img_1234". */
export function baseKey(name: string): string {
  const i = name.lastIndexOf('.')
  return (i > 0 ? name.slice(0, i) : name).toLowerCase()
}

export function splitLiveFiles(files: File[]): { images: File[], videos: File[] } {
  const images: File[] = []
  const videos: File[] = []
  for (const f of files) (looksLikeLiveVideo(f) ? videos : images).push(f)
  return { images, videos }
}
