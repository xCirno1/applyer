import { describe, it, expect, vi } from 'vitest'
import {
  compareCells,
  filterAndSort,
  isNarrowedEmpty,
  matchesQuery,
  nextSortDir,
  readValue,
  sortRows,
  type CellAccessors
} from './dataTable'

interface Row {
  id: string
  company: string
  provider: string
  count: number | null
  checked: string | null
}

function row(overrides: Partial<Row> = {}): Row {
  return { id: 'r1', company: 'Acme', provider: 'greenhouse', count: 3, checked: '2026-01-01', ...overrides }
}

const VALUES: CellAccessors<Row> = {
  company: (r) => r.company,
  provider: (r) => r.provider,
  count: (r) => r.count,
  checked: (r) => r.checked
}

const SEARCH_KEYS = ['company', 'provider', 'count']

describe('readValue', () => {
  it('reports an accessor that throws instead of letting it escape into render', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const accessor = (): string => {
      throw new Error('bad row')
    }
    expect(readValue(accessor, row(), 'company')).toBeNull()
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('compareCells', () => {
  it('compares numbers numerically rather than as text', () => {
    expect(compareCells(9, 10)).toBeLessThan(0)
  })

  it('compares strings with natural number ordering', () => {
    expect(compareCells('run-2', 'run-10')).toBeLessThan(0)
  })

  it('orders false before true', () => {
    expect(compareCells(false, true)).toBeLessThan(0)
  })

  it('treats every absent value the same way, including a non-finite number', () => {
    for (const missing of [null, undefined, '', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(compareCells(missing, 'a')).toBeGreaterThan(0)
      expect(compareCells('a', missing)).toBeLessThan(0)
    }
    expect(compareCells(null, undefined)).toBe(0)
  })

  it('falls back to a string compare when the two types disagree', () => {
    expect(compareCells(2, 'b')).toBeLessThan(0)
  })
})

describe('nextSortDir', () => {
  it('starts a column that is not sorted yet at descending', () => {
    expect(nextSortDir(false, 'asc')).toBe('desc')
    expect(nextSortDir(false, 'desc')).toBe('desc')
  })

  it('flips the sorted column between descending and ascending', () => {
    expect(nextSortDir(true, 'desc')).toBe('asc')
    expect(nextSortDir(true, 'asc')).toBe('desc')
  })
})

describe('matchesQuery', () => {
  it('matches every row while the query is blank', () => {
    expect(matchesQuery(row(), VALUES, SEARCH_KEYS, '   ')).toBe(true)
  })

  it('matches case-insensitively across any searched column', () => {
    expect(matchesQuery(row(), VALUES, SEARCH_KEYS, 'ACME')).toBe(true)
    expect(matchesQuery(row(), VALUES, SEARCH_KEYS, 'greenh')).toBe(true)
  })

  it('requires every token, but lets them land in different columns', () => {
    expect(matchesQuery(row(), VALUES, SEARCH_KEYS, 'acme green')).toBe(true)
    expect(matchesQuery(row(), VALUES, SEARCH_KEYS, 'acme lever')).toBe(false)
  })

  it('searches numeric values as their rendered text', () => {
    expect(matchesQuery(row({ count: 42 }), VALUES, SEARCH_KEYS, '42')).toBe(true)
  })

  it('ignores columns outside the searched set', () => {
    expect(matchesQuery(row(), VALUES, SEARCH_KEYS, '2026-01-01')).toBe(false)
  })

  it('matches nothing when the searched keys have no accessors behind them', () => {
    expect(matchesQuery(row(), VALUES, ['nope'], 'acme')).toBe(false)
  })
})

describe('sortRows', () => {
  const rows = [
    row({ id: 'a', company: 'Zeta', count: 1 }),
    row({ id: 'b', company: 'Acme', count: 10 }),
    row({ id: 'c', company: 'Mid', count: null })
  ]

  it('leaves the caller order alone when no column is sorted', () => {
    expect(sortRows(rows, VALUES, null, 'asc')).toBe(rows)
  })

  it('sorts ascending and descending on the named column', () => {
    expect(sortRows(rows, VALUES, 'company', 'asc').map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(sortRows(rows, VALUES, 'company', 'desc').map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })

  it('keeps rows with no value at the bottom in both directions', () => {
    expect(sortRows(rows, VALUES, 'count', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(sortRows(rows, VALUES, 'count', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('does not disturb rows that tie', () => {
    const tied = [row({ id: 'a', count: 5 }), row({ id: 'b', count: 5 }), row({ id: 'c', count: 5 })]
    expect(sortRows(tied, VALUES, 'count', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('never mutates the array it was given', () => {
    const original = [...rows]
    sortRows(rows, VALUES, 'company', 'asc')
    expect(rows).toEqual(original)
  })

  it('ignores a sort on a key with no accessor behind it', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(sortRows(rows, VALUES, 'nope', 'asc')).toBe(rows)
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('filterAndSort', () => {
  const rows = [
    row({ id: 'a', company: 'Zeta', provider: 'lever', count: 1 }),
    row({ id: 'b', company: 'Acme', provider: 'greenhouse', count: 10 }),
    row({ id: 'c', company: 'Acme Labs', provider: 'lever', count: 4 })
  ]

  it('hands back the same array when nothing is active', () => {
    expect(filterAndSort(rows, VALUES, SEARCH_KEYS, '', null, 'desc')).toBe(rows)
  })

  it('filters before sorting', () => {
    const result = filterAndSort(rows, VALUES, SEARCH_KEYS, 'acme', 'count', 'desc')
    expect(result.map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('can narrow to nothing without throwing', () => {
    expect(filterAndSort(rows, VALUES, SEARCH_KEYS, 'nobody', 'company', 'asc')).toEqual([])
  })

  it('sorts an empty list as happily as a full one', () => {
    expect(filterAndSort([], VALUES, SEARCH_KEYS, '', 'company', 'asc')).toEqual([])
  })
})

describe('isNarrowedEmpty', () => {
  it('reads a table with no filter bar as genuinely empty', () => {
    expect(isNarrowedEmpty(undefined, false, undefined)).toBe(false)
  })

  it('reads a blank filter box as genuinely empty', () => {
    expect(isNarrowedEmpty(undefined, true, '')).toBe(false)
  })

  it('reads text in the filter box as "nothing matched"', () => {
    expect(isNarrowedEmpty(undefined, true, 'acme')).toBe(true)
  })

  it('believes a caller that narrows rows outside the filter box', () => {
    // A provider dropdown with no boards on it: the box is blank, but the
    // table is empty because of a choice, not because nothing is tracked.
    expect(isNarrowedEmpty(true, true, '')).toBe(true)
  })

  it('believes a caller that says nothing is narrowing, whatever the box holds', () => {
    expect(isNarrowedEmpty(false, true, 'acme')).toBe(false)
  })
})
