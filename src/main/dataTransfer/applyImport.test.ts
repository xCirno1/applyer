import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { applyImport } from './applyImport'
import { listAllJobs } from '../db/repositories/jobsRepository'
import { listAllExclusions, isUrlExcluded } from '../db/repositories/jobExclusionsRepository'
import { getProfile } from '../db/repositories/profileRepository'
import { getAutoStartCommand, getIndexedJobsRetentionDays } from '../db/repositories/settingsRepository'
import { EXPORT_SCHEMA_VERSION } from '@shared/types/dataTransfer'
import type { ExportBundle, ExportSelection } from '@shared/types/dataTransfer'
import type { JobRecord } from '@shared/types/job'
import type { ExclusionRecord } from '@shared/types/exclusion'
import type { ProfileFields } from '@shared/types/profile'

function bundle(data: ExportBundle['data']): ExportBundle {
  return { schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: '2020-01-01T00:00:00.000Z', appVersion: '1.0.0', data }
}

const NO_SELECTION: ExportSelection = { jobs: false, exclusions: false, profile: false, settings: false }

const jobFixture: JobRecord = {
  id: 'external-id',
  externalId: null,
  source: null,
  title: 'Backend Engineer',
  company: 'Acme',
  location: null,
  url: 'https://example.com/imported',
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
  updatedAt: '2020-01-01T00:00:00.000Z'
}

const exclusionFixture: ExclusionRecord = {
  id: 'external-id-2',
  url: 'https://example.com/excluded',
  title: 'Bad Job',
  company: 'Acme',
  reason: 'spam',
  excludedBy: 'user',
  createdAt: '2020-01-01T00:00:00.000Z'
}

const profileFixture: ProfileFields = {
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
}

describe('applyImport', () => {
  it('imports jobs when selected and present, reporting counts', () => {
    const result = applyImport(bundle({ jobs: [jobFixture] }), { ...NO_SELECTION, jobs: true })
    expect(result.jobs).toEqual({ imported: 1, skipped: 0 })
    expect(listAllJobs()).toHaveLength(1)
  })

  it('does not import jobs when not selected, even though the bundle has them', () => {
    const result = applyImport(bundle({ jobs: [jobFixture] }), NO_SELECTION)
    expect(result.jobs).toBeUndefined()
    expect(listAllJobs()).toHaveLength(0)
  })

  it('is a no-op for a domain that is selected but absent from the bundle (a partial export file)', () => {
    const result = applyImport(bundle({ jobs: [jobFixture] }), { ...NO_SELECTION, jobs: true, exclusions: true })
    expect(result.exclusions).toBeUndefined()
    expect(listAllExclusions()).toHaveLength(0)
  })

  it('imports exclusions when selected and present', () => {
    const result = applyImport(bundle({ exclusions: [exclusionFixture] }), { ...NO_SELECTION, exclusions: true })
    expect(result.exclusions).toEqual({ imported: 1, skipped: 0 })
    expect(isUrlExcluded(exclusionFixture.url)).toBe(true)
  })

  it('overwrites the profile when selected', () => {
    const result = applyImport(bundle({ profile: profileFixture }), { ...NO_SELECTION, profile: true })
    expect(result.profile).toBe(true)
    expect(getProfile()?.fullName).toBe('Jane Doe')
  })

  it('overwrites settings when selected', () => {
    const result = applyImport(bundle({ settings: { autoStartCommand: 'claude', indexedJobsRetentionDays: 14 } }), {
      ...NO_SELECTION,
      settings: true
    })
    expect(result.settings).toBe(true)
    expect(getAutoStartCommand()).toBe('claude')
    expect(getIndexedJobsRetentionDays()).toBe(14)
  })

  it('returns an empty summary and touches nothing when no domain is selected', () => {
    const result = applyImport(bundle({ jobs: [jobFixture], exclusions: [exclusionFixture] }), NO_SELECTION)
    expect(result).toEqual({})
    expect(listAllJobs()).toHaveLength(0)
    expect(listAllExclusions()).toHaveLength(0)
  })
})
