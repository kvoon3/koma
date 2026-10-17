/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { fadeMask, SCROLL_FADE } from './useScrollFade'

/** Split a gradient on its top-level commas (stop positions carry their own). */
function parts(mask: string) {
  const body = mask.slice(mask.indexOf('(') + 1, mask.lastIndexOf(')'))
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(')
      depth++
    else if (ch === ')')
      depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    }
    else { cur += ch }
  }
  out.push(cur.trim())
  return out
}
const direction = (mask: string) => parts(mask)[0]
const stops = (mask: string) => parts(mask).slice(1)
/** A stop's alpha: `black` is 1, `transparent` 0, else the `/ x` of `rgb(0 0 0 / x)`. */
const alpha = (stop: string) => stop.startsWith('black') ? 1 : stop.startsWith('transparent') ? 0 : Number(stop.match(/\/ ([\d.]+)/)?.[1])

describe('fadeMask', () => {
  test('each axis fades toward its own edge vars, over the band the hook measures', () => {
    const x = fadeMask('x')
    expect(direction(x)).toBe('to right')
    expect(x).toContain(`min(${SCROLL_FADE}, var(--scroll-area-overflow-x-start, 0px))`)
    expect(x).toContain(`calc(100% - min(${SCROLL_FADE}, var(--scroll-area-overflow-x-end, 0px)))`)
    const y = fadeMask('y')
    expect(direction(y)).toBe('to bottom')
    expect(y).toContain('var(--scroll-area-overflow-y-start, 0px)')
    expect(y).toContain('var(--scroll-area-overflow-y-end, 0px)')
  })

  test('a row that fits stays opaque: the band is min(fade, overflow), so every stop collapses', () => {
    // No overflow sets the vars to 0px, and the ramp then has nowhere to run:
    // both ends are transparent-outside-black-nowhere.
    for (const mask of [fadeMask('x'), fadeMask('y')]) {
      const s = stops(mask)
      expect(s[0]).toBe('transparent 0')
      expect(s.at(-1)).toBe('transparent 100%')
      // Only the two bare corner stops sit at a fixed place; the rest ride the band.
      expect(s.slice(1, -1).every(stop => stop.includes(`min(${SCROLL_FADE}`))).toBe(true)
    }
  })

  test('the x band holds a clear gutter then eases in, so a clipped tool ghosts out', () => {
    // The bug this pins: a plain linear ramp left the tool under the cut 25–60%
    // opaque at the edge, which reads as a caption cut mid-word rather than as
    // "more tools this way". The x band runs clear gutter, easing ramp, opaque,
    // and mirrors back out at the trailing edge.
    const s = stops(fadeMask('x'))
    expect(s.map(alpha)).toEqual([0, 0, 0.07, 0.28, 0.64, 1, 1, 0.64, 0.28, 0.07, 0, 0])
    // The gutter and the ramp are shares of the measured band, so they collapse with it.
    expect(s[1]).toContain('* 0.25')
    expect(s[2]).toContain('* 0.45')
    expect(s[4]).toContain('* 0.85')
    expect(s[8]).toContain('* 0.65')
  })

  test('the y band keeps the plain linear ramp: its lists are dense text rows', () => {
    const s = stops(fadeMask('y'))
    expect(s).toEqual([
      'transparent 0',
      `black min(${SCROLL_FADE}, var(--scroll-area-overflow-y-start, 0px))`,
      `black calc(100% - min(${SCROLL_FADE}, var(--scroll-area-overflow-y-end, 0px)))`,
      'transparent 100%',
    ])
  })
})
