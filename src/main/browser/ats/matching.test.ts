import { describe, it, expect } from 'vitest'
import {
  crossSourceKey,
  interleaveByBoard,
  matchesLocation,
  matchesQuery,
  normalizeText,
  queryTerms,
  rankPostings,
  scorePosting
} from './matching'
import type { AtsPosting } from './types'

function posting(overrides: Partial<AtsPosting> = {}): AtsPosting {
  return {
    id: overrides.id ?? '1',
    title: 'Backend Engineer',
    company: 'Acme',
    url: overrides.url ?? 'https://jobs.lever.co/acme/1',
    snippet: '',
    ...overrides
  }
}

describe('normalizeText', () => {
  it('lowercases, strips accents, and reduces punctuation to spaces', () => {
    expect(normalizeText('Señior Enginéer (Back-End)')).toBe('senior engineer back end')
  })

  it('collapses to an empty string for punctuation-only input', () => {
    expect(normalizeText('!!! ???')).toBe('')
  })

  it('keeps letters from every script, not just ASCII', () => {
    // An ASCII-only class erased these entirely, which `matchesQuery` reads
    // as "no filter" — a search for a Japanese title returned the company's
    // whole board.
    expect(normalizeText('ソフトウェア エンジニア')).toBe('ソフトウェア エンジニア')
    expect(normalizeText('Разработчик (Backend)')).toBe('разработчик backend')
    expect(normalizeText('München')).toBe('munchen')
  })
})

describe('queryTerms', () => {
  it('splits and dedupes terms', () => {
    expect(queryTerms('Senior senior Engineer')).toEqual(['senior', 'engineer'])
  })

  it('returns nothing for a query with no letters or digits', () => {
    expect(queryTerms('***')).toEqual([])
  })
})

describe('matchesQuery', () => {
  it('requires every term, not just one', () => {
    const job = posting({ title: 'Backend Engineer' })
    expect(matchesQuery(job, ['backend', 'engineer'])).toBe(true)
    expect(matchesQuery(job, ['frontend', 'engineer'])).toBe(false)
  })

  it('matches on department, team, location and employment type, not only the title', () => {
    const job = posting({ title: 'Analyst', department: 'Data Platform', location: 'Berlin' })
    expect(matchesQuery(job, ['data'])).toBe(true)
    expect(matchesQuery(job, ['berlin'])).toBe(true)
  })

  it('matches a longer term as a prefix so "engineer" finds "engineering"', () => {
    expect(matchesQuery(posting({ title: 'Engineering Manager' }), ['engineer'])).toBe(true)
  })

  it('does not match a term inside another word', () => {
    // The classic false positive: "art" must not match "start".
    expect(matchesQuery(posting({ title: 'Start-up Generalist' }), ['art'])).toBe(false)
  })

  it('treats a short term as a whole word so "ai" does not match "aid"', () => {
    expect(matchesQuery(posting({ title: 'Aid Worker' }), ['ai'])).toBe(false)
    expect(matchesQuery(posting({ title: 'AI Researcher' }), ['ai'])).toBe(true)
  })

  it('matches everything when the query normalises to no terms', () => {
    expect(matchesQuery(posting(), [])).toBe(true)
  })
})

describe('matchesLocation', () => {
  it('passes everything through when no location filter is given', () => {
    expect(matchesLocation(posting({ location: undefined }), undefined)).toBe(true)
    expect(matchesLocation(posting({ location: undefined }), '  ')).toBe(true)
  })

  it('requires every term of the requested location', () => {
    const job = posting({ location: 'New York, NY (HQ)' })
    expect(matchesLocation(job, 'New York')).toBe(true)
    expect(matchesLocation(job, 'New Jersey')).toBe(false)
  })

  it('accepts a remote-flagged posting for a "remote" request even when it names an office', () => {
    expect(matchesLocation(posting({ location: 'San Francisco, CA', isRemote: true }), 'Remote')).toBe(true)
  })

  it('rejects a posting with no location text at all, rather than widening the filter', () => {
    expect(matchesLocation(posting({ location: undefined }), 'Berlin')).toBe(false)
  })

  it('still requires a place named alongside "remote"', () => {
    // The remote flag answers the word "remote" and nothing else — otherwise
    // "Remote Australia" returns remote roles on every other continent.
    const auRemote = posting({ location: 'Remote - Australia', isRemote: true })
    const usRemote = posting({ location: 'Remote - United States', isRemote: true })
    expect(matchesLocation(auRemote, 'Remote Australia')).toBe(true)
    expect(matchesLocation(usRemote, 'Remote Australia')).toBe(false)
  })

  it('rejects a remote posting that names no place when the filter does', () => {
    expect(matchesLocation(posting({ location: undefined, isRemote: true }), 'Remote Australia')).toBe(false)
  })

  it('matches a location written in a non-Latin script', () => {
    expect(matchesLocation(posting({ location: '東京' }), '東京')).toBe(true)
    expect(matchesLocation(posting({ location: '大阪' }), '東京')).toBe(false)
  })
})

