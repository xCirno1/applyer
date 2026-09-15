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
  createRun,
  deleteRun,
  endRun,
  getActiveRun,
  getRun,
  insertRunEvent,
  listRunEvents,
  listRuns,
  loadRunEvents,
  normalizeLabel,
  renameRun
} from './runsRepository'
import { queueJob } from './jobsRepository'
import { runEvents } from '../schema'

describe('createRun / getActiveRun / endRun', () => {
  it('starts a run with a 1-based sequence and no end', () => {
    const run = createRun()
    expect(run).toMatchObject({ sequence: 1, label: null, endedAt: null, eventCount: 0 })
    expect(getActiveRun()?.id).toBe(run.id)
  })

  it('ends any run still in progress when a new one starts, so at most one is open', () => {
    const first = createRun('first')
    const second = createRun('second')
    expect(getRun(first.id)?.endedAt).not.toBeNull()
    expect(second.sequence).toBe(2)
    expect(getActiveRun()?.id).toBe(second.id)
  })

  it('keeps counting sequences after a run is deleted', () => {
    const first = createRun()
    endRun(first.id)
    deleteRun(first.id)
    // max(sequence) over an empty table is null, and the next run is #1
    // again; after that the sequence only ever moves forward.
    const second = createRun()
    expect(second.sequence).toBe(1)
    const third = createRun()
    expect(third.sequence).toBe(2)
  })

  it('endRun stamps the end once and leaves an ended run alone', () => {
    const run = createRun()
    const ended = endRun(run.id)
    expect(ended?.endedAt).toEqual(expect.any(String))
    const again = endRun(run.id)
    expect(again?.endedAt).toBe(ended?.endedAt)
    expect(getActiveRun()).toBeNull()
  })

  it('endRun and renameRun return null for an unknown id', () => {
    expect(endRun('missing')).toBeNull()
    expect(renameRun('missing', 'x')).toBeNull()
    expect(deleteRun('missing')).toBe(false)
  })
})

describe('labels', () => {
  it.each([
    ['  Morning batch  ', 'Morning batch'],
    ['two   spaces', 'two spaces'],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
    ['x'.repeat(200), 'x'.repeat(80)]
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeLabel(input)).toBe(expected)
  })

  it('renames and clears a label', () => {
    const run = createRun('draft')
    expect(renameRun(run.id, 'Final')?.label).toBe('Final')
    expect(renameRun(run.id, null)?.label).toBeNull()
  })
})

describe('events', () => {
  it('inserts an event and counts it on the run', () => {
    const run = createRun()
    const event = insertRunEvent({ runId: run.id, kind: 'job_queued', source: 'seek', jobId: 'job-1', meta: { matchScore: 80 } })
    expect(event).toMatchObject({ runId: run.id, kind: 'job_queued', source: 'seek', jobId: 'job-1', meta: { matchScore: 80 } })
    expect(getRun(run.id)?.eventCount).toBe(1)
  })

  it('stores empty meta as null', () => {
    const run = createRun()
    const event = insertRunEvent({ runId: run.id, kind: 'captcha_resolved', meta: {} })
    expect(event.meta).toBeNull()
  })

  it('loads events in insertion order and pages the timeline newest first', () => {
    const run = createRun()
    insertRunEvent({ runId: run.id, kind: 'search', meta: { query: 'a' } })
    insertRunEvent({ runId: run.id, kind: 'job_queued', source: 'indeed' })
    insertRunEvent({ runId: run.id, kind: 'tool_call', meta: { tool: 'search_jobs' } })

    expect(loadRunEvents(run.id).map((event) => event.kind)).toEqual(['search', 'job_queued', 'tool_call'])

    const page = listRunEvents({ runId: run.id, limit: 2 })
    expect(page.total).toBe(3)
    expect(page.items.map((event) => event.kind)).toEqual(['tool_call', 'job_queued'])
    const next = listRunEvents({ runId: run.id, limit: 2, offset: 2 })
    expect(next.items.map((event) => event.kind)).toEqual(['search'])
  })

  it('filters the timeline by kind and answers an all-unknown kind list with nothing', () => {
    const run = createRun()
    insertRunEvent({ runId: run.id, kind: 'search' })
    insertRunEvent({ runId: run.id, kind: 'job_queued' })
    expect(listRunEvents({ runId: run.id, kinds: ['job_queued'] }).items.map((e) => e.kind)).toEqual(['job_queued'])
    expect(listRunEvents({ runId: run.id, kinds: ['nope' as never] })).toEqual({ items: [], total: 0 })
  })

  it('names the job an event is about while the job exists', () => {
    const run = createRun()
    const { job } = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://acme.example/jobs/1' })
    insertRunEvent({ runId: run.id, kind: 'job_queued', jobId: job.id })
    insertRunEvent({ runId: run.id, kind: 'job_queued', jobId: 'gone' })
    const { items } = listRunEvents({ runId: run.id })
    expect(items.find((e) => e.jobId === job.id)).toMatchObject({ jobTitle: 'Engineer', jobCompany: 'Acme' })
    expect(items.find((e) => e.jobId === 'gone')).toMatchObject({ jobTitle: null, jobCompany: null })
  })

  it('skips rows whose kind this build does not know', () => {
    const run = createRun()
    testDb.insert(runEvents).values({ runId: run.id, kind: 'from_the_future', createdAt: new Date().toISOString() }).run()
    insertRunEvent({ runId: run.id, kind: 'search' })
    expect(loadRunEvents(run.id).map((e) => e.kind)).toEqual(['search'])
    expect(listRunEvents({ runId: run.id }).items.map((e) => e.kind)).toEqual(['search'])
  })

  it('treats malformed meta as absent', () => {
    const run = createRun()
    testDb.insert(runEvents).values({ runId: run.id, kind: 'search', meta: [1, 2] as never, createdAt: new Date().toISOString() }).run()
    expect(loadRunEvents(run.id)[0]?.meta).toBeNull()
  })

  it('deletes events with their run', () => {
    const run = createRun()
    insertRunEvent({ runId: run.id, kind: 'search' })
    expect(deleteRun(run.id)).toBe(true)
    expect(testDb.select().from(runEvents).all()).toHaveLength(0)
  })
})

describe('listRuns', () => {
  it('lists newest first with event counts and pages', () => {
    const a = createRun('a')
    insertRunEvent({ runId: a.id, kind: 'search' })
    const b = createRun('b')
    const c = createRun('c')
    const page = listRuns({ limit: 2 })
    expect(page.total).toBe(3)
    expect(page.items.map((run) => run.label)).toEqual(['c', 'b'])
    expect(page.items[1]?.id).toBe(b.id)
    expect(listRuns({ limit: 2, offset: 2 }).items.map((run) => run.id)).toEqual([a.id])
    expect(listRuns({}).items.find((run) => run.id === a.id)?.eventCount).toBe(1)
    expect(c.eventCount).toBe(0)
  })

  it('clamps the limit and offset', () => {
    createRun()
    expect(listRuns({ limit: 0, offset: -5 }).items).toHaveLength(1)
    expect(listRuns({ limit: 10_000 }).items).toHaveLength(1)
  })
})
