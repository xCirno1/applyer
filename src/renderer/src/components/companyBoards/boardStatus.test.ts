import { describe, it, expect } from 'vitest'
import { boardStatus, boardAddress, boardStatusRank, boardFilterStatus } from './boardStatus'

function fields(overrides: Partial<Parameters<typeof boardStatus>[0]> = {}): Parameters<typeof boardStatus>[0] {
  return { lastError: null, lastCheckedAt: null, lastJobCount: null, ...overrides }
}

describe('boardStatus', () => {
  it('reports a board nothing has fetched yet as unchecked', () => {
    expect(boardStatus(fields())).toEqual({ kind: 'unchecked' })
  })

  it('reports the open role count once a fetch has happened', () => {
    expect(boardStatus(fields({ lastCheckedAt: '2024-01-01T00:00:00.000Z', lastJobCount: 12 }))).toEqual({
      kind: 'roles',
      count: 12
    })
  })

  it('treats an empty board as a real answer of zero, not as a missing one', () => {
    expect(boardStatus(fields({ lastCheckedAt: '2024-01-01T00:00:00.000Z', lastJobCount: 0 }))).toEqual({
      kind: 'roles',
      count: 0
    })
  })

  it('keeps "reached but never counted" apart from "empty", which is a claim about the company', () => {
    expect(boardStatus(fields({ lastCheckedAt: '2024-01-01T00:00:00.000Z', lastJobCount: null }))).toEqual({
      kind: 'uncounted'
    })
  })

  it('refuses a negative or fractional count rather than rendering it', () => {
    expect(boardStatus(fields({ lastCheckedAt: '2024-01-01T00:00:00.000Z', lastJobCount: -4 }))).toEqual({
      kind: 'roles',
      count: 0
    })
    expect(boardStatus(fields({ lastCheckedAt: '2024-01-01T00:00:00.000Z', lastJobCount: 7.9 }))).toEqual({
      kind: 'roles',
      count: 7
    })
    expect(boardStatus(fields({ lastCheckedAt: '2024-01-01T00:00:00.000Z', lastJobCount: Number.NaN }))).toEqual({
      kind: 'roles',
      count: 0
    })
  })

  it('shows the error instead of the count a failing board still carries', () => {
    const status = boardStatus(
      fields({ lastError: 'HTTP 404', lastCheckedAt: '2024-01-01T00:00:00.000Z', lastJobCount: 30 })
    )
    expect(status).toEqual({ kind: 'error', message: 'HTTP 404' })
  })

  it('ignores a blank error string, which would leave an empty cell where a reason belongs', () => {
    expect(boardStatus(fields({ lastError: '   ', lastCheckedAt: '2024-01-01T00:00:00.000Z', lastJobCount: 3 }))).toEqual(
      { kind: 'roles', count: 3 }
    )
    expect(boardStatus(fields({ lastError: '' }))).toEqual({ kind: 'unchecked' })
  })
})

describe('boardAddress', () => {
  it('is just the slug for the three slug-only providers', () => {
    expect(boardAddress({ token: 'acme', host: null, site: null })).toEqual({
      token: 'acme',
      site: null,
      full: 'acme'
    })
  })

  it('keeps host, tenant and career site for a Workday board', () => {
    expect(
      boardAddress({ token: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: 'External_Careers' })
    ).toEqual({
      token: 'acme',
      site: 'External_Careers',
      full: 'acme.wd5.myworkdayjobs.com / acme / External_Careers'
    })
  })

  it('drops whitespace-only parts instead of rendering a dangling separator', () => {
    expect(boardAddress({ token: '  acme  ', host: '   ', site: '' })).toEqual({
      token: 'acme',
      site: null,
      full: 'acme'
    })
  })
})

describe('boardStatusRank', () => {
  it('puts the boards that need attention first on the descending click a column gets first', () => {
    const ranks = [
      boardStatusRank({ kind: 'error', message: 'HTTP 404' }),
      boardStatusRank({ kind: 'unchecked' }),
      boardStatusRank({ kind: 'uncounted' }),
      boardStatusRank({ kind: 'roles', count: 12 }),
      boardStatusRank({ kind: 'roles', count: 0 })
    ]
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
  })

  it('separates an empty board from one nothing has fetched yet', () => {
    expect(boardStatusRank({ kind: 'roles', count: 0 })).not.toBe(boardStatusRank({ kind: 'unchecked' }))
    expect(boardStatusRank({ kind: 'uncounted' })).not.toBe(boardStatusRank({ kind: 'unchecked' }))
  })

  it('will not let an absurd count from a provider pass itself off as a failing board', () => {
    expect(boardStatusRank({ kind: 'roles', count: Number.MAX_SAFE_INTEGER })).toBeLessThan(
      boardStatusRank({ kind: 'uncounted' })
    )
  })
})

describe('boardFilterStatus', () => {
  const checked = '2026-01-01T00:00:00.000Z'

  it('files a paused board under paused whatever it last returned', () => {
    expect(
      boardFilterStatus({ enabled: false, lastError: 'HTTP 500', lastCheckedAt: checked, lastJobCount: 3 })
    ).toBe('paused')
    expect(boardFilterStatus({ enabled: false, lastError: null, lastCheckedAt: null, lastJobCount: null })).toBe(
      'paused'
    )
  })

  it('splits the active boards by what their last fetch came back with', () => {
    expect(boardFilterStatus({ enabled: true, lastError: 'HTTP 404', lastCheckedAt: checked, lastJobCount: 2 })).toBe(
      'error'
    )
    expect(boardFilterStatus({ enabled: true, lastError: null, lastCheckedAt: null, lastJobCount: null })).toBe(
      'unchecked'
    )
    expect(boardFilterStatus({ enabled: true, lastError: null, lastCheckedAt: checked, lastJobCount: 0 })).toBe('empty')
    expect(boardFilterStatus({ enabled: true, lastError: null, lastCheckedAt: checked, lastJobCount: 7 })).toBe('open')
  })

  it('files a board that was reached but never counted with the ones there is no result for', () => {
    expect(boardFilterStatus({ enabled: true, lastError: null, lastCheckedAt: checked, lastJobCount: null })).toBe(
      'unchecked'
    )
  })

  it('counts a board whose count came back unusable as empty, not as busy', () => {
    expect(
      boardFilterStatus({ enabled: true, lastError: null, lastCheckedAt: checked, lastJobCount: Number.NaN })
    ).toBe('empty')
  })
})