describe('scorePosting', () => {
  const now = Date.parse('2026-08-30T00:00:00.000Z')

  it('weighs a title hit far above the same term elsewhere', () => {
    const inTitle = scorePosting(posting({ title: 'Data Engineer' }), ['data'], now)
    const inDepartment = scorePosting(posting({ title: 'Analyst', department: 'Data' }), ['data'], now)
    expect(inTitle).toBeGreaterThan(inDepartment)
  })

  it('prefers a fresher posting, but never enough to outweigh a title hit', () => {
    const fresh = posting({ title: 'Analyst', department: 'Data', postedAt: '2026-08-29T00:00:00.000Z' })
    const staleTitleHit = posting({ title: 'Data Engineer', postedAt: '2020-01-01T00:00:00.000Z' })
    expect(scorePosting(fresh, ['data'], now)).toBeGreaterThan(
      scorePosting(posting({ title: 'Analyst', department: 'Data' }), ['data'], now)
    )
    expect(scorePosting(staleTitleHit, ['data'], now)).toBeGreaterThan(scorePosting(fresh, ['data'], now))
  })

  it('ignores an unparseable or future timestamp instead of scoring it wildly', () => {
    expect(scorePosting(posting({ postedAt: 'not-a-date' }), [], now)).toBe(0)
    expect(scorePosting(posting({ postedAt: '2030-01-01T00:00:00.000Z' }), [], now)).toBe(0)
  })
})

describe('rankPostings', () => {
  it('drops non-matching postings and orders the rest best-first', () => {
    const ranked = rankPostings(
      [
        posting({ id: '1', title: 'Marketing Lead', url: 'https://x/1' }),
        posting({ id: '2', title: 'Analyst', department: 'Engineering', url: 'https://x/2' }),
        posting({ id: '3', title: 'Backend Engineer', url: 'https://x/3' })
      ],
      ['engineer'],
      undefined
    )
    expect(ranked.map((p) => p.id)).toEqual(['3', '2'])
  })

  it('is stable for identical postings, so two identical searches agree', () => {
    const a = posting({ id: 'a', title: 'Engineer', url: 'https://x/a' })
    const b = posting({ id: 'b', title: 'Engineer', url: 'https://x/b' })
    expect(rankPostings([b, a], ['engineer'], undefined).map((p) => p.id)).toEqual(['a', 'b'])
    expect(rankPostings([a, b], ['engineer'], undefined).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('applies the location filter as well as the query', () => {
    const ranked = rankPostings(
      [
        posting({ id: '1', title: 'Engineer', location: 'Berlin' }),
        posting({ id: '2', title: 'Engineer', location: 'Lisbon' })
      ],
      ['engineer'],
      'Berlin'
    )
    expect(ranked.map((p) => p.id)).toEqual(['1'])
  })
})

describe('crossSourceKey', () => {
  it('matches the same posting reached through two different sources', () => {
    expect(crossSourceKey('Acme Inc.', 'Backend Engineer', 'Berlin')).toBe(
      crossSourceKey('acme inc', 'backend  engineer', 'BERLIN')
    )
  })

  it('ignores a legal suffix, which one source writes and the other does not', () => {
    expect(crossSourceKey('Acme Inc.', 'Engineer', 'Berlin')).toBe(crossSourceKey('Acme', 'Engineer', 'Berlin'))
  })

  it('never strips a name that is only a legal form, which would match everything', () => {
    expect(crossSourceKey('Ltd', 'Engineer', 'Berlin')).not.toBe(crossSourceKey('', 'Engineer', 'Berlin'))
  })

  it('keeps one-posting-per-city rows distinct', () => {
    expect(crossSourceKey('Acme', 'Backend Engineer', 'Berlin')).not.toBe(
      crossSourceKey('Acme', 'Backend Engineer', 'Lisbon')
    )
  })

  it('treats a missing location as its own key rather than throwing', () => {
    expect(crossSourceKey('Acme', 'Engineer', undefined)).toBe('acme|engineer|')
  })
})

describe('interleaveByBoard', () => {
  it('takes one from each board in turn so a large board cannot fill the page', () => {
    const big = ['b1', 'b2', 'b3', 'b4']
    const small = ['s1']
    expect(interleaveByBoard([big, small], 4)).toEqual(['b1', 's1', 'b2', 'b3'])
  })

  it('drains the remaining boards once one runs out', () => {
    expect(interleaveByBoard([['a'], ['b1', 'b2', 'b3']], 10)).toEqual(['a', 'b1', 'b2', 'b3'])
  })

  it('respects the limit and copes with empty input', () => {
    expect(interleaveByBoard([['a', 'b'], ['c']], 2)).toEqual(['a', 'c'])
    expect(interleaveByBoard([], 5)).toEqual([])
    expect(interleaveByBoard([[], []], 5)).toEqual([])
  })
})
