import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { flagFailureTool } from './flagFailure'
import { queueJob, setFilled, setSubmitted } from '../../db/repositories/jobsRepository'

function parse(result: Awaited<ReturnType<typeof flagFailureTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('flagFailureTool', () => {
  it('marks a queued job as failed with the given reason', async () => {
    const job = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' }).job
    const result = await flagFailureTool({ jobId: job.id, reasonTag: 'login_required', message: 'sign-in wall' })
    expect(parse(result)).toEqual({ jobId: job.id, status: 'failed' })
  })

  it('returns a plain-text error (isError: true) for an unknown job id', async () => {
    const result = await flagFailureTool({ jobId: 'nope', reasonTag: 'other', message: undefined })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('No job found')
  })

  it('returns a plain-text error for an illegal transition (e.g. an already-submitted job)', async () => {
    const job = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://x.com/1' }).job
    setFilled(job.id)
    setSubmitted(job.id)

    const result = await flagFailureTool({ jobId: job.id, reasonTag: 'other', message: undefined })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('Illegal job state transition')
  })
})
