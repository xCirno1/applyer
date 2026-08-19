import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { listJobsTool } from './listJobs'
import { queueJob, setFailed } from '../../db/repositories/jobsRepository'

function parse(result: Awaited<ReturnType<typeof listJobsTool>>): { jobs: unknown[]; total: number } {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('listJobsTool', () => {
  it('returns a trimmed-down view of each job, not the full record', async () => {
    queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1', matchScore: 80 })
    const result = await listJobsTool({ status: undefined, limit: undefined, offset: undefined })
    const body = parse(result)
    expect(body.total).toBe(1)
    expect(body.jobs[0]).toEqual({
      jobId: expect.any(String),
      title: 'Engineer',
      company: 'Acme',
      status: 'queued',
      matchScore: 80,
      failureTag: null
    })
    // Deliberately does not leak description/url/etc into the tool response.
    expect(body.jobs[0]).not.toHaveProperty('url')
    expect(body.jobs[0]).not.toHaveProperty('description')
  })

  it('filters by status', async () => {
    const a = queueJob({ title: 'A', company: 'X', url: 'https://x.com/a' }).job
    queueJob({ title: 'B', company: 'X', url: 'https://x.com/b' })
    setFailed(a.id, 'other')

    const result = await listJobsTool({ status: 'failed', limit: undefined, offset: undefined })
    const body = parse(result)
    expect(body.jobs).toHaveLength(1)
    expect((body.jobs[0] as { title: string }).title).toBe('A')
  })

  it('respects limit/offset', async () => {
    for (let i = 0; i < 3; i++) queueJob({ title: `Job ${i}`, company: 'X', url: `https://x.com/${i}` })
    const result = await listJobsTool({ status: undefined, limit: 1, offset: 1 })
    const body = parse(result)
    expect(body.jobs).toHaveLength(1)
    expect(body.total).toBe(3)
  })
})
