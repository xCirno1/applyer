import { describe, it, expect } from 'vitest'
import { EMPTY_SELECTION, nextRowSelection, visibleSelection, type RowSelection } from './rowSelection'

const ORDER = ['a', 'b', 'c', 'd', 'e']

const PLAIN = { shiftKey: false, modKey: false }
const MOD = { shiftKey: false, modKey: true }
const SHIFT = { shiftKey: true, modKey: false }
const MOD_SHIFT = { shiftKey: true, modKey: true }

function selection(keys: string[], anchor: string | null): RowSelection {
  return { selected: new Set(keys), anchor }
}

function keys(state: RowSelection): string[] {
  return [...state.selected]
}

describe('nextRowSelection', () => {
  it('selects exactly one row on a plain click', () => {
    const state = nextRowSelection(ORDER, selection(['a', 'b'], 'a'), 'd', PLAIN)
    expect(keys(state)).toEqual(['d'])
    expect(state.anchor).toBe('d')
  })

  it('keeps a plain click on an already selected row selected', () => {
    const state = nextRowSelection(ORDER, selection(['d'], 'd'), 'd', PLAIN)
    expect(keys(state)).toEqual(['d'])
  })

  it('toggles one row with the mod key, leaving the rest alone', () => {
    const added = nextRowSelection(ORDER, selection(['a'], 'a'), 'c', MOD)
    expect(keys(added).sort()).toEqual(['a', 'c'])
    expect(added.anchor).toBe('c')

    const removed = nextRowSelection(ORDER, added, 'a', MOD)
    expect(keys(removed)).toEqual(['c'])
  })

  it('selects the range from the anchor with shift', () => {
    const state = nextRowSelection(ORDER, selection(['b'], 'b'), 'd', SHIFT)
    expect(visibleSelection(ORDER, state.selected)).toEqual(['b', 'c', 'd'])
  })

  it('selects the range in either direction', () => {
    const state = nextRowSelection(ORDER, selection(['d'], 'd'), 'b', SHIFT)
    expect(visibleSelection(ORDER, state.selected)).toEqual(['b', 'c', 'd'])
  })

  it('re-spans from the same anchor rather than growing, so shift can shrink a range', () => {
    const wide = nextRowSelection(ORDER, selection(['b'], 'b'), 'e', SHIFT)
    expect(visibleSelection(ORDER, wide.selected)).toEqual(['b', 'c', 'd', 'e'])

    const narrowed = nextRowSelection(ORDER, wide, 'c', SHIFT)
    expect(visibleSelection(ORDER, narrowed.selected)).toEqual(['b', 'c'])
    expect(narrowed.anchor).toBe('b')
  })

  it('treats a shift click with no anchor as picking the anchor', () => {
    const state = nextRowSelection(ORDER, EMPTY_SELECTION, 'c', SHIFT)
    expect(keys(state)).toEqual(['c'])
    expect(state.anchor).toBe('c')
  })

  it('spans from the clicked row when the anchor is no longer visible', () => {
    // 'z' was selected before the list was filtered; the range cannot start there.
    const state = nextRowSelection(ORDER, selection(['z'], 'z'), 'c', SHIFT)
    expect(keys(state)).toEqual(['c'])
    expect(state.anchor).toBe('c')
  })

  it('adds a range to the existing selection with mod+shift', () => {
    const first = nextRowSelection(ORDER, EMPTY_SELECTION, 'a', PLAIN)
    const held = nextRowSelection(ORDER, first, 'c', MOD)
    const extended = nextRowSelection(ORDER, held, 'e', MOD_SHIFT)
    expect(visibleSelection(ORDER, extended.selected)).toEqual(['a', 'c', 'd', 'e'])
  })

  it('spans the visible order, not the underlying one, so a re-sorted table ranges by what is on screen', () => {
    const resorted = ['e', 'd', 'c', 'b', 'a']
    const state = nextRowSelection(resorted, selection(['e'], 'e'), 'c', SHIFT)
    expect(visibleSelection(resorted, state.selected)).toEqual(['e', 'd', 'c'])
  })

  it('leaves the selection untouched for a row that is not on screen', () => {
    const before = selection(['a'], 'a')
    expect(nextRowSelection(ORDER, before, 'gone', PLAIN)).toBe(before)
  })
})

describe('visibleSelection', () => {
  it('returns the selected rows in visible order', () => {
    expect(visibleSelection(ORDER, new Set(['d', 'a']))).toEqual(['a', 'd'])
  })

  it('drops selected rows that are filtered out rather than acting on them', () => {
    expect(visibleSelection(ORDER, new Set(['a', 'hidden']))).toEqual(['a'])
  })

  it('is empty for an empty selection', () => {
    expect(visibleSelection(ORDER, new Set())).toEqual([])
  })
})
