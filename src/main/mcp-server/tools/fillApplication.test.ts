import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

const runFillTask = vi.fn()
vi.mock('../../browser/fillTaskRunner', () => ({ runFillTask: (...args: unknown[]) => runFillTask(...args) }))

beforeEach(() => {
  testDb = createTestDb().db
  runFillTask.mockReset()
})

import { fillApplicationTool } from './fillApplication'
import { listActivity } from '../../db/repositories/activityLogRepository'

function parse(result: Awaited<ReturnType<typeof fillApplicationTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('fillApplicationTool', () => {
  it('returns the fill result as-is on success', async () => {
    runFillTask.mockResolvedValue({ status: 'filled', jobId: 'job-1', screenshotPath: '/tmp/x.png', filledFields: ['Email'], skippedFields: [] })
    const result = await fillApplicationTool({ jobId: 'job-1' })
    expect(parse(result)).toMatchObject({ status: 'filled', jobId: 'job-1' })
  })

  it('logs an activity entry summarizing the outcome', async () => {
    runFillTask.mockResolvedValue({ status: 'paused_captcha', jobId: 'job-1', taskId: 'task-1', message: 'blocked' })
    await fillApplicationTool({ jobId: 'job-1' })
    const { entries } = listActivity({})
    expect(entries[0]!.message).toContain('paused_captcha')
  })

  it('returns a plain-text error if runFillTask throws unexpectedly', async () => {
    runFillTask.mockRejectedValue(new Error('browser crashed'))
    const result = await fillApplicationTool({ jobId: 'job-1' })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('browser crashed')
  })
})
