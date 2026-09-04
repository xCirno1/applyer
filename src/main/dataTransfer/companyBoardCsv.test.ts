import { describe, it, expect } from 'vitest'
import {
  isMappingUsable,
  normaliseImportOptions,
  normaliseMapping,
  normaliseProvider,
  parseOpenPostings,
  planCsvImport,
  resolveCsvRow,
  suggestBoardCsvMapping
} from './companyBoardCsv'
import { MAX_COMPANY_BOARDS } from '@shared/constants'
import { emptyBoardCsvMapping, type BoardCsvMapping } from '@shared/types/companyBoard'

function mapping(overrides: Partial<BoardCsvMapping> = {}): BoardCsvMapping {
  return { ...emptyBoardCsvMapping(), ...overrides }
}

const NO_CAPACITY_LIMIT = { tracked: 0, limit: MAX_COMPANY_BOARDS, remaining: MAX_COMPANY_BOARDS }

const OPEN_ALL = { minOpenPostings: 0, maxImport: MAX_COMPANY_BOARDS }

describe('suggestBoardCsvMapping', () => {
  it('maps the published feed layout', () => {
    expect(suggestBoardCsvMapping(['provider', 'token', 'open_postings', 'board_url', 'api_url'])).toEqual({
      company: null,
      provider: 0,
      token: 1,
      openPostings: 2,
      boardUrl: 3,
      apiUrl: 4
    })
  })

  it('ignores case, spaces and punctuation in header names', () => {
    expect(suggestBoardCsvMapping(['Company Name', 'ATS', 'Board ID', 'Open Roles'])).toEqual({
      company: 0,
      provider: 1,
      token: 2,
      openPostings: 3,
      boardUrl: null,
      apiUrl: null
    })
  })

  it('leaves fields unmapped when nothing matches', () => {
    expect(suggestBoardCsvMapping(['foo', 'bar'])).toEqual(emptyBoardCsvMapping())
  })

  it('never assigns one column to two fields', () => {
    // 'board' is an alias of boardUrl, but 'token' claims its own column first.
    const suggested = suggestBoardCsvMapping(['board', 'token'])
    expect(suggested.token).toBe(1)
    expect(suggested.boardUrl).toBe(0)
  })
})

describe('normaliseMapping', () => {
  it('drops indexes that are not columns of this file', () => {
    expect(normaliseMapping({ provider: 0, token: 9, openPostings: -1, company: 1.5 }, 3)).toEqual(
      mapping({ provider: 0 })
    )
  })

  it('ignores unknown fields and non-object payloads', () => {
    expect(normaliseMapping({ nonsense: 0 }, 3)).toEqual(emptyBoardCsvMapping())
    expect(normaliseMapping(null, 3)).toEqual(emptyBoardCsvMapping())
    expect(normaliseMapping('nope', 3)).toEqual(emptyBoardCsvMapping())
  })
})

describe('isMappingUsable', () => {
  it('accepts a provider/token pair or either URL column', () => {
    expect(isMappingUsable(mapping({ provider: 0, token: 1 }))).toBe(true)
    expect(isMappingUsable(mapping({ boardUrl: 0 }))).toBe(true)
    expect(isMappingUsable(mapping({ apiUrl: 0 }))).toBe(true)
  })

  it('rejects a mapping that cannot address a board', () => {
    expect(isMappingUsable(mapping({ company: 0, openPostings: 1 }))).toBe(false)
    expect(isMappingUsable(mapping({ provider: 0 }))).toBe(false)
    expect(isMappingUsable(mapping({ token: 0 }))).toBe(false)
  })
})

describe('normaliseProvider', () => {
  it('accepts our own identifiers', () => {
    expect(normaliseProvider('greenhouse')).toBe('greenhouse')
    expect(normaliseProvider('  Lever ')).toBe('lever')
  })

  it('accepts the product and host names feeds actually use', () => {
    expect(normaliseProvider('Greenhouse.io')).toBe('greenhouse')
    expect(normaliseProvider('AshbyHQ')).toBe('ashby')
    expect(normaliseProvider('jobs.lever.co')).toBe('lever')
    expect(normaliseProvider('Workday')).toBe('workday')
  })

  it('returns null for anything else', () => {
    expect(normaliseProvider('')).toBeNull()
    expect(normaliseProvider('smartrecruiters')).toBeNull()
  })
})

describe('parseOpenPostings', () => {
  it('reads grouped and padded numbers', () => {
    expect(parseOpenPostings('1,234')).toBe(1234)
    expect(parseOpenPostings(' 12 ')).toBe(12)
    expect(parseOpenPostings('7.0')).toBe(7)
    expect(parseOpenPostings('0')).toBe(0)
  })

  it('returns null for anything that is not a count', () => {
    expect(parseOpenPostings('')).toBeNull()
    expect(parseOpenPostings('n/a')).toBeNull()
    expect(parseOpenPostings('-3')).toBeNull()
  })
})

