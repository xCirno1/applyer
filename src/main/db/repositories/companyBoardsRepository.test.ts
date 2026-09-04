import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import {
  addCompanyBoard,
  countCompanyBoards,
  getCompanyBoardByKey,
  getCompanyBoardsByIds,
  importCompanyBoards,
  listAllCompanyBoards,
  listCompanyBoardKeys,
  listCompanyBoards,
  listSearchableCompanyBoards,
  recordCompanyBoardFetch,
  removeCompanyBoard,
  removeCompanyBoards,
  setCompanyBoardEnabled,
  setCompanyBoardsEnabled,
  type AddCompanyBoardInput
} from './companyBoardsRepository'
import { MAX_COMPANY_BOARDS } from '@shared/constants'

function input(overrides: Partial<AddCompanyBoardInput> = {}): AddCompanyBoardInput {
  const token = overrides.token ?? 'acme'
  const provider = overrides.provider ?? 'greenhouse'
  return {
    provider,
    token,
    host: null,
    site: null,
    boardKey: overrides.boardKey ?? `${provider}:${token}`,
    companyName: overrides.companyName ?? 'Acme',
    addedBy: overrides.addedBy ?? 'user',
    ...overrides
  }
}

describe('addCompanyBoard', () => {
  it('stores a board and reads it back by key', () => {
    const result = addCompanyBoard(input())
    expect(result.status).toBe('added')
    if (result.status === 'limit_reached') throw new Error('unreachable')

    expect(result.board).toMatchObject({
      provider: 'greenhouse',
      token: 'acme',
      companyName: 'Acme',
      addedBy: 'user',
      enabled: true,
      lastCheckedAt: null,
      lastJobCount: null
    })
    expect(getCompanyBoardByKey('greenhouse:acme')?.id).toBe(result.board.id)
  })

  it('reports a re-add as already tracked rather than failing or duplicating', () => {
    const first = addCompanyBoard(input())
    const second = addCompanyBoard(input({ companyName: 'Acme Renamed' }))

    expect(second.status).toBe('already_tracked')
    if (second.status === 'limit_reached') throw new Error('unreachable')
    if (first.status === 'limit_reached') throw new Error('unreachable')
    expect(second.board.id).toBe(first.board.id)
    expect(countCompanyBoards()).toBe(1)
  })

  it('keeps the same slug on two different providers apart', () => {
    addCompanyBoard(input({ provider: 'lever', boardKey: 'lever:acme' }))
    addCompanyBoard(input({ provider: 'ashby', boardKey: 'ashby:acme' }))
    expect(countCompanyBoards()).toBe(2)
  })

  it('refuses to grow past the ceiling, since every board is a request per search', () => {
    for (let i = 0; i < MAX_COMPANY_BOARDS; i++) {
      addCompanyBoard(input({ token: `c${i}`, boardKey: `greenhouse:c${i}` }))
    }
    const result = addCompanyBoard(input({ token: 'one-too-many', boardKey: 'greenhouse:one-too-many' }))
    expect(result).toEqual({ status: 'limit_reached', limit: MAX_COMPANY_BOARDS })
    expect(countCompanyBoards()).toBe(MAX_COMPANY_BOARDS)
  })

  it('still reports an existing board as tracked once the ceiling is reached', () => {
    for (let i = 0; i < MAX_COMPANY_BOARDS; i++) {
      addCompanyBoard(input({ token: `c${i}`, boardKey: `greenhouse:c${i}` }))
    }
    expect(addCompanyBoard(input({ token: 'c0', boardKey: 'greenhouse:c0' })).status).toBe('already_tracked')
  })

  it('stores a Workday board with its host and career site', () => {
    const result = addCompanyBoard(
      input({
        provider: 'workday',
        token: 'acme',
        host: 'acme.wd5.myworkdayjobs.com',
        site: 'AcmeCareers',
        boardKey: 'workday:acme:acme.wd5.myworkdayjobs.com:acmecareers'
      })
    )
    if (result.status === 'limit_reached') throw new Error('unreachable')
    expect(result.board).toMatchObject({ host: 'acme.wd5.myworkdayjobs.com', site: 'AcmeCareers' })
  })
})

