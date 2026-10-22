import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MUSIC_CARD_STYLE,
  fitArtist,
  fitLyrics,
  fitTitle,
  MUSIC_CARD_STYLE_IDS,
  musicCardFileName,
  TITLE_MAX_SIZE,
  TITLE_MAX_W,
  TITLE_MIN_SIZE,
} from './musicCard'

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

  test('a wide column with three lines keeps a longer title at full size', () => {
    const fit = fitTitle('A Very Long Song Title That Needs Two Whole Lines', measure, {
      maxWidth: 880,
      maxSize: 84,
      minSize: 44,
      maxLines: 3,
    })
    expect(fit.size).toBe(84)
    expect(fit.lines.length).toBeLessThanOrEqual(3)
    for (const line of fit.lines)
      expect(measure(line, fit.size)).toBeLessThanOrEqual(880)
  })

  test('the ellipsis follows the style minimum and width, not the classic ones', () => {
    const fit = fitTitle('word '.repeat(40), measure, {
      maxWidth: 400,
      maxSize: 46,
      minSize: 36,
      maxLines: 2,
    })
    expect(fit.size).toBe(36)
    expect(fit.lines).toHaveLength(2)
    expect(fit.lines[1]!.endsWith('…')).toBe(true)
    for (const line of fit.lines)
      expect(measure(line, fit.size)).toBeLessThanOrEqual(400)
  })
})

describe('the artist line', () => {
  test('it stays one line and ellipsizes too long a name', () => {
    const long = 'The Extremely Long Artist Name That Will Not Fit In Six Hundred And Forty Pixels At Thirty Pixels'
    const out = fitArtist(long, measure)
    expect(out.endsWith('…')).toBe(true)
    expect(measure(out, 30)).toBeLessThanOrEqual(TITLE_MAX_W)
  })

  test('a narrow card uses its own width and size', () => {
    const long = 'The Extremely Long Artist Name That Will Not Fit The Narrow Card At All'
    const out = fitArtist(long, measure, 400, 24)
    expect(out.endsWith('…')).toBe(true)
    expect(measure(out, 24)).toBeLessThanOrEqual(400)
  })

  test('a blank artist is omitted', () => {
    expect(fitArtist('  ', measure)).toBe('')
  })
})

describe('the lyric block', () => {
  test('short lines keep the largest size and each line stays its own line', () => {
    const fit = fitLyrics(['When you were here before', 'Couldn\'t look you in the eye'], measure)
    expect(fit.size).toBe(56)
    expect(fit.lines).toEqual(['When you were here before', 'Couldn\'t look you in the eye'])
    expect(fit.lineHeight).toBe(76)
  })

  test('a long line shrinks the block until every line fits', () => {
    const fit = fitLyrics(['a'.repeat(40), 'short'], measure)
    expect(fit.size).toBeLessThan(56)
    for (const line of fit.lines)
      expect(measure(line, fit.size)).toBeLessThanOrEqual(820)
  })

  test('a line too long at the minimum gets the ellipsis', () => {
    const fit = fitLyrics(['a'.repeat(80)], measure, { minSize: 30, maxSize: 40 })
    expect(fit.size).toBe(30)
    expect(fit.lines[0]!.endsWith('…')).toBe(true)
    expect(measure(fit.lines[0]!, 30)).toBeLessThanOrEqual(820)
  })

  test('only the leading lines and non-empty lines are kept', () => {
    const fit = fitLyrics(['one', '  ', 'two', 'three', 'four', 'five', 'six'], measure, { maxLines: 3 })
    expect(fit.lines).toEqual(['one', 'two', 'three'])
  })

  test('no lyrics draws no block', () => {
    expect(fitLyrics([], measure).lines).toEqual([])
    expect(fitLyrics(['   '], measure).lines).toEqual([])
  })
})

describe('the style list', () => {
  test('it names the six compositions once, with classic as the default', () => {
    expect([...MUSIC_CARD_STYLE_IDS]).toEqual(['classic', 'noir', 'polaroid', 'vinyl', 'editorial', 'lyric'])
    expect(new Set(MUSIC_CARD_STYLE_IDS).size).toBe(MUSIC_CARD_STYLE_IDS.length)
    expect(DEFAULT_MUSIC_CARD_STYLE).toBe('classic')
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
