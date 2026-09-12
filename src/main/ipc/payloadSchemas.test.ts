import { describe, it, expect } from 'vitest'
import {
  browserPreferencePayload,
  csvTablePayload,
  dialogLabelsPayload,
  documentIdPayload,
  excludeJobPayload,
  exclusionIdPayload,
  exportSelectionSchema,
  jobIdPayload,
  jobIdsPayload,
  listActivityQuerySchema,
  listIndexedJobsQuerySchema,
  listJobsQuerySchema,
  mcpTargetPayload,
  readListQuery,
  remoteBrowserEndpointPayload,
  remoteBrowserPayload,
  respondInstallPayload,
  taskIdPayload
} from './payloadSchemas'
import { allDomainsSelected } from '@shared/types/dataTransfer'

describe('id payloads', () => {
  it('accepts a well-formed id', () => {
    expect(jobIdPayload.safeParse({ jobId: 'job-1' }).success).toBe(true)
    expect(documentIdPayload.safeParse({ documentId: 'doc-1' }).success).toBe(true)
    expect(exclusionIdPayload.safeParse({ id: 'exc-1' }).success).toBe(true)
    expect(taskIdPayload.safeParse({ taskId: 'task-1' }).success).toBe(true)
  })

  // Each of these used to be destructured straight out of the payload, so a
  // missing or wrongly-typed one became a TypeError inside the handler and
  // reached the renderer as a bare rejected promise.
  it.each([
    ['a missing payload', undefined],
    ['a null payload', null],
    ['an empty object', {}],
    ['a non-string id', { jobId: 42 }],
    ['an empty-string id', { jobId: '' }],
    ['an array', ['job-1']]
  ])('rejects %s', (_label, payload) => {
    expect(jobIdPayload.safeParse(payload).success).toBe(false)
  })

  it('accepts an optional reason alongside the id, and rejects a non-string one', () => {
    expect(excludeJobPayload.safeParse({ jobId: 'job-1' }).success).toBe(true)
    expect(excludeJobPayload.safeParse({ jobId: 'job-1', reason: 'not remote' }).success).toBe(true)
    expect(excludeJobPayload.safeParse({ jobId: 'job-1', reason: 7 }).success).toBe(false)
  })

  it('accepts a list of ids, rejecting one with a bad member', () => {
    expect(jobIdsPayload.safeParse({ jobIds: [] }).success).toBe(true)
    expect(jobIdsPayload.safeParse({ jobIds: ['a', 'b'] }).success).toBe(true)
    expect(jobIdsPayload.safeParse({ jobIds: ['a', 42] }).success).toBe(false)
    expect(jobIdsPayload.safeParse({ jobIds: 'a' }).success).toBe(false)
  })
})

describe('enum payloads', () => {
  // This one is stored and then used as Playwright's launch `channel`, so an
  // unchecked value fails at browser launch rather than at the write.
  it('accepts the four browser preferences and nothing else', () => {
    for (const preference of ['auto', 'chrome', 'msedge', 'managed']) {
      expect(browserPreferencePayload.safeParse({ preference }).success).toBe(true)
    }
    expect(browserPreferencePayload.safeParse({ preference: 'firefox' }).success).toBe(false)
    expect(browserPreferencePayload.safeParse({ preference: null }).success).toBe(false)
    expect(browserPreferencePayload.safeParse({}).success).toBe(false)
  })

  it('requires a real boolean for the browser-download confirmation', () => {
    expect(respondInstallPayload.safeParse({ accept: true }).success).toBe(true)
    expect(respondInstallPayload.safeParse({ accept: 'yes' }).success).toBe(false)
    expect(respondInstallPayload.safeParse({}).success).toBe(false)
  })

  // The endpoint is persisted and later handed straight to Playwright, so the
  // same URL rule the settings form applies inline has to hold at the boundary.
  it('accepts a remote browser configuration with a CDP endpoint, trimmed', () => {
    expect(remoteBrowserPayload.safeParse({ enabled: true, endpoint: ' http://127.0.0.1:9222 ' })).toEqual({
      success: true,
      data: { enabled: true, endpoint: 'http://127.0.0.1:9222' }
    })
    expect(remoteBrowserEndpointPayload.safeParse({ endpoint: 'ws://localhost:9222/devtools/browser/abc' }).success).toBe(true)
  })

  it('rejects a remote browser configuration with a missing, empty or non-CDP endpoint', () => {
    expect(remoteBrowserPayload.safeParse({ enabled: true }).success).toBe(false)
    expect(remoteBrowserPayload.safeParse({ enabled: true, endpoint: '' }).success).toBe(false)
    expect(remoteBrowserPayload.safeParse({ enabled: true, endpoint: 'file:///etc/passwd' }).success).toBe(false)
    expect(remoteBrowserPayload.safeParse({ enabled: 'yes', endpoint: 'http://127.0.0.1:9222' }).success).toBe(false)
    expect(remoteBrowserEndpointPayload.safeParse({ endpoint: 9222 }).success).toBe(false)
    expect(remoteBrowserEndpointPayload.safeParse({}).success).toBe(false)
  })

  // `cli` indexes an adapter table; an unrecognised one used to be a lookup
  // returning undefined and a TypeError on the next line.
  it('accepts only known CLI/scope pairs', () => {
    expect(mcpTargetPayload.safeParse({ cli: 'claude', scope: 'user' }).success).toBe(true)
    expect(mcpTargetPayload.safeParse({ cli: 'codex', scope: 'workspace' }).success).toBe(true)
    expect(mcpTargetPayload.safeParse({ cli: 'cursor', scope: 'user' }).success).toBe(false)
    expect(mcpTargetPayload.safeParse({ cli: 'claude', scope: 'global' }).success).toBe(false)
  })

  it('accepts only the four exportable CSV tables', () => {
    expect(csvTablePayload.safeParse({ table: 'jobs' }).success).toBe(true)
    expect(csvTablePayload.safeParse({ table: 'profile' }).success).toBe(false)
    expect(csvTablePayload.safeParse({ table: '__proto__' }).success).toBe(false)
  })
})