describe('seedJobCount', () => {
  it('is null for a board nobody claimed a size for', () => {
    addCompanyBoard(input({ token: 'acme', boardKey: 'greenhouse:acme' }))
    expect(getCompanyBoardByKey('greenhouse:acme')?.seedJobCount).toBeNull()
  })

  it('is stored as given for a board that came from a feed', () => {
    addCompanyBoard(input({ token: 'globex', boardKey: 'greenhouse:globex', seedJobCount: 0 }))
    expect(getCompanyBoardByKey('greenhouse:globex')?.seedJobCount).toBe(0)
  })

  it('drops a claim no board could have rather than storing it', () => {
    // The value reaches here from a CSV column or an imported bundle, so
    // "-5 open roles" is a thing a file can say. Storing it would order
    // sweeps by a number that means nothing.
    addCompanyBoard(input({ token: 'odd', boardKey: 'greenhouse:odd', seedJobCount: -5 }))
    addCompanyBoard(input({ token: 'frac', boardKey: 'greenhouse:frac', seedJobCount: 7.9 }))

    expect(getCompanyBoardByKey('greenhouse:odd')?.seedJobCount).toBeNull()
    expect(getCompanyBoardByKey('greenhouse:frac')?.seedJobCount).toBe(7)
  })
})

describe('listCompanyBoards', () => {
  beforeEach(() => {
    addCompanyBoard(input({ token: 'zeta', boardKey: 'greenhouse:zeta', companyName: 'Zeta Corp' }))
    addCompanyBoard(input({ token: 'alpha', boardKey: 'greenhouse:alpha', companyName: 'alpha labs' }))
  })

  it('orders alphabetically, case-insensitively — this is a watchlist, not a feed', () => {
    expect(listCompanyBoards({}).boards.map((b) => b.companyName)).toEqual(['alpha labs', 'Zeta Corp'])
  })

  it('paginates with a total that ignores the page window', () => {
    const page = listCompanyBoards({ limit: 1, offset: 1 })
    expect(page.boards.map((b) => b.companyName)).toEqual(['Zeta Corp'])
    expect(page.total).toBe(2)
  })

  it('searches company name and slug alike', () => {
    expect(listCompanyBoards({ search: 'zeta' }).total).toBe(1)
    expect(listCompanyBoards({ search: 'ALPHA' }).total).toBe(1)
    expect(listCompanyBoards({ search: 'nothing' }).total).toBe(0)
  })

  it('clamps a nonsense limit rather than trusting it', () => {
    expect(listCompanyBoards({ limit: -5 }).boards.length).toBe(1)
    expect(listCompanyBoards({ limit: 10_000 }).boards.length).toBe(2)
    expect(listCompanyBoards({ offset: -1 }).boards.length).toBe(2)
  })
})

describe('listSearchableCompanyBoards', () => {
  beforeEach(() => {
    addCompanyBoard(input({ token: 'gh', boardKey: 'greenhouse:gh' }))
    addCompanyBoard(input({ provider: 'lever', token: 'lv', boardKey: 'lever:lv' }))
  })

  it('returns every enabled board when no provider filter is given', () => {
    expect(listSearchableCompanyBoards().map((b) => b.token).sort()).toEqual(['gh', 'lv'])
  })

  it('narrows to the requested providers', () => {
    expect(listSearchableCompanyBoards(['lever']).map((b) => b.token)).toEqual(['lv'])
  })

  it('returns nothing for an empty provider list, rather than everything', () => {
    expect(listSearchableCompanyBoards([])).toEqual([])
  })

  it('skips a paused board', () => {
    const board = getCompanyBoardByKey('greenhouse:gh')!
    setCompanyBoardEnabled(board.id, false)
    expect(listSearchableCompanyBoards().map((b) => b.token)).toEqual(['lv'])
  })
})

