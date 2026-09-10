import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

const runClickButtonTask = vi.fn()
vi.mock('../../browser/fillTaskRunner', () => ({
  runClickButtonTask: (...args: unknown[]) => runClickButtonTask(...args)
}))

beforeEach(() => {
  testDb = createTestDb().db
  runClickButtonTask.mockReset()
})

import { listActivity } from '../../db/repositories/activityLogRepository'
import { clickApplicationButtonTool } from './clickApplicationButton'

function parse(result: Awaited<ReturnType<typeof clickApplicationButtonTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('clickApplicationButtonTool', () => {
  it('returns and logs the browser task result', async () => {
    runClickButtonTask.mockResolvedValue({
      status: 'clicked',
      jobId: 'job-1',
      button: { buttonId: 'applyer-button-next', label: 'Next' },
      message: 'clicked'
    })

    const result = await clickApplicationButtonTool({
      jobId: 'job-1',
      buttonId: 'applyer-button-next'
    })

    expect(parse(result)).toMatchObject({ status: 'clicked', button: { label: 'Next' } })
    expect(runClickButtonTask).toHaveBeenCalledWith('job-1', 'applyer-button-next')
    expect(listActivity({}).entries[0]!.message).toContain('click_application_button -> clicked')
  })

  it('returns a plain-text error when the browser task throws unexpectedly', async () => {
    runClickButtonTask.mockRejectedValue(new Error('browser crashed'))

    const result = await clickApplicationButtonTool({
      jobId: 'job-1',
      buttonId: 'applyer-button-next'
    })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('browser crashed')
  })
})
