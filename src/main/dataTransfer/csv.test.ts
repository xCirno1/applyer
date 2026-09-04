import { describe, it, expect } from 'vitest'
import { jobsToCsv, indexedJobsToCsv, exclusionsToCsv, companyBoardsToCsv } from './csv'
import type { JobRecord } from '@shared/types/job'
import type { ExclusionRecord } from '@shared/types/exclusion'
import type { ExportCompanyBoard, ExportIndexedJob } from '@shared/types/dataTransfer'

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: '1',
    externalId: null,
    source: 'linkedin',
    title: 'Backend Engineer',
    company: 'Acme',
    location: null,
    url: 'https://example.com/1',
    description: null,
    salaryRange: null,
    status: 'queued',
    matchScore: null,
    matchReasons: null,
    applicationUrl: null,
    applyMethod: null,
    screenshotPath: null,
    failureTag: null,
    failureMessage: null,
    blockingReason: null,
    blockingTaskId: null,
    queuedAt: '2020-01-01T00:00:00.000Z',
    filledAt: null,
    submittedAt: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('jobsToCsv', () => {
  it('emits a header row plus one row per job', () => {
    const csv = jobsToCsv([job(), job({ id: '2', title: 'Frontend Engineer' })])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Title')
    expect(lines[1]).toContain('Backend Engineer')
    expect(lines[2]).toContain('Frontend Engineer')
  })

  it('quotes and escapes fields containing commas, quotes, or newlines', () => {
    const csv = jobsToCsv([job({ title: 'Engineer, "Senior"\nRemote' })])
    const lines = csv.split('\r\n')
    expect(lines[1]).toContain('"Engineer, ""Senior""\nRemote"')
  })

  it('renders null fields as empty', () => {
    const csv = jobsToCsv([job()])
    const cells = csv.split('\r\n')[1]!.split(',')
    expect(cells[2]).toBe('') // Location
  })
})

describe('exclusionsToCsv', () => {
  it('emits a header row plus one row per exclusion', () => {
    const exclusion: ExclusionRecord = {
      id: '1',
      url: 'https://example.com/1',
      title: 'Bad Job',
      company: 'Acme',
      reason: 'not remote',
      excludedBy: 'user',
      createdAt: '2020-01-01T00:00:00.000Z'
    }
    const csv = exclusionsToCsv([exclusion])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('URL,Title,Company,Reason,Excluded By,Created At')
    expect(lines[1]).toContain('https://example.com/1')
  })
})

describe('indexedJobsToCsv', () => {
  function indexedRow(overrides: Partial<ExportIndexedJob> = {}): ExportIndexedJob {
    return {
      url: 'https://example.com/jobs/1',
      title: 'Backend Engineer',
      company: 'Acme',
      location: 'Remote',
      source: 'greenhouse',
      snippet: 'Role',
      salaryRange: null,
      postedAt: null,
      searchQuery: 'backend engineer',
      searchLocation: 'Remote',
      firstSeenAt: '2020-01-01T00:00:00.000Z',
      lastSeenAt: '2020-01-02T00:00:00.000Z',
      seenCount: 3,
      ...overrides
    }
  }

  it('writes a header even with no rows', () => {
    expect(indexedJobsToCsv([])).toBe(
      'Title,Company,Location,URL,Source,Salary Range,Posted At,Search Query,Search Location,First Seen At,Last Seen At,Seen'
    )
  })

  it('writes the search that surfaced a row alongside the row itself', () => {
    const lines = indexedJobsToCsv([indexedRow()]).split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe(
      'Backend Engineer,Acme,Remote,https://example.com/jobs/1,greenhouse,,,backend engineer,Remote,2020-01-01T00:00:00.000Z,2020-01-02T00:00:00.000Z,3'
    )
  })

  it('quotes a query containing a comma', () => {
    const lines = indexedJobsToCsv([indexedRow({ searchQuery: 'backend, platform' })]).split('\r\n')
    expect(lines[1]).toContain('"backend, platform"')
  })
})

describe('companyBoardsToCsv', () => {
  function boardRow(overrides: Partial<ExportCompanyBoard> = {}): ExportCompanyBoard {
    return {
      provider: 'greenhouse',
      token: 'acme',
      host: null,
      site: null,
      companyName: 'Acme Labs',
      addedBy: 'user',
      enabled: true,
      createdAt: '2020-01-01T00:00:00.000Z',
      ...overrides
    }
  }

  it('writes a header even with no rows', () => {
    expect(companyBoardsToCsv([])).toBe('Company,Provider,Token,Host,Site,Enabled,Added By,Created At')
  })

  it('leaves host and site empty for a provider addressed by slug alone', () => {
    const lines = companyBoardsToCsv([boardRow()]).split('\r\n')
    expect(lines[1]).toBe('Acme Labs,greenhouse,acme,,,yes,user,2020-01-01T00:00:00.000Z')
  })

  it('carries a Workday board\'s host and site', () => {
    const lines = companyBoardsToCsv([
      boardRow({ provider: 'workday', host: 'acme.wd5.myworkdayjobs.com', site: 'Careers', enabled: false })
    ]).split('\r\n')
    expect(lines[1]).toContain('acme.wd5.myworkdayjobs.com,Careers,no')
  })

  it('quotes a company name containing a comma', () => {
    const lines = companyBoardsToCsv([boardRow({ companyName: 'Acme, Inc.' })]).split('\r\n')
    expect(lines[1]?.startsWith('"Acme, Inc."')).toBe(true)
  })
})