describe('recordCompanyBoardFetch', () => {
  beforeEach(() => {
    addCompanyBoard(input())
  })

  it('stores an empty board as zero roles with no error, since that is a real answer', () => {
    recordCompanyBoardFetch('greenhouse:acme', { jobCount: 0 }, '2026-08-30T10:00:00.000Z')
    const board = getCompanyBoardByKey('greenhouse:acme')!
    expect(board.lastJobCount).toBe(0)
    expect(board.lastError).toBeNull()
    expect(board.lastCheckedAt).toBe('2026-08-30T10:00:00.000Z')
  })

  it('stores an error and then clears it on the next successful fetch', () => {
    recordCompanyBoardFetch('greenhouse:acme', { jobCount: 0, error: 'Board not found (404)' })
    expect(getCompanyBoardByKey('greenhouse:acme')!.lastError).toContain('404')

    recordCompanyBoardFetch('greenhouse:acme', { jobCount: 7 })
    const board = getCompanyBoardByKey('greenhouse:acme')!
    expect(board.lastError).toBeNull()
    expect(board.lastJobCount).toBe(7)
  })

  it('keeps the last real count when a fetch could not count the board', () => {
    // A Workday keyword search reaches the board without measuring it, so it
    // records that the board was checked without overwriting the size
    // something else actually counted (see `boardFetchRecord.countsWholeBoard`).
    recordCompanyBoardFetch('greenhouse:acme', { jobCount: 41 }, '2026-08-30T10:00:00.000Z')
    recordCompanyBoardFetch('greenhouse:acme', { jobCount: null }, '2026-08-31T10:00:00.000Z')

    const board = getCompanyBoardByKey('greenhouse:acme')!
    expect(board.lastJobCount).toBe(41)
    expect(board.lastCheckedAt).toBe('2026-08-31T10:00:00.000Z')
  })

  it('still records an error from a fetch that could not count the board', () => {
    recordCompanyBoardFetch('greenhouse:acme', { jobCount: 41 }, '2026-08-30T10:00:00.000Z')
    recordCompanyBoardFetch('greenhouse:acme', { jobCount: null, error: 'timed out' })

    const board = getCompanyBoardByKey('greenhouse:acme')!
    expect(board.lastError).toBe('timed out')
    expect(board.lastJobCount).toBe(41)
  })

  it('is a no-op for a board that has since been removed', () => {
    expect(() => recordCompanyBoardFetch('greenhouse:gone', { jobCount: 1 })).not.toThrow()
  })
})

describe('setCompanyBoardEnabled / removeCompanyBoard', () => {
  it('toggles a board and returns the updated row', () => {
    const added = addCompanyBoard(input())
    if (added.status === 'limit_reached') throw new Error('unreachable')

    expect(setCompanyBoardEnabled(added.board.id, false)?.enabled).toBe(false)
    expect(setCompanyBoardEnabled(added.board.id, true)?.enabled).toBe(true)
  })

  it('returns null for an unknown id instead of inventing a row', () => {
    expect(setCompanyBoardEnabled('nope', false)).toBeNull()
  })

  it('removes a board and reports whether anything was removed', () => {
    const added = addCompanyBoard(input())
    if (added.status === 'limit_reached') throw new Error('unreachable')

    expect(removeCompanyBoard(added.board.id)).toBe(true)
    expect(removeCompanyBoard(added.board.id)).toBe(false)
    expect(countCompanyBoards()).toBe(0)
  })
})

describe('listAllCompanyBoards', () => {
  it('returns every board unpaginated, for a one-shot read', () => {
    addCompanyBoard(input({ token: 'a', boardKey: 'greenhouse:a' }))
    addCompanyBoard(input({ token: 'b', boardKey: 'greenhouse:b' }))
    expect(listAllCompanyBoards()).toHaveLength(2)
  })
})

describe('listCompanyBoardKeys', () => {
  it('answers the same question as getCompanyBoardByKey, for every key at once', () => {
    addCompanyBoard(input({ token: 'a', boardKey: 'greenhouse:a' }))
    addCompanyBoard(input({ provider: 'lever', token: 'b', boardKey: 'lever:b' }))

    const keys = listCompanyBoardKeys()

    expect(keys.has('greenhouse:a')).toBe(true)
    expect(keys.has('lever:b')).toBe(true)
    expect(keys.has('ashby:c')).toBe(false)
    expect(keys.size).toBe(2)
  })

  it('is an empty set on an empty watchlist rather than throwing', () => {
    expect(listCompanyBoardKeys().size).toBe(0)
  })

  it('drops a key as soon as its board is removed', () => {
    const added = addCompanyBoard(input({ token: 'a', boardKey: 'greenhouse:a' }))
    expect(added.status).toBe('added')
    if (added.status !== 'added') return

    removeCompanyBoard(added.board.id)
    expect(listCompanyBoardKeys().has('greenhouse:a')).toBe(false)
  })
})

