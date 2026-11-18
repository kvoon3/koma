import type { SessionPhotoRecord, SessionSource } from './sessionStore'
import { describe, expect, test } from 'bun:test'
import { captureCloudSave, parseCloudDocumentText, referencedPhotoIds } from './cloudSession'

function photo(id: string): SessionPhotoRecord {
  return {
    id,
    name: `${id}.jpg`,
    file: new File([id], `${id}.jpg`, { type: 'image/jpeg' }),
    trueW: 10,
    trueH: 10,
  }
}

function workspace(photoId: string) {
  return {
    id: 'w1',
    root: {
      type: 'leaf' as const,
      id: 'p1',
      photoId,
      zoom: 1,
      cx: 0.5,
      cy: 0.5,
      stickers: [],
      label: null,
    },
    focusId: 'p1',
    canvasRatio: null,
    canvasFill: 1,
    stickers: [],
    labels: [],
  }
}

function source(photos: SessionPhotoRecord[], photoId: string): SessionSource & { photos: SessionPhotoRecord[] } {
  return {
    grids: [{ id: 'g1', name: 'Group' }],
    activeGridId: 'g1',
    workspaces: [workspace(photoId)],
    activeId: 'w1',
    parkedBoards: {},
    stickerFolders: [],
    photoTags: [],
    gap: 0,
    radius: 0,
    bg: '#ffffff',
    cutouts: {},
    cutoutSets: {},
    bgGradient: null,
    bgImage: null,
    longSide: 1,
    format: 'image/jpeg',
    quality: 0.9,
    photos,
  }
}

describe('captureCloudSave', () => {
  test('the upload list and the document are one read', () => {
    const a = photo('a')
    const b = photo('b')
    const state = source([a], a.id)
    const plan = captureCloudSave(state)

    // A placement lands while the save's uploads run: the store replaces its
    // arrays, which the captured plan must not follow.
    state.photos = [a, b]
    state.workspaces = [workspace(b.id)]

    const document = parseCloudDocumentText(plan.document)
    expect(document).not.toBeNull()
    if (!document)
      return
    expect(plan.photos.map(p => p.id)).toEqual(['a'])
    expect(referencedPhotoIds(document.session)).toEqual(['a'])
  })
})
