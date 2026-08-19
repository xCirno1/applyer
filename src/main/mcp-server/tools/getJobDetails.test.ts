import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

const fetchJobDetails = vi.fn()
vi.mock('../../browser/jobDetails', () => ({ fetchJobDetails: (...args: unknown[]) => fetchJobDetails(...args) }))

beforeEach(() => {
  testDb = createTestDb().db
  fetchJobDetails.mockReset()
})

import { getJobDetailsTool } from './getJobDetails'
import { queueJob, getJob } from '../../db/repositories/jobsRepository'
import { getCachedJobDetails } from '../../db/repositories/jobDetailsCacheRepository'

const OK_DETAILS = {
  title: 'Engineer',
  company: 'Acme',
  description: '<p>desc</p>',
  descriptionText: 'desc',
  applicationUrl: 'https://acme.com/apply',
  requiresLogin: false,
  applyMethod: 'external_form' as const
}

function parse(result: Awaited<ReturnType<typeof getJobDetailsTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('getJobDetailsTool', () => {
  it('fetches and caches details on a cache miss', async () => {
    fetchJobDetails.mockResolvedValue({ status: 'ok', details: OK_DETAILS })
    const result = await getJobDetailsTool({ url: 'https://example.com/1' })
    expect(parse(result)).toMatchObject({ title: 'Engineer' })
    expect(getCachedJobDetails('https://example.com/1')).toMatchObject({ title: 'Engineer' })
  })

  it('serves from cache without calling fetchJobDetails again', async () => {
    fetchJobDetails.mockResolvedValue({ status: 'ok', details: OK_DETAILS })
    await getJobDetailsTool({ url: 'https://example.com/1' })
    fetchJobDetails.mockClear()

    const result = await getJobDetailsTool({ url: 'https://example.com/1' })
    expect(fetchJobDetails).not.toHaveBeenCalled()
    expect(parse(result)).toMatchObject({ title: 'Engineer' })
  })

  it('passes through a not_found outcome', async () => {
    fetchJobDetails.mockResolvedValue({ status: 'not_found', message: 'gone' })
    const result = await getJobDetailsTool({ url: 'https://example.com/1' })
    expect(parse(result)).toEqual({ status: 'not_found', message: 'gone' })
  })

  it('on a blocked outcome, fails a currently-queued job tracking that URL', async () => {
    const job = queueJob({ title: 'Engineer', company: 'Acme', url: 'https://example.com/1' }).job
    fetchJobDetails.mockResolvedValue({ status: 'blocked', reasonTag: 'captcha_verification', message: 'blocked' })

    const result = await getJobDetailsTool({ url: 'https://example.com/1' })
    expect(parse(result)).toEqual({ status: 'blocked', reasonTag: 'captcha_verification', message: 'blocked' })
    expect(getJob(job.id)?.status).toBe('failed')
    expect(getJob(job.id)?.failureTag).toBe('captcha_verification')
  })

  it('on a blocked outcome, does not touch a job that is not queued (e.g. already filled)', async () => {
    fetchJobDetails.mockResolvedValue({ status: 'blocked', reasonTag: 'captcha_verification', message: 'blocked' })
    // No job tracked for this URL at all — should just report blocked, no throw.
    const result = await getJobDetailsTool({ url: 'https://untracked.com/1' })
    expect(parse(result)).toMatchObject({ status: 'blocked' })
  })

  it('returns a plain-text error if fetchJobDetails throws unexpectedly', async () => {
    fetchJobDetails.mockRejectedValue(new Error('network exploded'))
    const result = await getJobDetailsTool({ url: 'https://example.com/1' })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('network exploded')
  })
})
