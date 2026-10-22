import { describe, expect, test } from 'bun:test'
import {
  CARD_FONT,
  DEFAULT_MUSIC_CARD_STYLE,
  fitArtist,
  fitTitle,
  LYRIC_FONT_STACKS,
  LYRIC_LEADINGS,
  LYRIC_SIZE_SCALE,
  lyricWindow,
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

describe('the lyric window', () => {
  test('short lines keep their own line at the base size', () => {
    const win = lyricWindow(['When you were here', 'You float like a feather'], measure)
    expect(win.size).toBe(64)
    expect(win.lines).toEqual(['When you were here', 'You float like a feather'])
    expect(win.lineHeight).toBe(83)
  })

  test('a long phrase wraps instead of shrinking to an unreadable size', () => {
    const win = lyricWindow(['a'.repeat(60)], measure)
    expect(win.size).toBe(64)
    expect(win.lines.length).toBe(3)
    for (const line of win.lines)
      expect(measure(line, win.size)).toBeLessThanOrEqual(848)
  })

  test('the window counts display lines, so a wrapped phrase fills it', () => {
    const win = lyricWindow(['a'.repeat(60), 'second', 'third'], measure, { maxLines: 3 })
    expect(win.lines).toHaveLength(3)
    expect(win.lines).not.toContain('second')
  })

  test('blank lines are dropped', () => {
    const win = lyricWindow(['one', '  ', 'two'], measure)
    expect(win.lines).toEqual(['one', 'two'])
    expect(lyricWindow([], measure).lines).toEqual([])
  })

  test('the size steps scale up', () => {
    expect(LYRIC_SIZE_SCALE.s).toBeLessThan(LYRIC_SIZE_SCALE.m)
    expect(LYRIC_SIZE_SCALE.m).toBeLessThan(LYRIC_SIZE_SCALE.l)
    expect(LYRIC_SIZE_SCALE.l).toBe(1)
  })

  test('the leading sets the line height', () => {
    expect(lyricWindow(['one'], measure, { ratio: 1.45 }).lineHeight).toBe(93)
    expect(lyricWindow(['one'], measure, { ratio: LYRIC_LEADINGS[0] }).lineHeight).toBe(74)
  })

  test('the two typefaces are distinct, and sans is the card font', () => {
    expect(LYRIC_FONT_STACKS.sans).toBe(CARD_FONT)
    expect(LYRIC_FONT_STACKS.serif).not.toBe(LYRIC_FONT_STACKS.sans)
    expect(LYRIC_LEADINGS[0]).toBeLessThan(LYRIC_LEADINGS[1])
    expect(LYRIC_LEADINGS[1]).toBeLessThan(LYRIC_LEADINGS[2])
  })
})

describe('the style list', () => {
  test('it names the two cards once, with cover as the default', () => {
    expect([...MUSIC_CARD_STYLE_IDS]).toEqual(['cover', 'lyrics'])
    expect(new Set(MUSIC_CARD_STYLE_IDS).size).toBe(MUSIC_CARD_STYLE_IDS.length)
    expect(DEFAULT_MUSIC_CARD_STYLE).toBe('cover')
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
