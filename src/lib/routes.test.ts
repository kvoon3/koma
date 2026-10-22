/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { isGridPath, isHubPath, LEGACY_INDEX_PATH, LIBRARY_PATH, OVERVIEW_PATH } from './routes'

describe('the route predicates the chrome keys off', () => {
  test('the board overview is the root', () => {
    expect(OVERVIEW_PATH).toBe('/')
    expect(isGridPath('/')).toBe(true)
    expect(isGridPath('/photos')).toBe(false)
    expect(isGridPath('/w/w-1')).toBe(false)
  })

  test('the library, its old routes and the retained launcher draw no board', () => {
    expect(LIBRARY_PATH).toBe('/library')
    expect(isHubPath(LIBRARY_PATH)).toBe(true)
    expect(isHubPath('/photos')).toBe(true)
    expect(isHubPath('/stickers')).toBe(true)
    expect(isHubPath(LEGACY_INDEX_PATH)).toBe(true)
  })

  test('the overview and the editor keep the board chrome', () => {
    expect(isHubPath('/')).toBe(false)
    expect(isHubPath('/w/w-1')).toBe(false)
    expect(isGridPath(LEGACY_INDEX_PATH)).toBe(false)
    expect(isGridPath(LIBRARY_PATH)).toBe(false)
  })

  test('the retired hub route is not the overview, and nothing else is', () => {
    expect(LEGACY_INDEX_PATH).not.toBe(OVERVIEW_PATH)
    // The launcher used to live at the root; the demoted path must not collide
    // with a library or the editor.
    expect([OVERVIEW_PATH, LIBRARY_PATH, '/photos', '/stickers', '/w/$wsId']).not.toContain(LEGACY_INDEX_PATH)
  })
})