describe('bulk selection actions', () => {
  function three(): string[] {
    return ['a', 'b', 'c'].map((token) => {
      const added = addCompanyBoard(input({ token, boardKey: `greenhouse:${token}` }))
      if (added.status === 'limit_reached') throw new Error('unreachable')
      return added.board.id
    })
  }

  it('reads back only the boards named, and skips ids that no longer exist', () => {
    const [first, , third] = three()

    const found = getCompanyBoardsByIds([first!, 'gone', third!])

    expect(found.map((board) => board.token).sort()).toEqual(['a', 'c'])
  })

  it('reads nothing for an empty id list rather than every board', () => {
    three()
    expect(getCompanyBoardsByIds([])).toEqual([])
  })

  it('pauses a selection in one write and reports how many rows changed', () => {
    const [first, second] = three()

    expect(setCompanyBoardsEnabled([first!, second!, 'gone'], false)).toBe(2)
    expect(getCompanyBoardByKey('greenhouse:a')?.enabled).toBe(false)
    expect(getCompanyBoardByKey('greenhouse:b')?.enabled).toBe(false)
    // Untouched, since it wasn't selected.
    expect(getCompanyBoardByKey('greenhouse:c')?.enabled).toBe(true)
  })

  it('removes a selection in one write and reports how many rows went', () => {
    const [first, second] = three()

    expect(removeCompanyBoards([first!, second!, 'gone'])).toBe(2)
    expect(countCompanyBoards()).toBe(1)
    expect(getCompanyBoardByKey('greenhouse:c')).not.toBeNull()
  })

  it('treats an empty selection as a no-op rather than touching every row', () => {
    three()

    expect(setCompanyBoardsEnabled([], false)).toBe(0)
    expect(removeCompanyBoards([])).toBe(0)
    expect(countCompanyBoards()).toBe(3)
    expect(getCompanyBoardByKey('greenhouse:a')?.enabled).toBe(true)
  })
})

describe('importCompanyBoards', () => {
  function record(overrides: Partial<AddCompanyBoardInput> = {}): AddCompanyBoardInput & {
    createdAt: string
    enabled: boolean
  } {
    return { ...input(overrides), createdAt: '2020-01-01T00:00:00.000Z', enabled: true }
  }

  it('separates the two reasons a row is skipped', () => {
    addCompanyBoard(input({ token: 'acme', boardKey: 'greenhouse:acme' }))

    const result = importCompanyBoards([
      record({ token: 'acme', boardKey: 'greenhouse:acme' }),
      record({ token: 'globex', boardKey: 'greenhouse:globex' })
    ])

    expect(result).toEqual({ imported: 1, skipped: 1, alreadyTracked: 1, overLimit: 0 })
  })

  it('carries a feed\'s claimed size in, so the first sweep can order the import', () => {
    importCompanyBoards([record({ token: 'globex', boardKey: 'greenhouse:globex', seedJobCount: 480 })])

    expect(getCompanyBoardByKey('greenhouse:globex')?.seedJobCount).toBe(480)
  })

  it('counts rows that no longer fit under the ceiling as over the limit', () => {
    for (let i = 0; i < MAX_COMPANY_BOARDS; i++) {
      addCompanyBoard(input({ token: `existing-${i}`, boardKey: `greenhouse:existing-${i}` }))
    }

    const result = importCompanyBoards([record({ token: 'late', boardKey: 'greenhouse:late' })])

    expect(result).toEqual({ imported: 0, skipped: 1, alreadyTracked: 0, overLimit: 1 })
    expect(countCompanyBoards()).toBe(MAX_COMPANY_BOARDS)
  })
})