describe('resolveCsvRow', () => {
  const pair = mapping({ provider: 0, token: 1, openPostings: 2, company: 3 })

  it('builds a board from a provider/token pair', () => {
    expect(resolveCsvRow(['greenhouse', 'acme', '12', 'Acme Labs'], pair)).toEqual({
      descriptor: { provider: 'greenhouse', token: 'acme', host: null, site: null },
      boardKey: 'greenhouse:acme',
      companyName: 'Acme Labs',
      openPostings: 12
    })
  })

  it('falls back to the token when the file names no company', () => {
    expect(resolveCsvRow(['lever', 'globex', '', ''], pair)?.companyName).toBe('globex')
  })

  it('leaves the count null when the file carries none', () => {
    expect(resolveCsvRow(['lever', 'globex', '', ''], pair)?.openPostings).toBeNull()
  })

  it('falls back to the board URL when the pair is unusable', () => {
    const withUrl = mapping({ provider: 0, token: 1, boardUrl: 2 })
    const resolved = resolveCsvRow(['', '', 'https://jobs.ashbyhq.com/globex'], withUrl)
    expect(resolved?.descriptor).toEqual({ provider: 'ashby', token: 'globex', host: null, site: null })
  })

  it('falls back to the API URL when there is no board URL', () => {
    const withApi = mapping({ boardUrl: 0, apiUrl: 1 })
    const resolved = resolveCsvRow(['', 'https://api.lever.co/v0/postings/globex?mode=json'], withApi)
    expect(resolved?.descriptor.provider).toBe('lever')
    expect(resolved?.descriptor.token).toBe('globex')
  })

  it('only takes Workday from a URL, since a tenant alone cannot address a board', () => {
    const withUrl = mapping({ provider: 0, token: 1, boardUrl: 2 })
    expect(resolveCsvRow(['workday', 'acme', ''], withUrl)).toBeNull()
    expect(
      resolveCsvRow(['workday', 'acme', 'https://acme.wd5.myworkdayjobs.com/en-US/AcmeCareers/job/x'], withUrl)
        ?.descriptor
    ).toEqual({ provider: 'workday', token: 'acme', host: 'acme.wd5.myworkdayjobs.com', site: 'AcmeCareers' })
  })

  it('rejects a row whose token column holds something that is not a slug', () => {
    expect(resolveCsvRow(['greenhouse', 'Acme Labs, Inc.', '', ''], pair)).toBeNull()
    expect(resolveCsvRow(['greenhouse', 'acme/jobs', '', ''], pair)).toBeNull()
  })

  it('rejects a row with no provider and an unrecognised URL', () => {
    const withUrl = mapping({ provider: 0, token: 1, boardUrl: 2 })
    expect(resolveCsvRow(['', 'acme', 'https://acme.com/careers'], withUrl)).toBeNull()
    expect(resolveCsvRow(['', 'acme', 'not a url'], withUrl)).toBeNull()
  })

  it('keys the same board identically however it was addressed', () => {
    const viaPair = resolveCsvRow(['Greenhouse', 'Acme', '', ''], pair)
    const viaUrl = resolveCsvRow(['', '', 'https://boards.greenhouse.io/acme'], mapping({ boardUrl: 2 }))
    expect(viaPair?.boardKey).toBe('greenhouse:acme')
    expect(viaUrl?.boardKey).toBe('greenhouse:acme')
  })
})

