/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { labelAlign, labelAlignOffset, labelTextLines, newLabel, normalizeLabelText } from './panes'

describe('label alignment', () => {
  it('defaults to center so old sessions look unchanged', () => {
    expect(labelAlign(newLabel())).toBe('center')
    expect(labelAlign({ align: 'left' })).toBe('left')
    expect(labelAlign({ align: 'right' })).toBe('right')
  })

  it('places a line inside the block width', () => {
    expect(labelAlignOffset('left', 100, 40)).toBe(0)
    expect(labelAlignOffset('center', 100, 40)).toBe(30)
    expect(labelAlignOffset('right', 100, 40)).toBe(60)
    // A line as wide as the block starts at 0 for every alignment.
    for (const align of ['left', 'center', 'right'] as const)
      expect(labelAlignOffset(align, 100, 100)).toBe(0)
  })

  it('splits on explicit newlines only (no auto-wrap)', () => {
    expect(labelTextLines('one\ntwo\nthree')).toEqual(['one', 'two', 'three'])
    expect(labelTextLines('a very long single line that must never wrap by itself')).toHaveLength(1)
    expect(labelTextLines('crlf\r\nline')).toEqual(['crlf', 'line'])
    expect(labelTextLines('trailing\n')).toEqual(['trailing', ''])
  })
})

describe('normalizeLabelText', () => {
  it('trims lines and drops blank edges but keeps interior blank lines', () => {
    expect(normalizeLabelText('  first  \n\n  second\n')).toBe('first\n\nsecond')
    expect(normalizeLabelText('\n\nfirst\nsecond\n\n')).toBe('first\nsecond')
    expect(normalizeLabelText('   ')).toBe('')
  })

  it('normalizes CRLF from a paste', () => {
    expect(normalizeLabelText('a\r\nb')).toBe('a\nb')
  })
})