describe('dialogLabelsPayload', () => {
  it('accepts the labels the renderer translates and passes down', () => {
    expect(dialogLabelsPayload.safeParse({ labels: { title: 'Save', filterName: 'JSON' } }).success).toBe(true)
  })

  it('rejects labels that are absent or not strings', () => {
    expect(dialogLabelsPayload.safeParse({}).success).toBe(false)
    expect(dialogLabelsPayload.safeParse({ labels: { title: 'Save' } }).success).toBe(false)
    expect(dialogLabelsPayload.safeParse({ labels: { title: 1, filterName: 2 } }).success).toBe(false)
  })
})

describe('exportSelectionSchema', () => {
  it('accepts a complete selection', () => {
    expect(exportSelectionSchema.safeParse(allDomainsSelected(true)).success).toBe(true)
    expect(exportSelectionSchema.safeParse(allDomainsSelected(false)).success).toBe(true)
  })

  // Which domains to write decides which of the user's tables get
  // overwritten on import, so a partial selection is not guessed at.
  it('rejects a partial or wrongly-typed selection', () => {
    expect(exportSelectionSchema.safeParse({ jobs: true }).success).toBe(false)
    expect(exportSelectionSchema.safeParse({ ...allDomainsSelected(), jobs: 'yes' }).success).toBe(false)
    expect(exportSelectionSchema.safeParse(undefined).success).toBe(false)
  })
})

describe('list queries', () => {
  it('accepts a well-formed query unchanged', () => {
    const query = { status: 'queued', limit: 20, offset: 40, search: 'react', sortBy: 'matchScore' }
    expect(listJobsQuerySchema.parse(query)).toMatchObject(query)
  })

  // A read never fails over its filters: dropping one bad field is better
  // than refusing to show the list.
  it('drops only the field that is wrong, keeping the rest', () => {
    const parsed = listJobsQuerySchema.parse({ limit: 'twenty', search: 'react', status: 'queued' })
    expect(parsed).toEqual({ limit: undefined, search: 'react', status: 'queued', offset: undefined, source: undefined, sortBy: undefined })
  })

  it.each([
    ['a negative limit', { limit: -5 }],
    ['a fractional limit', { limit: 2.5 }],
    ['a negative offset', { offset: -1 }],
    ['an unknown status', { status: 'archived' }],
    ['an unknown sort order', { sortBy: 'salary' }],
    ['a non-string search', { search: { toString: () => 'x' } }]
  ])('drops %s', (_label, query) => {
    const parsed = listJobsQuerySchema.parse(query) as Record<string, unknown>
    for (const value of Object.values(parsed)) expect(value).toBeUndefined()
  })

  it('applies the same rules to the other list queries', () => {
    expect(listIndexedJobsQuerySchema.parse({ matched: 'sideways', date: '2026-01-01' })).toMatchObject({
      matched: undefined,
      date: '2026-01-01'
    })
    expect(listActivityQuerySchema.parse({ level: 'verbose', jobId: 'job-1' })).toMatchObject({
      level: undefined,
      jobId: 'job-1'
    })
  })
})

describe('readListQuery', () => {
  it('passes a valid query through', () => {
    expect(readListQuery(listJobsQuerySchema, { status: 'failed' }, 'jobs:list')).toMatchObject({ status: 'failed' })
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'everything'],
    ['a number', 7],
    ['an array', []]
  ])('falls back to the unfiltered default for %s', (_label, payload) => {
    const parsed = readListQuery(listJobsQuerySchema, payload, 'jobs:list') as Record<string, unknown>
    for (const value of Object.values(parsed)) expect(value).toBeUndefined()
  })
})
