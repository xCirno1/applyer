import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
  __resetRunTracker()
})

import { queueJobTool } from './queueJob'
import { excludeUrl } from '../../db/repositories/jobExclusionsRepository'
import { getJobByUrl } from '../../db/repositories/jobsRepository'
import { listActivity } from '../../db/repositories/activityLogRepository'
import { createRun, loadRunEvents } from '../../db/repositories/runsRepository'
import { __resetRunTracker } from '../../runs/runTracker'

function parse(result: Awaited<ReturnType<typeof queueJobTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('queueJobTool', () => {
  it('queues a new job and auto-detects its source from the URL', async () => {
    const result = await queueJobTool({
      title: 'Engineer',
      company: 'Acme',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      description: undefined,
      location: undefined,
      source: undefined,
      salaryRange: undefined,
      matchScore: undefined,
      matchReasons: undefined
    })
    const body = parse(result) as { status: string; jobId: string }
    expect(body.status).toBe('queued')
    expect(getJobByUrl('https://boards.greenhouse.io/acme/jobs/1')?.source).toBe('greenhouse')
  })

  it('respects an explicit source over auto-detection', async () => {
    await queueJobTool({
      title: 'Engineer',
      company: 'Acme',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      source: 'linkedin',
      description: undefined,
      location: undefined,
      salaryRange: undefined,
      matchScore: undefined,
      matchReasons: undefined
    })
    expect(getJobByUrl('https://boards.greenhouse.io/acme/jobs/1')?.source).toBe('linkedin')
  })

  it('reports status "existing" without logging a second activity entry when the URL is already queued', async () => {
    const args = {
      title: 'Engineer',
      company: 'Acme',
      url: 'https://example.com/1',
      description: undefined,
      location: undefined,
      source: undefined,
      salaryRange: undefined,
      matchScore: undefined,
      matchReasons: undefined
    }
    await queueJobTool(args)
    const result = await queueJobTool(args)
    expect(parse(result)).toMatchObject({ status: 'existing' })
    expect(listActivity({}).total).toBe(1)
  })

  it('refuses to queue a URL on the exclusion list', async () => {
    excludeUrl({ url: 'https://example.com/blocked', excludedBy: 'user' })
    const result = await queueJobTool({
      title: 'Engineer',
      company: 'Acme',
      url: 'https://example.com/blocked',
      description: undefined,
      location: undefined,
      source: undefined,
      salaryRange: undefined,
      matchScore: undefined,
      matchReasons: undefined
    })
    expect(parse(result)).toMatchObject({ jobId: null, status: 'excluded' })
    expect(getJobByUrl('https://example.com/blocked')).toBeNull()
  })

  it('sanitizes a malicious description before storing it', async () => {
    await queueJobTool({
      title: 'Engineer',
      company: 'Acme',
      url: 'https://example.com/1',
      description: '<script>alert(1)</script><p>Real description</p>',
      location: undefined,
      source: undefined,
      salaryRange: undefined,
      matchScore: undefined,
      matchReasons: undefined
    })
    const job = getJobByUrl('https://example.com/1')
    expect(job?.description).not.toContain('<script>')
    expect(job?.description).toContain('Real description')
  })

  describe('run statistics', () => {
    it('records queued, existing and excluded outcomes with the job source', async () => {
      const run = createRun()
      await queueJobTool({ title: 'Engineer', company: 'Acme', url: 'https://au.seek.com/job/1', location: undefined, source: undefined, description: undefined, salaryRange: undefined, matchScore: 85, matchReasons: undefined })
      await queueJobTool({ title: 'Engineer', company: 'Acme', url: 'https://au.seek.com/job/1', location: undefined, source: undefined, description: undefined, salaryRange: undefined, matchScore: undefined, matchReasons: undefined })
      excludeUrl({ url: 'https://www.indeed.com/viewjob?jk=2', excludedBy: 'user' })
      await queueJobTool({ title: 'Other', company: 'Acme', url: 'https://www.indeed.com/viewjob?jk=2', location: undefined, source: undefined, description: undefined, salaryRange: undefined, matchScore: undefined, matchReasons: undefined })
      const events = loadRunEvents(run.id).events
      expect(events.map((event) => [event.kind, event.source])).toEqual([
        ['job_queued', 'seek'],
        ['job_queue_existing', 'seek'],
        ['job_queue_excluded', 'indeed']
      ])
      expect(events[0]?.meta).toEqual({ matchScore: 85 })
      expect(events[0]?.jobId).toBe(getJobByUrl('https://au.seek.com/job/1')?.id)
    })
  })
})