describe('planCsvImport', () => {
  const map = mapping({ provider: 0, token: 1, openPostings: 2 })

  const rows = [
    ['greenhouse', 'small', '3'],
    ['greenhouse', 'big', '40'],
    ['lever', 'dead', '0'],
    ['nonsense', '', ''],
    ['greenhouse', 'big', '40']
  ]

  it('accounts for every row of the file', () => {
    const { plan } = planCsvImport({
      rows,
      mapping: map,
      options: OPEN_ALL,
      isTracked: () => false,
      capacity: NO_CAPACITY_LIMIT
    })
    expect(plan.totalRows).toBe(5)
    expect(plan.unusable).toBe(1)
    expect(plan.duplicates).toBe(1)
    expect(plan.willImport).toBe(3)
    expect(
      plan.willImport + plan.unusable + plan.duplicates + plan.belowThreshold + plan.alreadyTracked + plan.overLimit
    ).toBe(plan.totalRows)
  })

  it('takes the boards with the most open roles first', () => {
    const { boards } = planCsvImport({
      rows,
      mapping: map,
      options: OPEN_ALL,
      isTracked: () => false,
      capacity: NO_CAPACITY_LIMIT
    })
    expect(boards.map((b) => b.descriptor.token)).toEqual(['big', 'small', 'dead'])
  })

  it('spends a small capacity on the largest boards and counts the rest as over the limit', () => {
    const { plan, boards } = planCsvImport({
      rows,
      mapping: map,
      options: { minOpenPostings: 0, maxImport: MAX_COMPANY_BOARDS },
      isTracked: () => false,
      capacity: { tracked: MAX_COMPANY_BOARDS - 1, limit: MAX_COMPANY_BOARDS, remaining: 1 }
    })
    expect(boards.map((b) => b.descriptor.token)).toEqual(['big'])
    expect(plan.overLimit).toBe(2)
  })

  it('honours a per-import ceiling below the remaining capacity', () => {
    const { plan } = planCsvImport({
      rows,
      mapping: map,
      options: { minOpenPostings: 0, maxImport: 2 },
      isTracked: () => false,
      capacity: NO_CAPACITY_LIMIT
    })
    expect(plan.willImport).toBe(2)
    expect(plan.overLimit).toBe(1)
  })

  it('drops boards below the open-roles floor', () => {
    const { plan, boards } = planCsvImport({
      rows,
      mapping: map,
      options: { minOpenPostings: 1, maxImport: MAX_COMPANY_BOARDS },
      isTracked: () => false,
      capacity: NO_CAPACITY_LIMIT
    })
    expect(boards.map((b) => b.descriptor.token)).toEqual(['big', 'small'])
    // The empty board and the duplicate of a row that never got that far.
    expect(plan.belowThreshold).toBe(1)
    expect(plan.duplicates).toBe(1)
  })

  it('ignores the floor when the file carries no count column', () => {
    const { plan } = planCsvImport({
      rows,
      mapping: mapping({ provider: 0, token: 1 }),
      options: { minOpenPostings: 5, maxImport: MAX_COMPANY_BOARDS },
      isTracked: () => false,
      capacity: NO_CAPACITY_LIMIT
    })
    expect(plan.belowThreshold).toBe(0)
    expect(plan.willImport).toBe(3)
  })

  it('counts boards already on the watchlist separately from duplicates in the file', () => {
    const { plan } = planCsvImport({
      rows,
      mapping: map,
      options: OPEN_ALL,
      isTracked: (key) => key === 'greenhouse:big',
      capacity: NO_CAPACITY_LIMIT
    })
    expect(plan.alreadyTracked).toBe(1)
    expect(plan.duplicates).toBe(1)
    expect(plan.willImport).toBe(2)
  })

  it('previews the first boards it would add, in the order it would add them', () => {
    const { plan } = planCsvImport({
      rows,
      mapping: map,
      options: OPEN_ALL,
      isTracked: () => false,
      capacity: NO_CAPACITY_LIMIT
    })
    expect(plan.sample[0]).toEqual({
      companyName: 'big',
      provider: 'greenhouse',
      token: 'big',
      site: null,
      openPostings: 40
    })
  })

  it('sorts rows with no count after the ones that have one, keeping file order among themselves', () => {
    const { boards } = planCsvImport({
      rows: [
        ['greenhouse', 'unknown-a', ''],
        ['greenhouse', 'counted', '1'],
        ['greenhouse', 'unknown-b', '']
      ],
      mapping: map,
      options: OPEN_ALL,
      isTracked: () => false,
      capacity: NO_CAPACITY_LIMIT
    })
    expect(boards.map((b) => b.descriptor.token)).toEqual(['counted', 'unknown-a', 'unknown-b'])
  })

  it('plans nothing over an empty file', () => {
    const { plan, boards } = planCsvImport({
      rows: [],
      mapping: map,
      options: OPEN_ALL,
      isTracked: () => false,
      capacity: NO_CAPACITY_LIMIT
    })
    expect(plan.totalRows).toBe(0)
    expect(plan.willImport).toBe(0)
    expect(boards).toEqual([])
  })

  it('imports nothing when the watchlist is already full', () => {
    const { plan } = planCsvImport({
      rows,
      mapping: map,
      options: OPEN_ALL,
      isTracked: () => false,
      capacity: { tracked: MAX_COMPANY_BOARDS, limit: MAX_COMPANY_BOARDS, remaining: 0 }
    })
    expect(plan.willImport).toBe(0)
    expect(plan.overLimit).toBe(3)
  })
})

describe('normaliseImportOptions', () => {
  it('clamps a typed ceiling to the watchlist limit', () => {
    expect(normaliseImportOptions({ minOpenPostings: 2, maxImport: 10000 }, 50).maxImport).toBe(MAX_COMPANY_BOARDS)
  })

  it('defaults the ceiling to the remaining capacity', () => {
    expect(normaliseImportOptions({}, 50)).toEqual({ minOpenPostings: 0, maxImport: 50 })
  })

  it('treats a negative or unparseable floor as no floor', () => {
    expect(normaliseImportOptions({ minOpenPostings: -5, maxImport: 10 }, 50).minOpenPostings).toBe(0)
    expect(normaliseImportOptions({ minOpenPostings: 'lots', maxImport: 10 }, 50).minOpenPostings).toBe(0)
  })

  it('survives a payload that is not an object', () => {
    expect(normaliseImportOptions(null, 20)).toEqual({ minOpenPostings: 0, maxImport: 20 })
  })
})
