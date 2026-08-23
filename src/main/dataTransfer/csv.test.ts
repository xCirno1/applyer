import { describe, it, expect } from 'vitest'
import { jobsToCsv, exclusionsToCsv } from './csv'
import type { JobRecord } from '@shared/types/job'
import type { ExclusionRecord } from '@shared/types/exclusion'

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
