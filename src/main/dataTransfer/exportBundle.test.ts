import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { queueJob, listAllJobs } from '../db/repositories/jobsRepository'
import { excludeUrl } from '../db/repositories/jobExclusionsRepository'
import { saveProfile } from '../db/repositories/profileRepository'
import { setAutoStartCommand } from '../db/repositories/settingsRepository'
import { jobsToCsv } from './csv'
import { buildExportBundle, bundleJsonBytes, computeExportSizes, filenameTimestamp } from './exportBundle'
import { allDomainsSelected, totalJsonBytes } from '@shared/types/dataTransfer'
import type { ExportSelection } from '@shared/types/dataTransfer'

describe('buildExportBundle', () => {
  it('includes only the selected domains', () => {
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' })
    excludeUrl({ url: 'https://y.com/1', excludedBy: 'user' })

    const bundle = buildExportBundle({ jobs: true, exclusions: false, profile: false, settings: false })
    expect(bundle.data.jobs).toHaveLength(1)
    expect(bundle.data.exclusions).toBeUndefined()
    expect(bundle.data.profile).toBeUndefined()
    expect(bundle.data.settings).toBeUndefined()
  })

  it('stamps schemaVersion, an ISO exportedAt, and appVersion from the mocked app', () => {
    const bundle = buildExportBundle({ jobs: false, exclusions: false, profile: false, settings: false })
    expect(bundle.schemaVersion).toBe(1)
    expect(bundle.appVersion).toBe('0.0.0-test')
    expect(() => new Date(bundle.exportedAt).toISOString()).not.toThrow()
  })

  it('includes settings when selected', () => {
    setAutoStartCommand('claude')
    const bundle = buildExportBundle({ jobs: false, exclusions: false, profile: false, settings: true })
    expect(bundle.data.settings).toEqual({ autoStartCommand: 'claude', indexedJobsRetentionDays: 30 })
  })
})

describe('filenameTimestamp', () => {
  it('is filesystem-safe (no colons) and matches the expected shape', () => {
    expect(filenameTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/)
  })
})

describe('computeExportSizes', () => {
  it('totalJsonBytes(sizes, selection) matches exactly the bytes of the real exported bundle', () => {
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' })
    queueJob({ title: 'Designer', company: 'Beta', url: 'https://x.com/2' })
    excludeUrl({ url: 'https://y.com/1', title: 'Bad', company: 'C', reason: 'spam', excludedBy: 'user' })
    saveProfile({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '',
      location: '',
      linkedinUrl: '',
      githubUrl: '',
      portfolioUrl: '',
      workAuthorization: '',
      desiredRoles: [],
      desiredLocations: [],
      remotePreference: 'no_preference',
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: '',
      yearsExperience: null,
      summary: '',
      skills: []
    })
    setAutoStartCommand('claude')

    const selection = allDomainsSelected()
    const sizes = computeExportSizes()
    const fullBundle = buildExportBundle(selection)
    const actualBytes = Buffer.byteLength(JSON.stringify(fullBundle), 'utf-8')

    // This is the exact bug a user hit: the preview must match the real
    // exported file byte-for-byte, not just be in the right ballpark. Naively
    // summing the four per-domain sizes undercounts by (domain count - 1)
    // bytes — the `,` JSON.stringify inserts between each key in `data` —
    // which is exactly what totalJsonBytes accounts for.
    expect(totalJsonBytes(sizes, selection)).toBe(actualBytes)
  })

  it('accounts for the separator commas between selected domains, not just their individual sizes', () => {
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' })
    excludeUrl({ url: 'https://y.com/1', excludedBy: 'user' })
    const sizes = computeExportSizes()

    const twoDomains: ExportSelection = { jobs: true, exclusions: true, profile: false, settings: false }
    const naiveSum = sizes.wrapperBytes + sizes.jobs.json + sizes.exclusions.json
    expect(totalJsonBytes(sizes, twoDomains)).toBe(naiveSum + 1) // one comma between the two keys
  })

  it('reports a small positive marginal size for an empty jobs list (just the "jobs":[] overhead)', () => {
    const sizes = computeExportSizes()
    expect(sizes.jobs.json).toBeGreaterThan(0)
    expect(sizes.jobs.json).toBeLessThan(20)
  })

  it('grows as jobs are added', () => {
    const before = computeExportSizes().jobs.json
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' })
    const after = computeExportSizes().jobs.json
    expect(after).toBeGreaterThan(before)
  })

  it('csv sizes match the standalone csv builder output exactly', () => {
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' })
    const sizes = computeExportSizes()
    expect(sizes.jobs.csv).toBe(Buffer.byteLength(jobsToCsv(listAllJobs()), 'utf-8'))
  })
})

describe('bundleJsonBytes', () => {
  it('is deterministic for the same data shape (exportedAt length never varies)', () => {
    expect(bundleJsonBytes({ jobs: [] })).toBe(bundleJsonBytes({ jobs: [] }))
  })
})
