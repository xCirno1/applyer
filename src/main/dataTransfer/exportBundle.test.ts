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
import { upsertIndexedJobs, listAllIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { excludeUrl } from '../db/repositories/jobExclusionsRepository'
import { addCompanyBoard, recordCompanyBoardFetch } from '../db/repositories/companyBoardsRepository'
import { saveProfile } from '../db/repositories/profileRepository'
import { setAutoStartCommand, setNotificationPreferences } from '../db/repositories/settingsRepository'
import { jobsToCsv, companyBoardsToCsv, indexedJobsToCsv } from './csv'
import { buildExportBundle, bundleJsonBytes, computeExportSizes, filenameTimestamp } from './exportBundle'
import { allDomainsSelected, totalJsonBytes } from '@shared/types/dataTransfer'
import type { ExportSelection } from '@shared/types/dataTransfer'

describe('buildExportBundle', () => {
  it('includes only the selected domains', () => {
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' })
    excludeUrl({ url: 'https://y.com/1', excludedBy: 'user' })

    const bundle = buildExportBundle({ ...allDomainsSelected(false), jobs: true })
    expect(bundle.data.jobs).toHaveLength(1)
    expect(bundle.data.exclusions).toBeUndefined()
    expect(bundle.data.profile).toBeUndefined()
    expect(bundle.data.settings).toBeUndefined()
  })

  it('includes tracked company boards when selected', () => {
    addCompanyBoard({
      boardKey: 'greenhouse:acme',
      provider: 'greenhouse',
      token: 'acme',
      host: null,
      site: null,
      companyName: 'Acme Labs',
      addedBy: 'user'
    })

    const bundle = buildExportBundle({ ...allDomainsSelected(false), companyBoards: true })
    expect(bundle.data.companyBoards).toEqual([
      {
        provider: 'greenhouse',
        token: 'acme',
        host: null,
        site: null,
        companyName: 'Acme Labs',
        addedBy: 'user',
        enabled: true,
        seedJobCount: null,
        createdAt: expect.any(String)
      }
    ])
  })

  it("carries a feed's claimed size, which is the one count that isn't this machine's reading", () => {
    addCompanyBoard({
      boardKey: 'greenhouse:globex',
      provider: 'greenhouse',
      token: 'globex',
      host: null,
      site: null,
      companyName: 'Globex',
      addedBy: 'user',
      seedJobCount: 480
    })

    const board = buildExportBundle({ ...allDomainsSelected(false), companyBoards: true }).data.companyBoards?.[0]
    // It orders the importing machine's first sweeps exactly as it orders
    // this one's, and unlike lastJobCount it was never a measurement here.
    expect(board?.seedJobCount).toBe(480)
  })

  it('includes the search history when selected, without the match columns it derives', () => {
    upsertIndexedJobs(
      [{ title: 'Engineer', company: 'Acme', url: 'https://x.com/1', source: 'greenhouse', snippet: 'Role' }],
      'engineer',
      'Remote'
    )
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' })

    const bundle = buildExportBundle({ ...allDomainsSelected(false), indexedJobs: true })

    expect(bundle.data.indexedJobs).toHaveLength(1)
    expect(bundle.data.jobs).toBeUndefined()
    // "matched" is a join against this install's board, recomputed on import.
    expect(bundle.data.indexedJobs?.[0]).not.toHaveProperty('matchedJobId')
    expect(bundle.data.indexedJobs?.[0]).toMatchObject({ url: 'https://x.com/1', searchQuery: 'engineer' })
  })

  it('leaves this machine\'s last fetch out of an exported board', () => {
    addCompanyBoard({
      boardKey: 'lever:acme',
      provider: 'lever',
      token: 'acme',
      host: null,
      site: null,
      companyName: 'Acme Labs',
      addedBy: 'agent'
    })
    recordCompanyBoardFetch('lever:acme', { jobCount: 12, error: null })

    const board = buildExportBundle({ ...allDomainsSelected(false), companyBoards: true }).data.companyBoards?.[0]
    // "12 open roles, checked just now" is this install's reading, not a fact
    // about the board that another install should display.
    expect(board).not.toHaveProperty('lastJobCount')
    expect(board).not.toHaveProperty('lastCheckedAt')
    expect(board).not.toHaveProperty('lastError')
    // The derived key is left out too — the importing side recomputes it.
    expect(board).not.toHaveProperty('boardKey')
  })

  it('stamps schemaVersion, an ISO exportedAt, and appVersion from the mocked app', () => {
    const bundle = buildExportBundle(allDomainsSelected(false))
    expect(bundle.schemaVersion).toBe(1)
    expect(bundle.appVersion).toBe('0.0.0-test')
    expect(() => new Date(bundle.exportedAt).toISOString()).not.toThrow()
  })

  it('includes settings when selected', () => {
    setAutoStartCommand('claude')
    setNotificationPreferences({ enabled: true, verificationRequired: false, jobFilled: true, jobFailed: false })
    const bundle = buildExportBundle({ ...allDomainsSelected(false), settings: true })
    expect(bundle.data.settings).toEqual({
      autoStartCommand: 'claude',
      indexedJobsRetentionDays: 30,
      notificationPreferences: { enabled: true, verificationRequired: false, jobFilled: true, jobFailed: false }
    })
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
    upsertIndexedJobs(
      [{ title: 'Engineer', company: 'Acme', url: 'https://x.com/1', source: 'indeed', snippet: 'Role' }],
      'engineer',
      'Remote'
    )
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

    const twoDomains: ExportSelection = { ...allDomainsSelected(false), jobs: true, exclusions: true }
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

  it('sizes indexed jobs from the same rows the export writes', () => {
    upsertIndexedJobs(
      [{ title: 'Engineer', company: 'Acme', url: 'https://x.com/1', source: 'lever', snippet: 'Role' }],
      'engineer',
      null
    )

    const sizes = computeExportSizes()
    expect(sizes.indexedJobs.csv).toBe(Buffer.byteLength(indexedJobsToCsv(listAllIndexedJobs()), 'utf-8'))
    expect(sizes.indexedJobs.json).toBeGreaterThan(0)
  })

  it('sizes company boards from the same rows the export writes', () => {
    addCompanyBoard({
      boardKey: 'ashby:acme',
      provider: 'ashby',
      token: 'acme',
      host: null,
      site: null,
      companyName: 'Acme Labs',
      addedBy: 'user'
    })

    const sizes = computeExportSizes()
    const boards = buildExportBundle({ ...allDomainsSelected(false), companyBoards: true }).data.companyBoards ?? []
    expect(sizes.companyBoards.csv).toBe(Buffer.byteLength(companyBoardsToCsv(boards), 'utf-8'))
    expect(sizes.companyBoards.json).toBeGreaterThan(0)
  })
})

describe('bundleJsonBytes', () => {
  it('is deterministic for the same data shape (exportedAt length never varies)', () => {
    expect(bundleJsonBytes({ jobs: [] })).toBe(bundleJsonBytes({ jobs: [] }))
  })
})
