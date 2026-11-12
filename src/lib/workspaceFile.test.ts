/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { parseWorkspaceFile } from './workspaceFile'

/** Any data URL works: the parser only re-materialises bytes, it never decodes. */
const still = (payload: string) => `data:text/plain;base64,${btoa(payload)}`

/** A doc with one plain photo and one sticker with a video pair and a source. */
function docFile() {
  const doc = {
    version: 1,
    app: 'koma',
    savedAt: '2026-01-02T03:04:05Z',
    workspaces: [{ id: 'w1' }],
    activeId: 'w1',
    settings: { gap: 0, radius: 0, bg: '#000000', longSide: 2048, format: 'image/jpeg', quality: 0.92 },
    photos: [
      { id: 'p1', name: 'IMG_1.png', trueW: 4, trueH: 4, data: still('one') },
      {
        id: 'p2',
        name: 'IMG_2.HEIC',
        trueW: 4,
        trueH: 4,
        data: still('two'),
        video: still('video'),
        kind: 'sticker',
        folder: 'Faces',
        music: {
          provider: 'spotify',
          title: 'T',
          artist: 'A',
          url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
        },
      },
    ],
  }
  return new File([JSON.stringify(doc)], 'board.koma.json', { type: 'application/json' })
}

/** The same doc with one top-level field replaced. */
async function parseWith(patch: (doc: Record<string, unknown>) => void) {
  const doc = JSON.parse(await docFile().text()) as Record<string, unknown>
  patch(doc)
  return parseWorkspaceFile(new File([JSON.stringify(doc)], 'board.koma.json'))
}

describe('parseWorkspaceFile', () => {
  test('rebuilds photos as files, ids and names preserved', async () => {
    const { doc, photos } = await parseWorkspaceFile(docFile())
    expect(doc.version).toBe(1)
    expect(photos.map(p => p.id)).toEqual(['p1', 'p2'])
    const plain = photos[0]
    expect(plain?.file).toBeInstanceOf(File)
    expect(plain?.file.name).toBe('IMG_1.png')
    expect(await plain?.file.text()).toBe('one')
    expect(plain?.kind).toBeUndefined()
  })

  test('keeps a sticker whole: kind, folder, source, and the video pair renamed to .mov', async () => {
    const { photos } = await parseWorkspaceFile(docFile())
    const sticker = photos[1]
    expect(sticker?.kind).toBe('sticker')
    expect(sticker?.folder).toBe('Faces')
    expect(sticker?.music?.url).toBe('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')
    // Live Photos pair by basename (livephoto.ts baseKey), so the MOV is named after the still.
    expect(sticker?.videoFile?.name).toBe('IMG_2.mov')
    expect(await sticker?.videoFile?.text()).toBe('video')
  })

  test('rejects anything that is not a koma workspace file', async () => {
    await expect(parseWorkspaceFile(new File(['not json'], 'x.koma.json'))).rejects.toThrow('Not a koma workspace file')
    await expect(parseWith(d => d.app = 'komma')).rejects.toThrow('Not a koma workspace file')
    await expect(parseWith(d => d.version = 2)).rejects.toThrow('Not a koma workspace file')
    await expect(parseWith(d => delete d.photos)).rejects.toThrow('Not a koma workspace file')
    await expect(parseWith(d => delete d.workspaces)).rejects.toThrow('Not a koma workspace file')
    // A photo entry without a data URL is rejected up front, not by the fetch inside dataUrlToFile.
    await expect(parseWith(d => d.photos = [42])).rejects.toThrow('Not a koma workspace file')
    await expect(parseWith((d) => {
      const photos = d.photos as { data?: string }[]
      const first = photos[0]
      if (first)
        delete first.data
    })).rejects.toThrow('Not a koma workspace file')
    // An empty board array still parses; the fresh-board fill is downstream's job.
    const empty = await parseWith(d => d.workspaces = [])
    expect(empty.doc.workspaces).toEqual([])
  })

  test('drops a music source whose URL is not one of the two canonical providers', async () => {
    const { photos } = await parseWith((doc) => {
      const photos = doc.photos as { music?: { provider: string, title: string, artist: string, url: string } }[]
      const first = photos[0]
      if (first)
        first.music = { provider: 'spotify', title: 'T', artist: 'A', url: 'https://evil.example/track/x' }
    })
    expect(photos[0]?.music).toBeUndefined()
  })
})
