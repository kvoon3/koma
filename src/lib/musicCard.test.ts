import { describe, expect, test } from 'bun:test'
import { fitArtist, fitTitle, musicCardFileName, TITLE_MAX_SIZE, TITLE_MAX_W, TITLE_MIN_SIZE } from './musicCard'

/** A deterministic stand-in for canvas text: 0.5 em per character. */
const measure = (text: string, size: number) => text.length * size * 0.5

describe('the title fit', () => {
  test('a short title stays one line at full size', () => {
    expect(fitTitle('Never Gonna Give You Up', measure)).toEqual({ lines: ['Never Gonna Give You Up'], size: TITLE_MAX_SIZE })
  })

  test('a two-line title keeps the largest size that fits', () => {
    const fit = fitTitle('A Very Long Song Title That Needs Two Whole Lines', measure)
    expect(fit.lines).toHaveLength(2)
    expect(fit.size).toBeGreaterThanOrEqual(TITLE_MIN_SIZE)
    expect(fit.size).toBeLessThanOrEqual(TITLE_MAX_SIZE)
  })

  test('a title too long even at 40 shrinks to 40 and ellipsizes line two', () => {
    const fit = fitTitle('word '.repeat(40), measure)
    expect(fit.size).toBe(TITLE_MIN_SIZE)
    expect(fit.lines).toHaveLength(2)
    expect(fit.lines[1]!.endsWith('…')).toBe(true)
    for (const line of fit.lines)
      expect(measure(line, fit.size)).toBeLessThanOrEqual(TITLE_MAX_W)
  })

  test('an unbroken run (CJK has no spaces) breaks by character', () => {
    const fit = fitTitle('夜に駆ける夜に駆ける夜に駆ける夜に駆ける夜に駆ける夜に駆ける夜に駆ける', measure)
    expect(fit.lines.length).toBeLessThanOrEqual(2)
    for (const line of fit.lines)
      expect(measure(line, fit.size)).toBeLessThanOrEqual(TITLE_MAX_W)
  })

  test('blank and whitespace-only titles draw nothing', () => {
    expect(fitTitle('', measure)).toEqual({ lines: [], size: TITLE_MAX_SIZE })
    expect(fitTitle('   \n  ', measure)).toEqual({ lines: [], size: TITLE_MAX_SIZE })
  })
})

describe('the artist line', () => {
  test('it stays one line and ellipsizes too long a name', () => {
    const long = 'The Extremely Long Artist Name That Will Not Fit In Six Hundred And Forty Pixels At Thirty Pixels'
    const out = fitArtist(long, measure)
    expect(out.endsWith('…')).toBe(true)
    expect(measure(out, 30)).toBeLessThanOrEqual(TITLE_MAX_W)
  })

  test('a blank artist is omitted', () => {
    expect(fitArtist('  ', measure)).toBe('')
  })
})

describe('the file name', () => {
  test('title and artist join, with path separators removed', () => {
    expect(musicCardFileName('AC/DC', 'Back\\In Black')).toBe('AC DC - Back In Black.png')
  })

  test('windows-reserved characters and control bytes become spaces', () => {
    expect(musicCardFileName('What? <Song>: "Live" | Mix*', 'Artist')).toBe('What Song Live Mix - Artist.png')
  })

  test('a blank pair falls back to the generic name', () => {
    expect(musicCardFileName('', '')).toBe('Music card.png')
  })

  test('the name is not held to the folder-name cap', () => {
    const title = 'a'.repeat(60)
    expect(musicCardFileName(title, 'b'.repeat(60))).toBe(`${title} - ${'b'.repeat(60)}.png`)
  })
})
