import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))
const runEditTask = vi.fn()
vi.mock('../../browser/fillTaskRunner', () => ({ runEditTask: (...args: unknown[]) => runEditTask(...args) }))

beforeEach(() => {
  testDb = createTestDb().db
  runEditTask.mockReset()
})

import { editApplicationTool } from './editApplication'
import { listActivity } from '../../db/repositories/activityLogRepository'

function parse(result: Awaited<ReturnType<typeof editApplicationTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('editApplicationTool', () => {
  it('passes exact answer pairs to the retained-session runner', async () => {
    runEditTask.mockResolvedValue({ status: 'edited', jobId: 'job-1', screenshotPath: '/tmp/x.png', screenshotPaths: ['/tmp/x.png'], filledFields: ['Contact me here'], skippedFields: [] })
    const answers = [{ fieldId: 'field-contact', value: 'jane@example.com' }]
    const result = await editApplicationTool({ jobId: 'job-1', answers })
    expect(parse(result)).toMatchObject({ status: 'edited', jobId: 'job-1' })
    expect(runEditTask).toHaveBeenCalledWith('job-1', answers)
  })

  it('reports a missing original session and logs the outcome', async () => {
    runEditTask.mockResolvedValue({ status: 'no_active_session', jobId: 'job-1', message: 'window closed' })
    const result = await editApplicationTool({ jobId: 'job-1', answers: [{ fieldId: 'field-email', value: 'jane@example.com' }] })
    expect(parse(result)).toMatchObject({ status: 'no_active_session' })
    expect(listActivity({}).entries[0]!.message).toContain('edit_application -> no_active_session')
  })
})
